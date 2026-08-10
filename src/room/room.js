// 好友房核心（Q29/Q37，§7.2 唯一豁免）：一房一实例的服务端权威状态机。
// 掷骰与暗骰只活在这里；每个客户端只收到 observe(自己)（schema 强制信息隔离原样上网络）。
// AI（一号机）也跑在这里——提示词在多人局里永不落任何客户端（§9.7 红利）。
// 本模块零平台依赖（注入 send/schedule/fetch），DO 只是薄壳；node 测试用假 socket 全场走通。

import { createMatch } from '../engine.js';
import { createOpponent, personaLine, stateIdOf } from '../ai/agent.js';
import { silentSay } from '../ai/voice.js';
import { defaultAiPersona, HOSTED_MODEL, IDLE_LINES } from '../ai/personas.js';
import { computeStats, condBrief, diceByRoundOf } from '../ui/report.js';
import { viewFor, mapFor } from './rename.js';
import { PHRASES, SEALS, BET_CAP, SHOWDOWN_MS } from './protocol.js';

const HUMANS = ['A', 'C'];
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function createRoomCore({
  hostKey,
  send, // (connId, obj) => void
  now = () => Date.now(),
  schedule = (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  fetchFn = globalThis.fetch,
  proxyBase = 'https://kai-dice.pages.dev/api/llm',
  aiPaceMs = 1100, // AI 思考地板（演出节奏），LLM 延迟大于它时不再叠加
  subMs = 10_000, // 掉线多久后一号机代打
  nagMs = 30_000, // 挂机催话（§2.4 平移到服务端）
  showdownMs = SHOWDOWN_MS,
} = {}) {
  const seats = {
    A: { kind: 'human', seal: null, device: null, tab: null, conn: null, connected: false, substituted: false },
    B: { kind: 'ai', seal: defaultAiPersona().seal, name: defaultAiPersona().name },
    C: { kind: 'human', seal: null, device: null, tab: null, conn: null, connected: false, substituted: false },
  };
  let phase = 'waiting'; // waiting | playing | ended
  let match = null;
  let matchGen = 0;
  let matchNo = 0;
  let roomChips = { A: 100, B: 100, C: 100 }; // 房内经济（裁决①）：只活在本房，不回写任何设备账本
  let sideDelta = { A: 0, B: 0, C: 0 }; // 旁注零和账（引擎外叠加层）
  let hostPass = null;
  let hostDevice = null;
  let seenEvents = 0;
  let lastRevealAt = 0;
  let bets = []; // 下次开牌前的旁注 {bettor, on}
  let pumping = false;
  let cancelNag = null;
  const cancelSub = {};
  const roomEvents = { B: [], A: [], C: [] }; // 房间服务端盖章的本场全量公开事件
  const dialogue = { B: [], A: [], C: [] }; // 本场全量牌桌引语，与引擎/房间事实分桶
  let opponents = {};

  const sealName = (s) => (seats[s].kind === 'ai' ? seats[s].name : (seats[s].seal ?? (s === 'A' ? '主' : '客')));
  const namesFor = (self) => {
    const n = {};
    for (const s of ['A', 'B', 'C']) n[s] = sealName(s);
    n[self] = '你';
    return n;
  };
  const channel = () =>
    hostPass && fetchFn
      ? {
          baseUrl: proxyBase,
          apiKey: hostPass,
          model: HOSTED_MODEL,
          headers: { 'X-Device': (hostDevice ?? 'room').slice(0, 64) },
        }
      : null;

  // ---------- 发信（每收件人一次座位重映射：谁收都看见自己是 A） ----------
  const sendTo = (s, obj) => {
    if (seats[s].conn != null) send(seats[s].conn, viewFor(obj, s));
  };
  const broadcast = (obj) => {
    for (const s of HUMANS) sendTo(s, obj);
  };
  const rosterMsg = () => ({
    t: 'room',
    phase,
    matchNo,
    seats: ['A', 'B', 'C'].map((s) => ({
      seat: s,
      kind: seats[s].kind,
      seal: seats[s].kind === 'ai' ? seats[s].seal : seats[s].seal,
      name: sealName(s),
      occupied: seats[s].kind === 'ai' || !!seats[s].device,
      connected: seats[s].kind === 'ai' ? true : seats[s].connected,
      substituted: !!seats[s].substituted,
    })),
  });
  const pushRoster = () => broadcast(rosterMsg());
  const pushObs = () => {
    if (!match) return;
    for (const s of HUMANS) if (seats[s].conn != null) sendTo(s, { t: 'ob', ob: match.observe(s) });
  };
  const say = (text, speaker = 'B', action = null, round = match?.observe(speaker)?.round ?? null) => {
    if (!text) return;
    broadcast({ t: 'say', seat: speaker, text });
    for (const s of Object.keys(dialogue))
      dialogue[s].push({ round, speaker, kind: 'speech', action, text });
  };

  // ---------- AI（一号机本席 + 掉线代打） ----------
  const promptCtxFor = (seat) => ({
    names: namesFor(seat),
    three: true,
    dialogue: dialogue[seat],
    roomEvents: roomEvents[seat],
    control: seat === 'B' ? null : { mode: 'substitute', seat },
  });
  function ensureOpponent(seat) {
    if (opponents[seat]) return opponents[seat];
    opponents[seat] = createOpponent({
      channel,
      profile: '', // 好友房无跨设备档案：AI 对两位客人都从本房现场读起（房内多场连续）
      persona: defaultAiPersona(),
      ctx: promptCtxFor(seat),
    });
    return opponents[seat];
  }
  const pushRoomEvent = (event) => {
    for (const s of Object.keys(roomEvents)) roomEvents[s].push(structuredClone(event));
  };

  const controllerOf = (s) => (seats[s].kind === 'ai' || seats[s].substituted ? 'ai' : 'human');

  // ---------- 催话（服务端计时；客户端不再自催） ----------
  function armNag(seat) {
    disarmNag();
    if (controllerOf(seat) !== 'human' || !seats[seat].connected) return;
    cancelNag = schedule(() => {
      if (phase !== 'playing' || !match) return;
      const o = match.observe('A');
      if (o.over || o.turn !== seat) return;
      const lines = IDLE_LINES;
      say(`${sealName(seat)}——${lines[Math.floor(Math.random() * lines.length)]}`);
      armNag(seat);
    }, nagMs);
  }
  const disarmNag = () => {
    cancelNag?.();
    cancelNag = null;
  };

  // ---------- 事件后处理：旁注结算、终局 ----------
  function drainEvents() {
    const events = match.observe('A').events;
    const fresh = events.slice(seenEvents);
    seenEvents = events.length;
    for (const e of fresh) {
      if (e.type === 'roundEnd') {
        lastRevealAt = now();
        resolveBets(e);
      }
      if (e.type === 'matchEnd') endMatch(e);
    }
  }

  function resolveBets(re) {
    for (const b of bets) {
      const hit = b.on === re.winner;
      const from = hit ? re.winner : b.bettor;
      const to = hit ? b.bettor : re.winner;
      sideDelta[from] -= BET_CAP;
      sideDelta[to] += BET_CAP;
      broadcast({ t: 'betResult', bettor: b.bettor, on: b.on, hit, amount: BET_CAP });
      pushRoomEvent({ type: 'betResult', bettor: b.bettor, on: b.on, hit, delta: hit ? BET_CAP : -BET_CAP });
    }
    bets = [];
  }

  async function endMatch(end) {
    phase = 'ended';
    disarmNag();
    for (const s of ['A', 'B', 'C']) roomChips[s] = end.chips[s] + sideDelta[s];
    sideDelta = { A: 0, B: 0, C: 0 };
    pushRoster();
    const events = match.observe('A').events;
    const packs = {};
    for (const s of HUMANS) {
      const st = computeStats(events, s, diceByRoundOf(events, s));
      packs[s] = {
        seal: sealName(s),
        rounds: st.rounds,
        bluffRate: st.bluffRate,
        challenges: st.myChallenges,
        challengeHits: st.myChallengeHits,
        timesChallenged: st.timesChallenged,
        blinds: st.myBlinds,
        raises: st.myRaises,
        insight: condBrief(st) || null,
        chips: roomChips[s],
      };
    }
    const gen = matchGen;
    let verdict = null;
    const ch = channel();
    if (ch) {
      const fact = (s) =>
        `${sealName(s)}：虚报率${Math.round(packs[s].bluffRate * 100)}%，开牌${packs[s].challenges}次中${packs[s].challengeHits}次，被开${packs[s].timesChallenged}次${packs[s].insight ? `，破绽「${packs[s].insight}」` : ''}`;
      verdict = await personaLine(ch, {
        persona: defaultAiPersona(),
        task: '一场打完。你是桌上的主持人，写两三句「双人对比判词」——点名两位客人谁更怂、谁更虚，必须引用给你的真实数据，比出个高下，不许编。',
        facts: `名次：${end.standings.map((s) => sealName(s)).join(' > ')}；${fact('A')}；${fact('C')}`,
      });
      if (gen !== matchGen) return;
    }
    const report = {
      t: 'report',
      matchNo,
      standings: end.standings,
      names: { A: sealName('A'), B: sealName('B'), C: sealName('C') },
      packs, // 按座位键控；重映射后各端自见为 A
      ai: { name: sealName('B'), chips: roomChips.B },
      chips: { ...roomChips },
      verdict, // null=沉默模式（不代言）
    };
    broadcast(report);
  }

  // ---------- AI 驱动泵：轮到 AI 控制的席位就打，直到人类手或终局 ----------
  async function pump() {
    if (pumping || phase !== 'playing') return;
    pumping = true;
    const gen = matchGen;
    try {
      while (phase === 'playing' && gen === matchGen) {
        const o = match.observe('A');
        if (o.over) break;
        const seat = o.turn;
        if (controllerOf(seat) !== 'ai') {
          armNag(seat);
          break;
        }
        disarmNag();
        // 让拍：客户端摊牌动画期间不抢跑
        const wait = lastRevealAt + showdownMs - now();
        if (wait > 0) await sleep(wait);
        if (gen !== matchGen || phase !== 'playing') break;
        const ai = ensureOpponent(seat);
        const ob = match.observe(seat);
        if (ob.over || ob.turn !== seat) continue;
        const t0 = now();
        const d = await ai.decide(ob);
        if (gen !== matchGen || phase !== 'playing') break;
        if (controllerOf(seat) !== 'ai') break;
        if (d.observedStateId && d.observedStateId !== stateIdOf(match.observe(seat), promptCtxFor(seat))) continue;
        await sleep(aiPaceMs - (now() - t0));
        if (gen !== matchGen || phase !== 'playing') break;
        if (controllerOf(seat) !== 'ai') break;
        if (d.observedStateId && d.observedStateId !== stateIdOf(match.observe(seat), promptCtxFor(seat))) continue;
        try {
          await match.act(seat, d.action, { elapsedMs: now() - t0 });
        } catch {
          break; // 引擎拒绝（不应发生；沉默 bot 兜底本身合法）——停泵防死循环
        }
        // F2 沉默模式的"被读"底线：没暗号的房间（沉默主持）开牌时也得说出为什么——事实模板，零编造
        const line = d.say || (d.action.type === 'challenge' ? silentSay(defaultAiPersona(), ob) : '');
        if (line) say(seat === 'B' ? line : `（代打${sealName(seat)}）${line}`, seat, d.action, ob.round);
        pushObs();
        drainEvents();
      }
    } finally {
      pumping = false;
    }
  }

  async function beginMatch() {
    matchGen += 1;
    matchNo += 1;
    bets = [];
    seenEvents = 0;
    lastRevealAt = 0;
    opponents = {};
    for (const items of Object.values(roomEvents)) items.length = 0;
    for (const items of Object.values(dialogue)) items.length = 0;
    match = await createMatch({
      seed: (now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
      config: { players: ['A', 'B', 'C'], startChips: { ...roomChips } },
    });
    phase = 'playing';
    pushRoster();
    pushObs();
    const ch = channel();
    if (ch) {
      const gen = matchGen;
      personaLine(ch, {
        persona: defaultAiPersona(),
        task:
          matchNo === 1
            ? '好友房开场白：两位人类客人同桌，你是主持人也是对手。招呼开局，顺带把丑话说在前面（你两个都读）。'
            : '好友房续场开场白：还是这两位客人。引用一条上一场的真实结果开局。',
        facts: `第 ${matchNo} 场；客人：${sealName('A')}（身家${roomChips.A}） 与 ${sealName('C')}（身家${roomChips.C}）；你身家${roomChips.B}`,
      }).then((line) => {
        if (line && gen === matchGen) say(line);
      });
    }
    pump();
  }

  // ---------- 入口：连接与消息 ----------
  function seatOfConn(connId) {
    return HUMANS.find((s) => seats[s].conn === connId) ?? null;
  }

  function hello(connId, msg) {
    const device = String(msg.device ?? '').slice(0, 80);
    const tab = String(msg.tab ?? '').slice(0, 16);
    if (!device) return send(connId, { t: 'err', msg: '无设备标识' });
    const wantHost = msg.hostKey != null;
    if (wantHost && msg.hostKey !== hostKey) return send(connId, { t: 'err', msg: '房主钥匙不对' });
    const target = wantHost ? 'A' : 'C';
    const st = seats[target];
    const samePerson = st.device === device && (st.tab === tab || wantHost);
    if (st.device && !samePerson && st.connected) return send(connId, { t: 'err', msg: '这一席有人坐着' });
    if (!st.device || samePerson || !st.connected) {
      st.device = device;
      st.tab = tab;
      st.conn = connId;
      st.connected = true;
      st.substituted = false;
      if (!st.seal) st.seal = SEALS.includes(msg.seal) ? msg.seal : target === 'A' ? '主' : '客';
      // 双客同章撞车：客席自动换下一枚
      const other = target === 'A' ? 'C' : 'A';
      if (seats[other].seal === st.seal) st.seal = SEALS.find((x) => x !== st.seal) ?? st.seal;
      cancelSub[target]?.();
      if (target === 'A') {
        if (msg.pass) hostPass = String(msg.pass).slice(0, 128);
        hostDevice = device;
      }
      send(connId, { t: 'welcome', you: 'A', phrases: PHRASES }); // 重映射后人人自见为 A
      pushRoster();
      if (match) sendTo(target, { t: 'ob', ob: match.observe(target) });
      if (phase === 'playing') pump();
      return;
    }
    send(connId, { t: 'err', msg: '这一席有人坐着' });
  }

  async function handle(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return hello(connId, msg);
    const seat = seatOfConn(connId);
    if (!seat) return send(connId, { t: 'err', msg: '先入座' });
    const map = mapFor(seat); // 自身逆映射：把客户端视角的座位号翻回内部座次
    const toCanon = (s) => (map ? (map[s] ?? s) : s);
    switch (msg.t) {
      case 'start': {
        if (seat !== 'A') return send(connId, { t: 'err', msg: '等主家开局' });
        if (phase === 'playing') return;
        if (!seats.C.device || !seats.C.connected) return send(connId, { t: 'err', msg: '好友还没到' });
        await beginMatch();
        return;
      }
      case 'again': {
        if (seat !== 'A') return send(connId, { t: 'err', msg: '等主家开局' });
        if (phase !== 'ended') return;
        await beginMatch();
        return;
      }
      case 'act': {
        if (phase !== 'playing' || !match) return send(connId, { t: 'err', msg: '没在局中' });
        if (seats[seat].substituted) return send(connId, { t: 'err', msg: '你的席位在代打，等下一手回来' });
        try {
          await match.act(seat, msg.action, { elapsedMs: Number.isFinite(msg.elapsedMs) ? msg.elapsedMs : null });
        } catch (e) {
          return send(connId, { t: 'err', msg: `不合法：${e?.message ?? ''}` });
        }
        send(connId, { t: 'ack' });
        disarmNag();
        pushObs();
        drainEvents();
        pump();
        return;
      }
      case 'phrase': {
        const id = msg.id | 0;
        if (!(id >= 0 && id < PHRASES.length)) return;
        broadcast({ t: 'phrase', seat, id });
        pushRoomEvent({ type: 'phrase', actor: seat, text: PHRASES[id] });
        return;
      }
      case 'bet': {
        if (phase !== 'playing' || !match) return;
        const on = toCanon(msg.on);
        const o = match.observe(seat);
        const me = o.players.find((p) => p.id === seat); // 重映射前的内部视角：seat 即本座
        const target = match.observe('A').players.find((p) => p.id === on);
        if (me?.alive) return send(connId, { t: 'err', msg: '还没出局，好好打牌' });
        if (!target?.alive || on === seat) return send(connId, { t: 'err', msg: '押活人' });
        if (bets.some((b) => b.bettor === seat)) return send(connId, { t: 'err', msg: '这拍已押过' });
        bets.push({ bettor: seat, on });
        broadcast({ t: 'bet', bettor: seat, on, amount: BET_CAP });
        pushRoomEvent({ type: 'bet', bettor: seat, on, amount: BET_CAP });
        return;
      }
      default:
        return;
    }
  }

  function onDisconnect(connId) {
    const seat = seatOfConn(connId);
    if (!seat) return;
    seats[seat].conn = null;
    seats[seat].connected = false;
    pushRoster();
    if (phase !== 'playing') return;
    cancelSub[seat]?.();
    cancelSub[seat] = schedule(() => {
      if (seats[seat].connected || phase !== 'playing') return;
      seats[seat].substituted = true; // 一号机代打（裁决：有暗号=LLM 代打，无=沉默代打）
      pushRoster(); // 代打状态由数据承载（UI 标注），播报只能出自角色——有通道才开口
      const ch = channel();
      if (ch) {
        const gen = matchGen;
        personaLine(ch, {
          persona: defaultAiPersona(),
          task: '桌上一位客人掉线了，你接手替他打（代打）。用你的方式说一句——照打不误、账照记。',
          facts: `掉线的客人：${sealName(seat)}`,
        }).then((line) => {
          if (line && gen === matchGen && phase === 'playing') say(line);
        });
      }
      pump();
    }, subMs);
  }

  return {
    handle,
    onDisconnect,
    // 测试探针（只读）
    _debug: () => ({ phase, matchNo, roomChips: { ...roomChips }, sideDelta: { ...sideDelta }, seats, bets: [...bets] }),
  };
}
