// UI 状态机：引擎先行落子，表现层跟随（DESIGN §7.3）。
// 玩家与 AI 对手走同一套 observe/act——本文件只是人类的"客户端"。

import { createMatch } from '../engine.js';
import { allLegalBids } from '../rules.js';
import { obProb, obProbExact, coarseWord } from '../probability.js';
import { createOpponent, settleVerdict, reflect, personaLine } from '../ai/agent.js';
import { silentSay } from '../ai/voice.js';
import { chat } from '../ai/llm.js';
import { PERSONAS, HOSTED_MODEL, modelPersona } from '../ai/personas.js';
import { OPENROUTER_BASE, isOpenRouter, originHeaders, fetchModels, perMillion } from '../ai/openrouter.js';
import { pickedMods, allMods, loadLab, saveLab, loadWishes, saveWishes, addWishLog, loadWishLog, activeTypes } from '../mods/store.js';
import { OPS } from '../mods/catalog.js';
import { joinRoom, createRemoteRoom } from './net.js';
import { SEALS, PHRASES } from '../room/protocol.js';
import { compileWish } from '../mods/compiler.js';
import { examMod } from '../mods/exam.js';
import { smokeMods } from '../mods/smoke.js';
import { computeStats, persona, templateVerdict, condBrief, bigPotBrief, diceByRoundOf, reviewTracks } from './report.js';
import { buildLedger } from '../ai/factcheck.js';
import { loadProfile, appendMatch, profileBrief, bumpResets, mindOf, saveProfile, loadPass, savePass, loadGuest, saveGuest, loadLedger, saveLedger, balanceOf, openerFacts, mergeHypotheses, recordBaits } from './profile.js';
import { sfx, unlockAudio } from './audio.js';

document.addEventListener('pointerdown', unlockAudio, { once: true });

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => `${Math.round(p * 100)}%`;
const IDLE_MS = 30_000; // §2.4（Q19 修订）：无倒计时无超时代报；挂机 >30s 人设催话
// F4（Q45）新手训练轮：头几场给被动粗档扶手，毕业自动拆——之后想要准数就得自己拨算盘
const TRAIN_MATCHES = 3; // TODO(Q46) 训练轮长度待设计确认
const inTraining = () => profile.matches < TRAIN_MATCHES;
// F1 观战提速：玩家出局后不是你的戏了——演出 4 倍速，还可一键跳到战报
let watchSpeed = 1;
let skipToReport = false;
const wsleep = (ms) => sleep(ms / watchSpeed);

const PIPS = {
  1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};
const dieHtml = (face, cls = '') =>
  `<span class="die ${cls}">${PIPS[face].map((p) => `<i class="p-${p}"></i>`).join('')}</span>`;
const backHtml = (cls = '') => `<span class="die back ${cls}"></span>`;

let profile = loadProfile();
let match, opponent, myDiceByRound, sel, busy, turnStart, idleTimer;
// 离桌守卫：atTable 拦新回合，matchGen 作废在途异步（旧局的 LLM 决策不许落到新局上）
let atTable = false;
let matchGen = 0;
// 实验桌（Q32 沙盒）：本场词条；非空即沙盒——战绩/身家/档案一律不写回
let labMods = [];
let sandbox = false;
let pickPending = null; // 词条参数拾取（亮一颗：先拍章再点自己一颗骰）
const modMetaOf = (o, type) => o.mods?.flatMap((m) => m.actions).find((a) => a.type === type);
// 好友房（Q29）：room 非空即远程模式——本地不驱动 AI，一切演出由事件重放驱动
let room = null;
// 词条盖章内容查原子注册表（裁判层视觉说真话；许愿词条同权）
const modStamp = (meta, action) => {
  for (const op of meta.ops) {
    const s = OPS[op]?.stamp?.(action, meta.label);
    if (s) return s;
  }
  return meta.label;
};
let seats = ['A', 'B'];
let opponents = {}; // seat -> AI 客户端
const typeTimers = {}; // 每席位独立打字机

// 座次（§2.5）：阵容数据驱动——人设只增不改代码。A=玩家，其余按序入座
const SEAT_IDS = ['B', 'C', 'D', 'E'];
// 客席（Q28）：自带钥匙的模型以本名上桌。托管席（用户裁决 2026-08-09）：同一种席位，
// 只是钱由官方通道出，玩家零配置——**户头都是模型名，所以同一个模型不管谁付钱都是同一个人**。
const guestPersona = () => modelPersona(loadGuest()?.model);
const hostedPersona = () => modelPersona(HOSTED_MODEL, { hosted: true });
// 主位在最前：一键可玩的真身排第一，化身（老李头他们）跟在后面，自带钥匙的客席垫底。
// 自带钥匙填的正好是托管那个模型时不重复出卡——同名即同人。
const rosterAll = () => {
  const hosted = hostedPersona();
  const g = guestPersona();
  return [hosted, ...Object.values(PERSONAS), ...(g && g.id !== hosted.id ? [g] : [])];
};
const rosterMap = () => Object.fromEntries(rosterAll().map((p) => [p.id, p]));
let SEAT_PERSONA = {}; // seat -> persona（newMatch 构建）
let NAMES = { A: '客人' };
const isTrio = () => seats.length > 2;
const dispName = (s) => (s === 'A' ? '你' : NAMES[s]);
// 桌型与阵容（选桌页写入；花名册可增，缺位按册序补齐）
// F1（Q43②）：单挑是默认——1v1 读心核，三人桌是明确的副模式
function loadTable() {
  return localStorage.getItem('kai.table.v1') === 'trio' ? 'trio' : 'duo';
}
// 主位换人（用户裁决 2026-08-09）：托管席升正席时，老设备存着的花名册选择做**一次性**迁移，
// 否则"升主位"只对新装的人生效，你自己的机器上还是老李头坐着。搬完落个记号，之后你选谁就是谁。
function promoteHostedOnce() {
  if (localStorage.getItem('kai.hostedseat.v1')) return;
  localStorage.setItem('kai.hostedseat.v1', '1');
  try {
    const ids = JSON.parse(localStorage.getItem('kai.lineup.v1') ?? '[]');
    if (!Array.isArray(ids) || !ids.length) return; // 新装的本来就默认托管席，不用搬
    localStorage.setItem('kai.lineup.v1', JSON.stringify([hostedPersona().id, ...ids.slice(1)]));
  } catch {}
}

function loadLineup(mode) {
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem('kai.lineup.v1') ?? '[]'); } catch {}
  const ros = rosterMap();
  ids = [...new Set(ids)].filter((id) => ros[id]);
  const need = mode === 'duo' ? 1 : 2;
  for (const id of Object.keys(ros)) if (ids.length < need && !ids.includes(id)) ids.push(id);
  return ids.slice(0, need);
}

// 通道分流（Q28 用户裁决）：官方人设只走官方通道（暗号→同域代理，原版演员钉死，可控打磨）；
// 客席只走自带钥匙（BYOK）。两把钥匙互不越界。
function officialChannelOf(per) {
  const pass = loadPass();
  // 托管席（用户裁决 2026-08-09）：**无暗号也能开口**——普通玩家一键就能玩上真模型。
  // 代价与护栏都在服务端：没暗号只放行托管那一个便宜模型，额度另算一档更小的（见 _worker.js）。
  // 化身（老李头他们）仍要暗号：他们钉着各自的原版演员，成本档不能被路人改。
  if (!pass && !per?.hosted) return null;
  return {
    baseUrl: `${location.origin}/api/llm`,
    apiKey: pass, // 空＝托管免费档
    model: per?.gear?.model ?? 'deepseek-chat', // Q18 原版演员按人设钉（代理端白名单校验）
    format: 'openai',
    headers: { 'X-Device': deviceId() }, // 设备日配额（§9.3）
  };
}
// OpenRouter（A1）：按其惯例带来源标识头。key 仍不出设备——浏览器直连，我方服务器不经手。
// 抽成一处是有教训的：这批实测踩到"头值非 ASCII 直接把整条通道打死"，
// 而当时连通测试走的是另一条路，测得通、打起来全静默——**试嗓要试你真唱的那条**。
const withGuestHeaders = (g) => (isOpenRouter(g.baseUrl) ? { ...g, headers: originHeaders() } : g);
function guestChannelOf() {
  const g = loadGuest();
  return g?.apiKey && g?.baseUrl ? withGuestHeaders(g) : null;
}
// 通道跟人走：托管席与化身走官方通道，自带钥匙的客席走 BYOK。两把钥匙互不越界（Q28）。
const chanForPersona = (per) => (per?.bare && !per.hosted ? guestChannelOf() : officialChannelOf(per));

// 降级原因 → 人话（连接状态可见性）
function friendlyError(msg = '') {
  if (msg.includes('401')) return '暗号不对';
  if (msg.includes('429')) return loadPass() ? '今日额度用完' : '今日免费额度用完了（有暗号可填在设置里）';
  if (msg.includes('503')) return '官方通道未开或已熔断';
  if (msg.includes('404')) return '这个域名没有官方通道';
  if (msg === 'bad-output') return '他说胡话了';
  if (msg.includes('abort')) return '响应超时';
  return '网络不通';
}
let fallbackNoticed = false;

// 保存即测试：暗号走 ping 免费校验；客席钥匙打一次最小真调用
async function testPass() {
  const ch = officialChannelOf();
  if (!ch) return { ok: false, msg: '未填暗号' };
  try {
    const r = await fetch(`${location.origin}/api/llm/ping`, {
      headers: { authorization: `Bearer ${ch.apiKey}`, 'X-Device': deviceId() },
    });
    const j = await r.json();
    if (!j.secrets) return { ok: false, msg: '官方通道未开（服务端没配 key）' };
    if (j.pass !== true) return { ok: false, msg: '暗号不对' };
    // 配额读数：连不上从猜谜变读数——额度见底时这里一眼可见
    const usage = j.deviceUsed != null ? ` · 今日 ${j.deviceUsed}/${j.deviceLimit}` : '';
    return { ok: true, msg: `已连通${usage}` };
  } catch {
    return { ok: false, msg: '这个域名没有官方通道' };
  }
}
async function testGuest(cfg) {
  try {
    await chat(withGuestHeaders(cfg), { system: '连通测试', user: '回复一个字', maxTokens: 4, timeoutMs: 8000 });
    return { ok: true, msg: '已连通' };
  } catch (e) {
    return { ok: false, msg: friendlyError(e?.message ?? '') };
  }
}

function deviceId() {
  let id = localStorage.getItem('kai.device.v1');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('kai.device.v1', id);
  }
  return id;
}

// ---------- 台词气泡（打字机，不阻塞输入 §3.5；每席位独立） ----------
function bubbleEl(seat) {
  if (isTrio()) {
    const el = document.querySelector(`#strip-${seat} .strip-bubble`);
    if (el) return el;
  }
  return $('bubble');
}
function speak(text, seat = 'B') {
  if (!text) return;
  const b = bubbleEl(seat);
  b.classList.remove('hidden', 'silent');
  clearInterval(typeTimers[seat]);
  let i = 0;
  b.textContent = '';
  typeTimers[seat] = setInterval(() => {
    b.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(typeTimers[seat]);
  }, Math.max(4, 28 / watchSpeed));
}
function muteBubble() {
  for (const k of Object.keys(typeTimers)) clearInterval(typeTimers[k]);
  $('bubble').classList.add('hidden');
  document.querySelectorAll('.strip-bubble').forEach((el) => el.classList.add('hidden'));
}

// ---------- 渲染 ----------
function ob() {
  return match.observe('A');
}
function lastEvent(o, type) {
  return o.events.findLast((e) => e.type === type);
}

// 经典面额：白1 红5 绿25 黑100，贪婪分解——颜色即量级
const DENOMS = [
  [100, 'd100'],
  [25, 'd25'],
  [5, 'd5'],
  [1, 'd1'],
];
function tokensOf(amount) {
  const out = [];
  let v = Math.max(0, Math.round(amount));
  for (const [d, cls] of DENOMS) while (v >= d) { out.push([d, cls]); v -= d; }
  return out;
}
const tokenHtml = ([d, cls], extra = '') =>
  `<span class="chip-dot ${cls} ${extra}"><i>${d}</i></span>`;

// 池筹码堆：按面额显示，追注时新筹飞入带声（§2.2 池肥可见）；高倍池红光
function renderPotChips(n, hot) {
  const el = $('potChips');
  el.classList.toggle('hot', !!hot);
  const toks = tokensOf(n);
  const key = toks.map((t) => t[0]).join(',');
  if (el.dataset.key !== key) {
    const grew = n > +(el.dataset.n || 0);
    if (grew && +el.dataset.n) sfx.chips();
    el.innerHTML = toks
      .map((t, i) => tokenHtml(t, grew && i >= toks.length - 2 ? (i % 2 ? 'pop' : 'pop-up') : ''))
      .join('');
    el.dataset.key = key;
    el.dataset.n = n;
  }
}

// 宣言：红章拍在桌面上
function stampFx(text) {
  const s = document.createElement('div');
  s.className = 'stamp-fx';
  s.innerHTML = `<span>${text}</span>`;
  $('app').appendChild(s);
  sfx.stamp();
  setTimeout(() => s.remove(), 700);
}

// 结算高潮：筹码从池心飞向赢家侧的落袋点，大数字在落点接住每一枚（爽感预算的第二拍）
const punch = (el, cls = 'punch') => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

async function chipFlight(ov, amount, youWin) {
  const stage = document.createElement('div');
  stage.className = 'chip-flight';
  ov.appendChild(stage);
  // 数字永远站你这侧——这是你的账（＋N/−N 都是你的变化）；筹码流才表达钱的去向
  const amt = document.createElement('div');
  amt.className = `win-amt ${youWin ? 'win' : 'lose'}`;
  amt.style.top = '78%';
  amt.textContent = youWin ? '＋0' : '−0';
  stage.appendChild(amt);
  const toks = tokensOf(amount).slice(0, 14);
  const n = toks.length;
  toks.forEach(([d, cls], i) => {
    const c = document.createElement('span');
    c.className = `chip-dot ${cls}`;
    c.innerHTML = `<i>${d}</i>`;
    c.style.setProperty('--dx', `${Math.random() * 90 - 45}px`);
    c.style.setProperty('--dy', `${youWin ? 215 + Math.random() * 45 : -(300 + Math.random() * 55)}px`);
    c.style.animationDelay = `${i * 90}ms`;
    stage.appendChild(c);
    setTimeout(() => {
      sfx.coin();
      punch(amt); // 每枚落袋，数字弹一下
    }, i * 90 + 450);
  });
  // 数字滚动与筹码流同步。rAF 在页面不可见时被冻结——必须有超时兜底，否则整场演出卡死
  const dur = n * 90 + 450;
  const t0 = performance.now();
  await new Promise((done) => {
    const finish = () => {
      amt.textContent = youWin ? `＋${amount}` : `−${amount}`;
      done();
    };
    const guard = setTimeout(finish, dur + 800);
    const roll = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const v = Math.round(amount * k);
      amt.textContent = youWin ? `＋${v}` : `−${v}`;
      if (k < 1) requestAnimationFrame(roll);
      else {
        clearTimeout(guard);
        done();
      }
    };
    roll();
  });
  // 收尾一记：slam ＋ 冲击波；大额加震屏
  punch(amt, 'slam');
  amt.insertAdjacentHTML('beforeend', '<span class="shockwave"></span>');
  sfx.jackpot();
  if (amount >= 8) {
    $('app').classList.add('shake');
    setTimeout(() => $('app').classList.remove('shake'), 400);
  }
  await sleep(700);
  stage.remove();
}

// 余额＝一手面额筹码＋数字：颜色即量级，输赢换手肉眼可见
function renderChips(id, balance) {
  const el = $(id);
  const toks = tokensOf(balance).slice(0, 10);
  const prev = +el.dataset.n || 0;
  el.classList.toggle('debt', balance < 0);
  el.innerHTML =
    `<span class="hand">${toks.map((t, i) => tokenHtml(t, i >= prev ? 'pop' : '')).join('')}</span>` +
    `<b>${balance}</b>`;
  el.dataset.n = toks.length;
}

// 结算：输赢额浮出，余额跳动
function showDelta(d) {
  for (const [id, v] of [['myChips', d], ['oppChips', -d]]) {
    const chip = $(id);
    const s = document.createElement('span');
    s.className = `delta ${v > 0 ? 'win' : 'lose'}`;
    s.textContent = v > 0 ? `＋${v}` : `−${-v}`;
    chip.parentElement.appendChild(s);
    setTimeout(() => s.remove(), 1500);
    chip.classList.add('pulse');
    setTimeout(() => chip.classList.remove('pulse'), 600);
  }
  sfx.chips();
}

function ensureSel(o) {
  const bids = allLegalBids(o.currentBid, o.zhai, o.diceCount.you + o.diceCount.opp);
  if (!bids.length) return null;
  if (!bids.some((b) => b.count === sel?.count && b.face === sel?.face)) sel = { ...bids[0] };
  return bids;
}

// 三人对手条：DOM 每场建一次（气泡与打字机不被 render 摧毁），render 只刷数据
function buildOppArea() {
  const trio = $('trioOpp');
  const duo = $('duoOpp');
  if (!isTrio()) {
    trio.classList.add('hidden');
    duo.classList.remove('hidden');
    $('seal').classList.remove('hidden');
    $('seal').textContent = SEAT_PERSONA.B.seal;
    $('oppName').textContent = SEAT_PERSONA.B.name;
    return;
  }
  duo.classList.add('hidden');
  trio.classList.remove('hidden');
  $('seal').classList.add('hidden');
  $('oppName').textContent = room ? '好友房' : '三人桌';
  trio.innerHTML = seats
    .slice(1)
    .map((s) => {
      const per = SEAT_PERSONA[s];
      return `<div class="opp-strip" id="strip-${s}">
        <div class="strip-head">
          <span class="seal mini">${per.seal}</span><b>${per.name}</b>
          <span class="brain hidden" id="brain-${s}"></span>
          <span class="thinking"><i></i><i></i><i></i></span>
        </div>
        <div class="dicerow strip-dice" id="dice-${s}"></div>
        <div class="chips strip-chips" id="meta-${s}"></div>
        <div class="strip-bubble hidden"></div>
      </div>`;
    })
    .join('');
}

function renderTrio(o) {
  for (const s of seats.slice(1)) {
    const ps = o.players.find((q) => q.id === s);
    const strip = document.querySelector(`#strip-${s}`);
    if (!strip) continue;
    strip.classList.toggle('out', !ps.alive);
    strip.classList.toggle('turn', o.turn === s && !o.over);
    const sh = o.shown?.[s] ?? [];
    $(`dice-${s}`).innerHTML = ps.alive
      ? sh.map((f) => dieHtml(f, `mini shown ${!o.zhai && f === 1 ? 'wild' : ''}`)).join('') +
        backHtml('mini').repeat(Math.max(0, ps.diceCount - sh.length))
      : '<i class="out-mark">出局</i>';
    renderChips(`meta-${s}`, ps.chips);
    const dot = $(`brain-${s}`);
    if (room) {
      // 好友房：状态由 roster 数据承载（代打/掉线标注在名字上），不摆 LLM 灯
      dot.className = 'brain hidden';
      const info = room.roster?.seats?.find((x) => x.seat === s);
      const nameEl = strip.querySelector('.strip-head b');
      if (info && nameEl)
        nameEl.textContent =
          info.name + (info.substituted ? '（老李头代打）' : info.kind === 'human' && !info.connected ? '（掉线）' : '');
    } else if (!chanForPersona(SEAT_PERSONA[s])) dot.className = 'brain hidden';
    else {
      const last = opponents[s]?.logs.findLast((l) => !l.auto); // 自动掀盅那一手不代表通道状态
      dot.className = 'brain ' + (last ? (last.silentFallback ? 'off' : 'on') : 'idle');
    }
  }
}

function render() {
  const o = ob();
  if (!o) return; // 好友房：首个 observe 未到
  const meAlive = o.players.find((q) => q.id === 'A').alive;
  const myTurn = o.turn === 'A' && !o.over && !busy && meAlive;

  if (isTrio()) renderTrio(o);
  else {
    // 镜像：他的暗骰与你的骰子同尺寸同位置——骰子行即血条；亮出的明骰面朝上（词条「亮」）
    const shB = o.shown?.B ?? [];
    $('oppDice').innerHTML =
      shB.map((f) => dieHtml(f, `shown ${!o.zhai && f === 1 ? 'wild' : ''}`)).join('') +
      backHtml().repeat(Math.max(0, o.diceCount.opp - shB.length));
    renderChips('oppChips', o.chips.opp);
  }

  // 池标记（Q22 全家福）：斋 / 各家盲 / 各家抬 / 深水线（第 6 手起自动 ×2）
  const marks =
    (o.zhai ? '<span class="mark">斋 ×1.5</span>' : '') +
    seats
      .filter((s) => o.blind[s])
      .map((s) => `<span class="mark">${dispName(s)}盲 ×2</span>`)
      .join('') +
    seats
      .filter((s) => o.raises?.[s])
      .map((s) => `<span class="mark">${dispName(s)}抬 ×2</span>`)
      .join('') +
    (o.potUnits - 1 >= 6 ? '<span class="mark">深水 ×2</span>' : '') +
    // 算盘是公开的（Q45）：谁算过挂在桌上——数字私有，动作公有
    seats
      .filter((s) => o.calced?.[s])
      .map((s) => `<span class="mark calc">${dispName(s)}算过</span>`)
      .join('');
  const aliveN = o.players.filter((q) => q.alive).length;
  $('roundTag').textContent = `${sandbox ? '实验 · ' : ''}第 ${o.round} 局`;
  $('pot').innerHTML = marks;
  renderPotChips(o.potUnits * aliveN, o.potMult > 1);

  // 中央只放对局物：报价者名＋报价大字；无报价时留白（思考状态由座位动画表达，不摆文字）
  const bidderTag = o.currentBid && isTrio() ? `<span class="bidder-tag">${dispName(o.currentBid.player)}：</span>` : '';
  $('bidBig').innerHTML = o.currentBid
    ? `${bidderTag}<span class="n">${o.currentBid.count}</span><span class="x">个</span>${dieHtml(o.currentBid.face, !o.zhai && o.currentBid.face === 1 ? 'wild' : '')}`
    : `<span class="none"></span>`;

  renderChips('myChips', o.chips.you);

  // 我的骰子：未看则盖着（点击=看骰）；盲局锁死；出局清空；亮出的带明标
  const mine = $('myDice');
  mine.classList.toggle('picking', !!(pickPending && myTurn && o.yourDice));
  if (!meAlive) {
    mine.innerHTML = '';
  } else if (o.yourDice) {
    const shownLeft = [...(o.shown?.A ?? [])];
    mine.innerHTML = o.yourDice
      .map((f) => {
        const k = shownLeft.indexOf(f);
        if (k >= 0) shownLeft.splice(k, 1);
        return dieHtml(f, `${!o.zhai && f === 1 ? 'wild' : ''} ${k >= 0 ? 'shown' : ''}`);
      })
      .join('');
    if (pickPending && myTurn)
      mine.querySelectorAll('.die').forEach((el, i) =>
        el.addEventListener('click', () => onPickDie(o.yourDice[i]), { once: true }),
      );
  } else {
    mine.innerHTML = backHtml().repeat(o.diceCount.you);
    if (!o.blind.A)
      mine.querySelectorAll('.die').forEach((el) =>
        el.addEventListener('click', onPeek, { once: true }),
      );
  }

  // 算盘位（F4／Q45）：桌面被动零显示——准数不是常驻攻略提示，是你主动亮出来的思考痕迹。
  // 拨算盘全桌可见（引擎事件），算出来的数只有算的人看得见（各自用自己的骰子算，§B.1 双发）。
  const g = $('gauge');
  const canCalc = myTurn && o.legal.some((a) => a.type === 'calc');
  const readable = !!o.currentBid; // 盲局/未看骰也能算——只是把自己那几颗也当未知（数照样是真的）
  const blindCalc = o.yourDice ? '' : '（没看骰：全按未知算）';
  let read = '';
  let note = '';
  if (o.calced?.A && readable) {
    const canCalza = o.legal.some((l) => modMetaOf(o, l.type)?.ops.includes('calzaResolve'));
    const exact = canCalza ? ` · 恰好 ${pct(obProbExact(o, o.currentBid))}` : '';
    read = `「${o.currentBid.count} 个 ${o.currentBid.face}」真 <b>${pct(obProb(o, o.currentBid))}</b>${exact}`;
    note = `只算骰面 · 不算人${blindCalc}`;
  } else if (inTraining() && readable) {
    // 训练轮：被动粗档扶手（毕业即拆）——粗档词与 AI 没算时看到的同一粒度（双发同粗）
    read = `「${o.currentBid.count} 个 ${o.currentBid.face}」<b>${coarseWord(obProb(o, o.currentBid))}</b>`;
    note = `训练轮 · 第 ${profile.matches + 1}/${TRAIN_MATCHES} 场${blindCalc}`;
  } else if (canCalc) {
    note = '全桌都看得见你在算';
  }
  if (!meAlive) {
    g.innerHTML = '出局 · 观战';
  } else {
    g.innerHTML =
      read +
      (canCalc ? `<button id="calcBtn" class="calc-btn">拨算盘</button>` : '') +
      (note ? `<i class="gauge-note">${note}</i>` : '');
    g.querySelector('#calcBtn')?.addEventListener('click', onCalc);
  }

  // 报数控件
  const bids = ensureSel(o);
  const cnt = $('cntVal');
  if (bids) {
    cnt.textContent = sel.count;
    const counts = [...new Set(bids.map((b) => b.count))];
    $('cntDown').disabled = !myTurn || sel.count <= counts[0];
    $('cntUp').disabled = !myTurn || sel.count >= counts.at(-1);
    const faces = bids.filter((b) => b.count === sel.count).map((b) => b.face);
    if (!faces.includes(sel.face)) sel.face = faces[0];
    $('facePick').innerHTML = [1, 2, 3, 4, 5, 6]
      .map(
        (f) =>
          `<button class="die ${f === sel.face ? 'sel' : ''}" data-f="${f}" ${
            !myTurn || !faces.includes(f) ? 'disabled' : ''
          }>${PIPS[f].map((p) => `<i class="p-${p}"></i>`).join('')}</button>`,
      )
      .join('');
    $('facePick')
      .querySelectorAll('button:not([disabled])')
      .forEach((el) =>
        el.addEventListener('click', () => {
          sel.face = +el.dataset.f;
          render();
        }),
      );
    // F4（Q45，P0）：报价按钮的实时百分比删除——按钮上挂个准数，等于把算盘焊在手上
    $('bidBtn').textContent = '报';
  } else {
    $('bidBtn').textContent = '—';
  }
  $('bidBtn').disabled = !myTurn || !bids;
  $('openBtn').innerHTML = '开<span class="bang">!</span>'; // 开谁由报价行具名；半角叹号手控间距防歪
  $('openBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'challenge'); // 让报回推时不能开自己的价
  $('blindBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'blind');
  $('zhaiBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'zhai');
  $('raiseBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'raise');
  // 词条章（实验桌）：可用性随 legal，拾取态高亮
  for (const a of labMods.flatMap((m) => m.actions)) {
    const btn = $(`modbtn-${a.type}`);
    if (!btn) continue;
    btn.disabled = !myTurn || !o.legal.some((x) => x.type === a.type);
    btn.classList.toggle('armed', pickPending?.type === a.type);
  }
  renderBetBar(o, meAlive); // 好友房：出局观战时的旁注条
  renderWatchBar(o, meAlive); // F1：出局后 4 倍速观战＋跳战报

  $('hint').textContent = hintFor(o, myTurn);

  // 连接状态点（duo；trio 各 strip 自带）：亮=在线，红=降级，灰=未开口
  const dot = $('brainDot');
  if (isTrio() || !chanForPersona(SEAT_PERSONA.B)) dot.className = 'brain hidden';
  else {
    const last = opponent?.logs.findLast((l) => !l.auto);
    dot.className = 'brain ' + (last ? (last.silentFallback ? 'off' : 'on') : 'idle');
  }

  syncBottomBand();
  checkVerbHitboxes(); // G1 的规矩：核心动词被盖住就当场喊
}

// 底部印章行占的那条带子要在流布局里留出来，否则短屏上居中的内容会压上去（G1）
function syncBottomBand() {
  const m = document.querySelector('main');
  if (!m) return;
  if ($('modRow')?.children.length) m.dataset.band = 'mods';
  else delete m.dataset.band;
}

// 首场只给最短操作指引（§2.5），规则全文在「规」页——桌面上只留对局
function hintFor() {
  return ''; // 设施不说话：教学归指引层，状态归数据（gauge/按钮）
}

// ---------- 计时（§2.4：超时＝最小抬价，本身即信号） ----------
// §2.4（Q19）：不设钟。turnStart 只做用时记录基准；挂机 >30s 人设催一句（循环换句，无机制后果）
function armIdle() {
  turnStart = performance.now();
  if (room) return; // 好友房：催话在服务端（老李头本人催）
  clearTimeout(idleTimer);
  const nag = () => {
    if (!atTable) return;
    const o = ob();
    if (o.turn !== 'A' || o.over || busy) return;
    const lines = opponent?.persona?.idle ?? [];
    if (lines.length) speak(lines[Math.floor(Math.random() * lines.length)], 'B');
    idleTimer = setTimeout(nag, IDLE_MS);
  };
  idleTimer = setTimeout(nag, IDLE_MS);
}
function disarmIdle() {
  clearTimeout(idleTimer);
}

// ---------- 玩家动作 ----------
async function onPeek() {
  if (busy) return;
  await match.act('A', { type: 'peek' });
  if (room) return; // 好友房：演出交给事件重放
  sfx.land();
  render();
  $('myDice').querySelectorAll('.die').forEach((el) => el.classList.add('reveal'));
  const o = ob();
  myDiceByRound[o.round] = o.yourDice;
}

// 拨算盘（Q45）：零成本、零假数——公开的是动作，私有的是结果。行动权仍在你。
async function onCalc() {
  if (busy) return;
  await match.act('A', { type: 'calc' }, { elapsedMs: performance.now() - turnStart });
  if (room) return; // 好友房：演出交给事件重放
  stampFx('算');
  sfx.tick();
  render();
}

const stampText = (d) => (d === 'blind' ? '盲 ×2' : d === 'zhai' ? '斋 ×1.5' : '抬 ×2');

async function onDeclare(declaration) {
  await match.act('A', { type: 'declare', declaration }, { elapsedMs: performance.now() - turnStart });
  if (room) return;
  stampFx(stampText(declaration));
  render();
}

async function onBid() {
  disarmIdle();
  pickPending = null;
  await match.act('A', { type: 'bid', ...sel }, { elapsedMs: performance.now() - turnStart });
  if (room) return;
  sfx.tick();
  render();
  driveTurn();
}

// ---------- G1 立的规矩：新增交互必须过"旧动词可点性"检查 ----------
// 教训（26 局压测）：「戳」上桌那天，算盘按钮就点不着了——新交互没抢走屏幕，
// 抢走的是**点击**。所以这条规矩不写在文档里写成代码：核心动词的中心点必须
// hit-test 回它自己，谁盖住了就当场在控制台喊，实机试玩时躲不掉。
const CORE_VERBS = ['calcBtn', 'bidBtn', 'openBtn', 'blindBtn', 'zhaiBtn', 'raiseBtn', 'cntUp', 'cntDown'];
// 大厅／抽屉／弹层本来就该盖住牌桌——那不是误触，是遮罩。会误报的规矩没人看，所以先让开。
const overlayUp = () => ['lobby', 'drawer', 'overlay'].some((id) => $(id) && !$(id).classList.contains('hidden'));
export function hitTestVerbs() {
  if (overlayUp()) return [];
  const bad = [];
  for (const id of CORE_VERBS) {
    const el = $(id);
    if (!el || el.disabled || el.offsetParent === null) continue; // 不在场/禁用的不算
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // 中心与上沿各探一次：拇指落点比几何中心更靠上，上沿被压住同样是"点不着"
    for (const [label, y] of [['中心', (r.top + r.bottom) / 2], ['上沿', r.top + 3]]) {
      const hit = document.elementFromPoint((r.left + r.right) / 2, y);
      if (hit && hit !== el && !el.contains(hit))
        bad.push(`${id} 的${label}被 ${hit.id || hit.className || hit.tagName} 盖住`);
    }
  }
  return bad;
}
let lastHitCheck = 0;
function checkVerbHitboxes() {
  const now = performance.now();
  if (now - lastHitCheck < 800) return; // 每秒至多一次：elementFromPoint 要强制布局
  lastHitCheck = now;
  const bad = hitTestVerbs();
  if (bad.length) console.warn('[可点性回归] 核心动词被盖住：', bad.join('；'));
}
if (typeof window !== 'undefined') window.__kaiHitTest = hitTestVerbs; // 手动跑：改完 UI 换几个屏高各跑一次

// ---------- 词条动作（实验桌）：章钮随本桌词条动态生成，语义由效果原子驱动 ----------
function buildModRow() {
  const row = $('modRow');
  row.innerHTML = '';
  pickPending = null;
  for (const a of labMods.flatMap((m) => m.actions)) {
    // 归一化成 observe 同款元数据形态（ops 由 effect 派生）——按钮语义只认原子
    const meta = {
      type: a.type,
      label: a.label,
      params: a.params ?? null,
      keepTurn: !!a.keepTurn,
      terminal: !!a.terminal,
      ops: a.effect.map((e) => e.op),
    };
    const btn = document.createElement('button');
    btn.className = 'stamp mod';
    btn.id = `modbtn-${a.type}`;
    btn.textContent = a.label;
    btn.addEventListener('click', () => onModButton(meta));
    row.appendChild(btn);
  }
}

// ---------- F9「戳他」（Q49 场合律的安全阀）----------
// 他的嘴解链之后，记歪不再是沉默的挫败——你可以当场戳回去，看他嘴硬、改口，还是拿着错账继续下注。
// 零打字：三枚短语。反应（hold/fold/ignore）由他自己交底，进档案的嘴硬率。
const POKES = ['你记错了', '你在演', '慢着'];
let pokeFeed = {}; // seat -> 注入该 AI 提示词的追加事实（与好友房 seatFacts 同款机制）

function buildPokeUI() {
  $('pokePanel')?.remove();
  $('pokeBtn')?.remove();
  if (room) return; // 好友房已有短语盘（服务端转发），F9 先只做单机/三人桌
  const btn = document.createElement('button');
  btn.className = 'stamp mod';
  btn.id = 'pokeBtn';
  btn.textContent = '戳';
  const panel = document.createElement('div');
  panel.id = 'pokePanel';
  panel.className = 'hidden';
  panel.innerHTML = POKES.map((p, i) => `<button class="phrase-chip" data-poke="${i}">${p}</button>`).join('');
  panel.addEventListener('click', (e) => {
    const i = e.target.dataset?.poke;
    if (i == null) return;
    panel.classList.add('hidden');
    doPoke(POKES[+i]);
  });
  btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  $('modRow').appendChild(btn);
  $('app').appendChild(panel);
}

function doPoke(text) {
  const live = seats.slice(1).filter((s) => opponents[s]);
  for (const s of live) pokeFeed[s]?.push(`客人当面戳了你一句："${text}"（他就是在反驳你刚才那句话）`);
  toastFx(`你拍了「${text}」`);
  sfx.tick();
  if (sandbox) return;
  for (const s of live) {
    const mind = mindOf(profile, SEAT_PERSONA[s].id);
    mind.pokes.count += 1;
  }
  saveProfile(profile);
}

async function onModButton(meta) {
  const o = ob();
  if (busy || o.turn !== 'A' || !o.legal.some((x) => x.type === meta.type)) return;
  if (meta.params === 'face') {
    // 亮一颗：拍章进入选骰模式，点自己一颗骰亮出；再拍一次取消
    pickPending = pickPending?.type === meta.type ? null : meta;
    render();
    return;
  }
  if (meta.ops.includes('calzaResolve')) return doShowdown('A', { actionType: meta.type });
  disarmIdle();
  pickPending = null;
  await match.act('A', { type: meta.type }, { elapsedMs: performance.now() - turnStart });
  stampFx(meta.label);
  render();
  driveTurn(); // keepTurn 动作行动权仍在你；让报则移交给报价者
}

async function onPickDie(face) {
  const meta = pickPending;
  pickPending = null;
  if (!meta || busy) return;
  await match.act('A', { type: meta.type, face }, { elapsedMs: performance.now() - turnStart });
  if (room) return;
  stampFx(modStamp(meta, { type: meta.type, face }));
  sfx.land();
  render();
}

// ---------- 回合调度（§2.5）：轮到谁驱动谁；AI 台词打字与下一位的网络请求并行（节拍 ≤4s） ----------
function driveTurn() {
  if (!atTable) return;
  if (room) return render(); // 好友房：服务端驱动一切，本地只渲染
  const o = ob();
  if (o.over) return;
  if (o.turn === 'A') {
    render();
    armIdle();
    return;
  }
  aiTurnFor(o.turn);
}

async function aiTurnFor(seat) {
  if (!atTable) return;
  const gen = matchGen;
  const o = match.observe(seat);
  if (o.over || o.turn !== seat) return;
  busy = true;
  render();
  const t0 = performance.now();
  const ai = opponents[seat];
  let d;
  try {
    d = await ai.decide(o);
  } catch (e) {
    // 决策链任何漏网异常都不许冻桌：退沉默 bot 行棋，桌子继续转
    d = { action: createSilentBot(ai.persona.strategy).decide(o), say: '', silentFallback: true, error: e?.message ?? 'decide-crash' };
  }
  if (gen !== matchGen) return; // 已离桌/换场：在途决策作废
  if (d.action.type === 'peek') {
    // 揭盅是公开动作（§2.3）——他看骰，你看得见
    await match.act(seat, d.action);
    if (gen !== matchGen) return;
    sfx.land();
    (isTrio()
      ? document.querySelectorAll(`#strip-${seat} .die`)
      : $('oppDice').querySelectorAll('.die')
    ).forEach((el) => el.classList.add('reveal'));
    busy = false;
    return aiTurnFor(seat);
  }
  // F9：被戳之后的三岔口由他自己交底（hold 嘴硬／fold 改口／ignore 没理）——进档案的嘴硬率
  if (d.reaction && !sandbox) {
    const pk = mindOf(profile, ai.persona.id).pokes;
    pk[d.reaction] = (pk[d.reaction] ?? 0) + 1;
    saveProfile(profile);
  }
  if (d.silentFallback && d.error && chanForPersona(ai.persona) && !fallbackNoticed) {
    fallbackNoticed = true;
    // 用 toast 而非 hint：hint 会被下一帧 render 抹掉——"额度用完"曾因此看起来像"AI 挂了"
    toastFx(`${NAMES[seat]}降级沉默（${friendlyError(d.error)}）`);
  }
  // 人设节奏：阿飞近乎秒出，老李头想得慢
  const floor = ai.persona.pace === 'fast' ? 350 + Math.random() * 350 : 900 + Math.random() * 800;
  await wsleep(Math.max(0, floor - (performance.now() - t0)));
  if (gen !== matchGen) return;
  const elapsedMs = performance.now() - t0;
  // F2 沉默模式的"被读"底线：没通道也得说出为什么开你（事实模板，零编造）
  if (d.action.type === 'challenge')
    return doShowdown(seat, { elapsedMs, sayText: d.say || silentSay(ai.persona, o) });
  const meta = modMetaOf(o, d.action.type);
  if (meta?.terminal) return doShowdown(seat, { elapsedMs, sayText: d.say, actionType: d.action.type });
  await match.act(seat, d.action, { elapsedMs });
  if (d.action.type === 'declare') stampFx(stampText(d.action.declaration));
  else if (d.action.type === 'calc') stampFx('算'); // 拨算盘全桌可见（Q45）
  else if (meta) stampFx(modStamp(meta, d.action));
  else sfx.tick();
  if (d.say) speak(d.say, seat);
  busy = false;
  // 算是 keepTurn：算完他接着行动（"算手＝两次调用"，配额口径见 SYNC）
  if (d.action.type === 'declare' || d.action.type === 'calc' || meta?.keepTurn) return aiTurnFor(seat);
  render();
  driveTurn(); // 让报把行动权推回报价者——可能是你，也可能是另一个 AI
}

// ---------- 开牌演出（juice 预算全在这一拍，§6）：开与掐共用摊牌，判定行分道 ----------
// 演出与流程解耦：presentShowdown 只管摊牌那一拍（本地局与好友房事件重放共用），
// doShowdown 是本地局的完整流程（act→演出→反思→报告/下一局）。
async function doShowdown(by, { elapsedMs = null, timeout = false, sayText = '', actionType = 'challenge' } = {}) {
  busy = true;
  disarmIdle();
  muteBubble();
  pickPending = null;
  if (by === 'A' && elapsedMs === null) elapsedMs = performance.now() - turnStart;
  await match.act(by, { type: actionType }, { elapsedMs, timeout });
  const o = ob();
  const rv = lastEvent(o, 'reveal');
  const re = lastEvent(o, 'roundEnd');
  await presentShowdown(rv, re, by, sayText);

  // §3.3 复盘学习触发①：被打脸的 AI 当场短反思（异步，不挡节拍；输入全为已公开信息）
  // 沙盒（获批反驳④）：实验局不喂档案——实验规则下的行为模式会污染对正常打法的读心
  for (const s of sandbox ? [] : seats.slice(1)) {
    if (re.loser !== s) continue;
    const ai = opponents[s];
    const ch = chanForPersona(ai.persona);
    if (!ch) continue;
    const mind = mindOf(profile, ai.persona.id);
    reflect(ch, { persona: ai.persona, factText: roundFactText(rv, re, s), hypotheses: mind.hypotheses })
      .then((hyps) => {
        if (hyps) {
          mergeHypotheses(mind, hyps, profile.matches + 1); // F8：立案时间跟着假设走
          saveProfile(profile);
        }
      });
  }

  const end = lastEvent(o, 'matchEnd');
  if (end) return showReport(end);
  finishShowdown(re);
  driveTurn();
}

async function presentShowdown(rv, re, by, sayText = '') {
  busy = true;
  const calza = !!rv.calza;
  const isMatch = (f) => f === rv.bid.face || (!rv.zhai && f === 1);
  sfx.slam();
  $('app').classList.add('shake');
  setTimeout(() => $('app').classList.remove('shake'), 400);
  const ov = $('overlay');
  ov.classList.remove('hidden');
  // 摊牌行：其他人在上，你压轴
  const seatsIn = [...Object.keys(rv.dice).filter((s) => s !== 'A'), ...(rv.dice.A ? ['A'] : [])];
  ov.innerHTML = `<div class="kai">${calza ? '掐！' : '开！'}</div>
    <div class="row-label">${dispName(by)}拍了桌子，${calza ? `掐${dispName(rv.bid.player)} · 验「恰好 ${rv.bid.count} 个 ${rv.bid.face}」` : `开${dispName(rv.bid.player)} · 验「${rv.bid.count} 个 ${rv.bid.face}」`}</div>
    ${seatsIn
      .map(
        (s) =>
          `<div><div class="row-label">${dispName(s)}</div><div class="dicerow" id="rv${s}"></div></div>`,
      )
      .join('')}
    <div class="count" id="rvCount"></div>
    <div class="verdict-line" id="rvLine"></div>`;
  await wsleep(500);
  // 逐颗揭骰
  for (const s of seatsIn) {
    const row = ov.querySelector(`#rv${s}`);
    for (const f of rv.dice[s]) {
      row.insertAdjacentHTML('beforeend', dieHtml(f, `reveal ${!rv.zhai && f === 1 ? 'wild' : ''}`));
      sfx.land();
      await wsleep(isTrio() ? 80 : 110);
    }
  }
  await wsleep(300);
  // 清点：命中发光，其余转暗
  let n = 0;
  const cnt = ov.querySelector('#rvCount');
  const allDice = seatsIn.flatMap((s) => rv.dice[s]);
  const dieEls = seatsIn.flatMap((s) => [...ov.querySelectorAll(`#rv${s} .die`)]);
  for (let i = 0; i < dieEls.length; i++) {
    if (isMatch(allDice[i])) {
      dieEls[i].classList.add('hit');
      cnt.textContent = `${++n}`;
      sfx.tick();
      await wsleep(isTrio() ? 110 : 140);
    } else {
      dieEls[i].classList.add('dark');
    }
  }
  await wsleep(350);
  cnt.textContent = calza
    ? `实有 ${rv.actual} 个 —— 掐「恰好 ${rv.bid.count}」，${rv.exact ? '掐中！' : '不恰'}`
    : `实有 ${rv.actual} 个 —— 报 ${rv.bid.count} 个，${rv.stands ? '成立' : '不成立'}`;
  ov.querySelector('#rvLine').innerHTML = calza
    ? rv.exact
      ? `${dispName(re.caller)}掐中——赢回一颗骰，收池`
      : `${dispName(re.caller)}掐空，掉一颗骰`
    : `${dispName(re.loser)}输了这局，掉一颗骰`;
  if (calza && rv.exact) sfx.jackpot();
  else sfx.loseDie();
  if (sayText) speak(sayText, by !== 'A' ? by : 'B'); // 只有角色自己的话才上屏
  await wsleep(600);
  const myDelta = re.transfers?.A ?? 0;
  if (myDelta !== 0) await chipFlight(ov, Math.abs(myDelta), myDelta > 0);
  await wsleep(1100);
}

// 摊牌后清场（非终局）：收 overlay、重置选择、观战提示
function finishShowdown(re) {
  const ov = $('overlay');
  ov.classList.add('hidden');
  sfx.shake();
  busy = false;
  sel = null; // 新局重置报价选择
  render();
  const myDelta = re.transfers?.A ?? 0;
  if (myDelta !== 0) showDelta(myDelta);
  const next = ob();
  myDiceByRound[next.round] = null;
  // 玩家出局后的观战态由算盘位与观战条承载（F1），此处不再另贴提示
}

// 反思素材：本局公开事实一句话（骰面已摊牌公开，合宪）
function roundFactText(rv, re, seat) {
  const who = (p) => (p === seat ? '你' : p === 'A' ? '客人' : NAMES[p]);
  const diceStr = Object.entries(rv.dice)
    .map(([q, d]) => `${who(q)}[${d.join(',')}]`)
    .join('，');
  return `第${re.round}局摊牌：${diceStr}。${who(rv.challenger)}开${who(rv.bid.player)}的「${rv.bid.count}个${rv.bid.face}」，实有${rv.actual}个，${rv.stands ? '成立' : '不成立'}——${who(re.loser)}输，付${re.transfer}注。`;
}

// 写死的结算话术已废（用户裁决"台词只能出自角色"）：AI 拍开时的台词来自它自己的决策；
// 玩家开它时，摊牌数据即结论，它的反应留给下一手 LLM（事件流里有完整摊牌）。沉默模式就沉默。

// ---------- 报告卡（§5.2：核心传播物） ----------
async function showReport(end) {
  const o = ob();
  const won = end.winner === 'A';
  // 沙盒经济（Q32）：实验局不入榜不入账不入档案——以下写回全部跳过
  if (!sandbox) {
    // 账本落袋（按人设分户头），下一场带着走
    const led = loadLedger();
    for (const s of seats.slice(1)) led.personas[SEAT_PERSONA[s].id] = end.chips[s];
    led.you = end.chips.A;
    saveLedger(led);
    // 每个在场 AI：本场行为统计＋对你战绩入其账（AI 的刻画数据，菜单展示）
    for (const s of seats.slice(1)) {
      const mind = mindOf(profile, SEAT_PERSONA[s].id);
      const aiStats = computeStats(o.events, s, diceByRoundOf(o.events, s));
      mind.stats = [
        ...mind.stats,
        {
          bluffRate: aiStats.bluffRate,
          hits: aiStats.myChallengeHits,
          opens: aiStats.myChallenges,
          blinds: aiStats.myBlinds,
        },
      ].slice(-10);
      mind.record.plays += 1;
      if (end.winner === s) mind.record.wins += 1; // 场胜：榜的胜率列
      if (end.standings && end.standings.indexOf(s) < end.standings.indexOf('A')) mind.record.beat += 1;
    }
  }
  const stats = computeStats(o.events, 'A', myDiceByRound);
  const byok = chanForPersona(opponent.persona); // 判词主笔（B 席）用自己的通道执笔
  const standingsLine = end.standings
    ? end.standings.map((s, i) => `${i + 1}. ${dispName(s)}`).join('　')
    : '';
  // F0（P0 违宪修正）：多人桌的账按人设归属拆分——别人和客人之间的事不是你的账。
  // 判词执笔者只拿"你与客人之间"的对局事实＋明确标注为全桌口径的公共数据。
  const vsMe = (seat) => stats.vs?.[seat] ?? { iOpened: 0, iOpenedHit: 0, theyOpenedMe: 0 };
  const duelText = (seat) => {
    const v = vsMe(seat);
    return `客人开你 ${v.iOpened} 次中 ${v.iOpenedHit} 次；你开客人 ${v.theyOpenedMe} 次`;
  };
  // 判词素材（Q15 证据分级）：一级决策事实＋二级条件倾向（心理侧，杀伤力最大）；
  // 用时是三级遥测——秒数不给，只有极端犹豫化成现象学一句
  const statsText =
    (isTrio()
      ? `三人桌，名次：${end.standings.map(dispName).join(' > ')}。你只写你自己名下的账：${duelText('B')}。` +
        `客人参战 ${stats.roundsAlive} 局，全桌打了 ${end.rounds} 局。以下为全桌口径的公共数据（不是你一个人打出来的）：`
      : `${end.rounds}局${won ? '客人赢' : '客人输'}；`) +
    `虚报率${pct(stats.bluffRate)}（只算他看过骰之后报的 ${stats.seenBids} 口）；` +
    (stats.blindBids
      ? `没看骰就报的有 ${stats.blindBids} 口${
          stats.blindWildest
            ? `，最狠一口是第 ${stats.blindWildest.round} 局的 ${stats.blindWildest.bid.count} 个 ${stats.blindWildest.bid.face}`
            : ''
        }；`
      : '') +
    (isTrio()
      ? `他全场开牌${stats.myChallenges}次命中${stats.myChallengeHits}次；全场被开${stats.timesChallenged}次`
      : `开牌${stats.myChallenges}次命中${stats.myChallengeHits}次；被开${stats.timesChallenged}次`) +
    (stats.myBlinds ? `；盲报${stats.myBlinds}次` : '') +
    (stats.myRaises ? `；拍抬${stats.myRaises}次` : '') +
    (stats.myCalzas ? `；掐${stats.myCalzas}次中${stats.myCalzaHits}次` : '') +
    `；拨算盘${stats.myCalcs}次` +
    (stats.calcFollowRate != null ? `（${pct(stats.calcFollowRate)}照着数走）` : '') +
    (sandbox ? `；本场为实验桌沙盒局，词条：${labMods.map((m) => m.name).join('、')}` : '') +
    (bigPotBrief(stats) ? `；高倍局（判词优先引用）：${bigPotBrief(stats)}` : '') + // F5 记忆加权
    (condBrief(stats) ? `；条件倾向（心理侧，判词优先引用）：${condBrief(stats)}` : '') +
    ((profile.resets ?? 0) > 0 ? `；此人历史上把账翻篇过${profile.resets}次` : '') +
    (stats.slowest && stats.slowest.ms > 8000
      ? `；全场最犹豫的一手：第${stats.slowest.round}局报${stats.slowest.bid.count}个${stats.slowest.bid.face}前他停了半天`
      : '');

  const ov = $('overlay');
  ov.classList.remove('hidden');
  const renderCard = (verdict) => {
    ov.innerHTML = `<div class="card fade-in">
      <h2>${sandbox ? '实验桌 · 沙盒对局' : `酒桌档案 · 第 ${profile.matches + 1} 场`}</h2>
      <div class="persona">${persona(stats)}</div>
      <dl>
        ${sandbox ? `<dt>词条</dt><dd>${labMods.map((m) => `「${m.name}」`).join('')}</dd>` : ''}
        ${isTrio() && end.standings ? `<dt>名次</dt><dd>${standingsLine}</dd>` : ''}
        <dt>胜负</dt><dd>${won ? '赢' : '输'}</dd>
        ${
          // F0：参战局数与全桌局数拆行——出局后桌子还在打，两个数不是一回事
          stats.roundsAlive === end.rounds
            ? `<dt>局数</dt><dd>${end.rounds} 局</dd>`
            : `<dt>局数</dt><dd>你参战 ${stats.roundsAlive} 局 · 全桌 ${end.rounds} 局</dd>`
        }
        <dt>身家</dt><dd>${end.chips.A}${end.chips.A <= 0 ? '（赊着）' : ''}${sandbox ? '（沙盒·不记账）' : ''}</dd>
        <dt>虚报率</dt><dd>${pct(stats.bluffRate)}${stats.seenBids ? `（看过骰的 ${stats.seenBids} 口）` : '（没看过骰）'}</dd>
        ${
          // F0c：蒙报单列——闭着眼报的价不进虚报率，但更要写在脸上
          stats.blindBids
            ? `<dt>蒙报</dt><dd>${stats.blindBids} 口${stats.blindWildest ? ` · 最狠 ${stats.blindWildest.bid.count} 个 ${stats.blindWildest.bid.face}` : ''}</dd>`
            : ''
        }
        <dt>开牌命中</dt><dd>${
          // F0：谁的账记谁头上——三人桌按对手拆开
          isTrio()
            ? seats.slice(1).map((s) => `对${NAMES[s]} ${vsMe(s).iOpenedHit}/${vsMe(s).iOpened}`).join(' · ')
            : `${stats.myChallengeHits}/${stats.myChallenges}`
        }</dd>
        ${stats.myCalzas ? `<dt>掐</dt><dd>${stats.myCalzaHits}/${stats.myCalzas}</dd>` : ''}
        <dt>被他开</dt><dd>${
          isTrio()
            ? seats.slice(1).map((s) => `${NAMES[s]} ${vsMe(s).theyOpenedMe} 次`).join(' · ')
            : `${stats.timesChallenged} 次`
        }</dd>
        <dt>算盘</dt><dd>${
          stats.myCalcs
            ? `${stats.myCalcs} 次${stats.calcFollowRate != null ? ` · ${pct(stats.calcFollowRate)} 照着数走` : ''}`
            : '一次没拨'
        }</dd>
        <dt>平均思考</dt><dd>${(stats.avgTimeMs / 1000).toFixed(1)} 秒</dd>
      </dl>
      <div class="verdict">${verdict}</div>
    </div>
    <div class="again-row">
      <button class="ghost" id="lobbyBtn">换桌</button>
      <button class="primary again" id="againBtn">再来一局</button>
    </div>
    <div class="review-row"><button class="linkish" id="reviewBtn">看看他当时怎么想的 →</button></div>
    <div class="small-note">${sandbox ? '实验局 · 不入榜不入账不入档案' : '截屏即可分享 · 这一场已记进他的本子'} · kai-dice.pages.dev</div>`;
    ov.querySelector('#againBtn').addEventListener('click', newMatch);
    ov.querySelector('#lobbyBtn').addEventListener('click', () => {
      ov.classList.add('hidden');
      showLobby();
    });
    ov.querySelector('#reviewBtn').addEventListener('click', () => openReview(o.events));
  };
  renderCard(byok ? `${opponent.persona.name}在写你的档案……` : templateVerdict(stats, won));

  let verdict = null;
  let note = '';
  if (byok) {
    const mindB = mindOf(profile, opponent.persona.id);
    const r = await settleVerdict(byok, {
      won,
      statsText,
      persona: opponent.persona,
      hypotheses: mindB.hypotheses,
      ledger: buildLedger(o), // F0b：判词里的账要对得上事件流，对不上就退模板
    });
    if (r) {
      ({ verdict, note } = r);
      // §3.3 触发②：场终全量复盘——修订后的规律假设入主观层（沙盒不喂）
      if (r.hypotheses && !sandbox) mergeHypotheses(mindB, r.hypotheses, profile.matches + 1);
    }
    renderCard(verdict ?? templateVerdict(stats, won));
  }
  if (sandbox) return; // 沙盒到此为止：判词照说，档案一字不写
  // 每个在场 AI 把观察记进自己的本子（档案双层：主观层私有）＋本场的诈留档（F7）
  for (const s of seats.slice(1)) {
    const ai = opponents[s];
    const mind = mindOf(profile, ai.persona.id);
    recordBaits(mind, ai.logs, profile.matches + 1); // 说一套想一套的时刻，下场可被自己揭底
    if (s === 'B') continue; // 主笔（B 席）的笔记经 appendMatch 记
    const extra = ai.logs.map((l) => l.note).filter(Boolean).slice(-2);
    mind.notes = [...mind.notes, ...extra].slice(-30);
  }
  const aiNotes = opponent.logs.map((l) => l.note).filter(Boolean).slice(-2);
  profile = appendMatch(profile, { won, stats, notes: [...aiNotes, note], personaId: opponent.persona.id });
}

// ---------- F8 复盘室「他的小本子」（Q48）：场终自选深潜 ----------
// 硬法：**禁事后供词**——右轨每一个字都来自当时的决策日志，散场后不再问模型"你当时怎么想"
// （事后合理化＝制造回忆）。零新增调用：全是模板与字段。
const PEEK_PUBLIC_KEY = 'kai.peekpub.v1'; // 反身彩蛋开关（默认开）
const peekIsPublic = () => localStorage.getItem(PEEK_PUBLIC_KEY) !== 'off';

function openReview(events) {
  const d = $('drawer');
  d.classList.remove('hidden');
  d.scrollTop = 0;
  const logsBySeat = Object.fromEntries(seats.slice(1).map((s) => [s, opponents[s]?.logs ?? []]));
  const tracks = reviewTracks(events, { logsBySeat, nameOf: dispName, you: 'A' });
  // 反身彩蛋：翻本子是公开事件——你看他的心，他知道你看过（默认开，可关）
  if (!sandbox && peekIsPublic()) {
    for (const s of seats.slice(1)) mindOf(profile, SEAT_PERSONA[s].id).peeks += 1;
    saveProfile(profile);
  }
  const innerHtml = (r) => {
    if (!r.inner) return '<div class="tr-inner mine">（你的手，你自己知道）</div>';
    const bits = [];
    if (r.inner.say) bits.push(`<b>说：</b>${r.inner.say}`);
    if (r.inner.belief) bits.push(`<b>想：</b>${r.inner.belief}`);
    else if (r.inner.note) bits.push(`<b>想：</b>${r.inner.note}`);
    if (r.inner.calcP) bits.push(`<b>算：</b>${r.inner.calcP}（只他自己看得见）`);
    if (r.inner.auto) bits.push('<i>（不用想：他不玩盲，上桌先掀盅）</i>');
    else if (r.inner.silent) bits.push('<i>（这一手没开口——通道断了，纯算数行棋）</i>');
    if (r.inner.reaction)
      bits.push(
        `<i>（被你戳了之后：${{ hold: '嘴硬到底', fold: '改了口', ignore: '装没听见' }[r.inner.reaction]}）</i>`,
      );
    return `<div class="tr-inner${r.inner.bait ? ' bait' : ''}">${
      r.inner.bait ? '<span class="bait-tag">诈</span>' : ''
    }${bits.join('<br>') || '（没留话）'}</div>`;
  };
  const roundHtml = (t) => {
    const out = t.outcome;
    const head = `第 ${t.round} 局${t.mult > 1 ? ` · 池 ×${t.mult}` : ''}${
      out ? ` · ${dispName(out.loser)}掉一颗骰` : ''
    }`;
    return `<details class="rv-round" ${t.spotlight ? 'open' : ''}>
      <summary>${head}${t.spotlight ? '<i class="spot">戏眼</i>' : ''}</summary>
      ${t.rows
        .map(
          (r) => `<div class="tr-row">
            <div class="tr-pub">${r.text}</div>
            ${innerHtml(r)}
          </div>`,
        )
        .join('')}
      ${
        t.reveal
          ? `<div class="tr-row"><div class="tr-pub">摊牌：${
              t.reveal.calza ? '掐' : '开'
            }「${t.reveal.bid.count} 个 ${t.reveal.bid.face}」，实有 ${t.reveal.actual} 个</div><div class="tr-inner mine">——</div></div>`
          : ''
      }
    </details>`;
  };
  // 假设的一生（跨场层核心）：立案 → 证据 → 反例 → 死亡
  const lifeHtml = (per) => {
    const mind = mindOf(profile, per.id);
    const card = (h, dead) => `<div class="hyp-card${dead ? ' dead' : ''}">
      <p class="hyp-text">「${h.text}」</p>
      <p class="hyp-life">立案：第 ${h.since ?? '?'} 场　证据 ${h.hits ?? 0}${
        h.misses?.length ? `　反例 ${h.misses.length}（${h.misses.join('、')}）` : ''
      }${dead ? `　<b>第 ${h.died} 场撤案</b>` : ''}</p>
    </div>`;
    const alive = (mind.hypotheses ?? []).map((h) => card(h, false)).join('');
    const dead = (mind.dead ?? []).slice(-4).map((h) => card(h, true)).join('');
    if (!alive && !dead) return '';
    return `<div class="book"><div class="book-head"><span class="seal mini">${per.seal}</span>${per.name}的假设</div>${alive}${dead}</div>`;
  };
  d.innerHTML = `<button class="close-x" id="closeDrawer">×</button>
    <h2>他的小本子</h2>
    <p class="p-idline">左边是桌上发生的事（引擎盖的章，错不了）；右边是他当时心里记下的——<b>真迹，不是真相</b>。他记成什么样就是什么样：记歪了、嘴硬了、把五次记成两次，那也是他当时的脑子。这些字都是当时留的，散场之后谁也改不了，包括他自己。</p>
    ${tracks.map(roundHtml).join('')}
    <h2>假设的一生</h2>
    ${seats.slice(1).map((s) => lifeHtml(SEAT_PERSONA[s])).join('') || '<p class="dim-line">他还没对你立过案。</p>'}
    <p class="dim-line" style="margin-top:1rem">${
      peekIsPublic() ? '你翻过这本子——这事他知道（可在设置里关掉）。' : '你翻本子的事没告诉他（设置里已关）。'
    }</p>`;
  d.querySelector('#closeDrawer').addEventListener('click', () => d.classList.add('hidden'));
}

// ---------- 档案渲染件（玩家页与局内抽屉共用） ----------
const statTableHtml = () =>
  profile.stats.length
    ? `<table class="stat-table"><tr><th>场</th><th>胜负</th><th>虚报</th><th>开牌</th></tr>${profile.stats
        .slice(-6)
        .map((s, i, arr) => {
          const idx = profile.stats.length - arr.length + i + 1;
          return `<tr><td>${idx}</td><td>${s.won === true ? '胜' : s.won === false ? '负' : '—'}</td><td>${Math.round(s.bluffRate * 100)}%</td><td>${s.myChallengeHits}/${s.myChallenges}</td></tr>`;
        })
        .join('')}</table>`
    : '';

// 每个 AI 一本账（遍历花名册，人设可增）：身份行＋行为数据＋对你战绩＋假设＋笔记
const bookHtml = (per, extraBits = []) => {
  const mind = mindOf(profile, per.id);
  const agg = mind.stats.reduce(
    (a, s) => ({
      bids: a.bids + 1,
      bluff: a.bluff + (s.bluffRate ?? 0),
      hits: a.hits + (s.hits ?? 0),
      opens: a.opens + (s.opens ?? 0),
      blinds: a.blinds + (s.blinds ?? 0),
    }),
    { bids: 0, bluff: 0, hits: 0, opens: 0, blinds: 0 },
  );
  const dataBits = [...extraBits];
  if (mind.record.plays) dataBits.push(`对你 ${mind.record.plays} 战 ${mind.record.beat} 胜`);
  // F9：戳他的账——嘴硬率是这个对手的性格读数（你读他的通道）
  if (mind.pokes?.count)
    dataBits.push(
      `被戳 ${mind.pokes.count} 次${
        mind.pokes.hold + mind.pokes.fold ? ` · 嘴硬 ${mind.pokes.hold} 改口 ${mind.pokes.fold}` : ''
      }`,
    );
  if (agg.bids) {
    dataBits.push(`虚报 ${Math.round((agg.bluff / agg.bids) * 100)}%`);
    dataBits.push(`开牌 ${agg.hits}/${agg.opens}`);
    dataBits.push(agg.blinds ? `盲 ${agg.blinds} 次` : '不盲');
  }
  const hyps = (mind.hypotheses ?? [])
    .map(
      (h) =>
        `<p class="hyp">「${h.text}」<span class="tally">${'✓'.repeat(Math.min(h.hits ?? 0, 5))}${
          h.misses?.length ? ` <i>✗${h.misses.join(' ✗')}</i>` : ''
        }</span></p>`,
    )
    .join('');
  const notes = mind.notes.slice(-4).map((n) => `<p class="note-item">${n}</p>`).join('');
  return `<div class="book">
    <div class="book-head"><span class="seal mini">${per.seal}</span>${per.name}<span class="book-tag">${per.tag ?? ''}</span></div>
    ${dataBits.length ? `<p class="book-stats">${dataBits.join(' · ')}</p>` : ''}
    ${hyps + notes || '<p class="dim-line">暂无记录</p>'}
  </div>`;
};

// ---------- 抽屉（大厅：规矩/设置；局内：档案/规矩/封印/离桌——身家与玩家页在大厅的榜上） ----------
function openDrawer(section, inLobby = false) {
  const d = $('drawer');
  if (!inLobby) disarmIdle(); // 看规矩不吃决策钟；关闭时重开当轮
  d.classList.remove('hidden');
  const rsNow = !inLobby && match ? lastEvent(ob(), 'roundStart') : null;
  const lastStat = profile.stats.at(-1);
  const insight = lastStat ? condBrief(lastStat) : '';
  d.innerHTML = `<button class="close-x" id="closeDrawer">×</button>
    <nav class="drawer-nav">${
      inLobby
        ? '<a href="#secRules">规矩</a><a href="#secWho">对面是谁</a><a href="#secBrain">设置</a>'
        : `<a href="#profileSec">档案</a><a href="#secRules">规矩</a><a href="#secWho">对面是谁</a>${labMods.length ? '<a href="#secMods">词条</a>' : ''}<a href="#secSeal">封印</a><a class="leave" id="leaveBtn">离桌</a>`
    }</nav>
    ${
      inLobby
        ? ''
        : `<h2 id="profileSec">你的账</h2>
    ${profile.matches ? `<p class="book-stats">${profile.matches} 场 ${profile.wins} 胜${(profile.resets ?? 0) > 0 ? ` · 翻篇 ${profile.resets} 次` : ''}</p>` : ''}
    ${insight ? `<p class="insight">破绽：${insight}</p>` : ''}
    ${statTableHtml()}

    <h2>他们的本子</h2>
    ${rosterAll().map((per) => bookHtml(per)).join('')}`
    }

    <h2 id="secRules">规矩</h2>
    <ul>
      <li>轮流报「桌上共有几个几」。<b>只能往上抬</b>：数量加大，或同数量、点数加大——抬不动了就只能开。</li>
      <li><b>1 点是万能牌</b>（癞子），清点时算作任意点数；宣「斋」的那一局失效。</li>
      <li>开只开上家：数够，开的人输；不够，报的人输。输家掉一骰，掉光出局。</li>
      <li>每报一手，全桌各追 1 注；开牌胜者收整池。</li>
      <li>三印的代价（倍率对全桌双向生效，赢多输也多）：盲＝没看骰就能宣、宣了整局不看，池×2　｜　斋＝首报者宣，1 不作癞子，池×1.5　｜　抬＝轮到你拍章，池×2，每人每局一次。</li>
      <li>第 6 手报价起进深水：池自动再 ×2。倍率全部相乘。</li>
      <li><b>算盘</b>：桌面平时不显示概率。轮到你时可拨一次算盘（本局限一次）——算出来的准数只有你看得见，但"你在算"全桌都看得见。他们也守同一条规矩。</li>
      <li><b>小本子</b>：一场打完可以翻开看他当时怎么想的（说的一套、想的一套都在）。**翻本子是公开的**——他知道你研究过他，下回可能拿这个开你玩笑（不想让他知道，设置里可以关）。</li>
      <li>白1 · 红5 · 绿25 · 黑100。不限时——但你手停多久，他们都记着。</li>
    </ul>

    <h2 id="secWho">对面是谁</h2>
    <ul>
      <li><b>模型是真身</b>：做决定的是一个语言模型。算不算、什么时候掀盅、开不开你这口价，都是它自己的判断。</li>
      <li><b>形象是化身</b>：名字、名章，外加一条明牌的座位规则（谁桌上有算盘、谁能宣盲）。化身换的是脸，不是脑子。</li>
      <li><b>提示词只管规则</b>：发给它的只有规则、输出格式、三条锁和一条内容底线（只评打法、不碰人身、不用脏话）——<b>没有性格剧本</b>。所以换个型号，你换到的是另一个对手。</li>
      <li><b>系统说话零容忍，他说话零审查</b>：结算、报告卡、档案统计、算盘由引擎复算，错了就是 bug；他的嘴可能记歪、可能夸大——那不是故障，那是对手。不服就「戳」他。</li>
      <li>站内的模型名只是事实性标注。本作与各模型厂商无关联、未获授权，不使用其商标与形象。<a href="about.html">说明页</a>写得更细。</li>
    </ul>

    ${
      !inLobby && labMods.length
        ? `<h2 id="secMods">词条（本桌明牌）</h2>${labMods
            .map((m) => `<p class="note-item"><b>「${m.name}」</b>${m.card}</p>`)
            .join('')}`
        : ''
    }
    ${
      inLobby
        ? ''
        : `<h2 id="secSeal">封印</h2>` +
          (rsNow
            ? Object.entries(rsNow.commits)
                .map(([s, c]) => `<p class="note-item"><b>${dispName(s)}</b>　<span class="mono-sm">${c}</span></p>`)
                .join('')
            : '')
    }
    ${
      !inLobby
        ? ''
        : `<h2 id="secBrain">设置</h2>
    <p class="dim-line">大厅第一席（${HOSTED_MODEL}）**不用配任何东西**，直接开局——那一席的账我们出，每天一份免费额度。下面这格是给化身用的。</p>
    <label>暗号（官方通道——解锁化身与更高额度）</label><input id="fPass" type="password" value="${loadPass()}">
    <div class="btnrow"><button class="primary" id="savePassBtn">保存</button></div>
    <div id="passTest" class="test-line"></div>
    <p class="dim-line">自带 API？在大厅的「客席」卡上填钥匙，你的模型以本名上桌。</p>
    <p class="dim-line" style="margin-top:1rem"><button id="peekPubBtn" class="linkish">翻小本子这件事：${peekIsPublic() ? '他知道（点此改为不告诉他）' : '不告诉他（点此改为公开）'}</button></p>
    <p class="dim-line" style="margin-top:1.4rem"><button id="wipeBtn" class="linkish">清空本地记录（档案·账本·战绩）</button></p>`
    }
    <p class="dim-line" style="margin-top:1rem"><a class="linkish" href="about.html" target="_blank">完整说明 →</a></p>`;
  if (section === 'profile') d.querySelector('#profileSec')?.scrollIntoView();
  else if (section === 'brain') d.querySelector('#secBrain')?.scrollIntoView();
  else d.scrollTop = 0;
  d.querySelector('#leaveBtn')?.addEventListener('click', leaveTable);
  d.querySelector('#closeDrawer').addEventListener('click', () => {
    d.classList.add('hidden');
    if (inLobby) return;
    const o = ob();
    if (o.turn === 'A' && !o.over && !busy) armIdle();
  });
  // 反身彩蛋开关（F8）：翻本子要不要算公开事件
  d.querySelector('#peekPubBtn')?.addEventListener('click', () => {
    localStorage.setItem(PEEK_PUBLIC_KEY, peekIsPublic() ? 'off' : 'on');
    openDrawer(section, inLobby);
  });
  // 清档重开：两段式确认；只清游戏记录，暗号/客席钥匙/设备号保留
  d.querySelector('#wipeBtn')?.addEventListener('click', (e) => {
    if (e.target.dataset.armed) {
      for (const k of ['kai.profile.v1', 'kai.ledger.v1', 'kai.lineup.v1', 'kai.table.v1', 'kai.coach.v1', 'kai.trained.v1'])
        localStorage.removeItem(k);
      location.reload();
    } else {
      e.target.dataset.armed = '1';
      e.target.textContent = '再点一次确认——档案、账本、战绩将全部清空（钥匙保留）';
      e.target.classList.add('wipe-armed');
    }
  });
  d.querySelector('#savePassBtn')?.addEventListener('click', async () => {
    savePass(d.querySelector('#fPass').value.trim());
    const btn = d.querySelector('#savePassBtn');
    const out = d.querySelector('#passTest');
    btn.disabled = true;
    out.className = 'test-line';
    out.textContent = '验证中…';
    const r = await testPass();
    btn.disabled = false;
    out.textContent = (r.ok ? '✓ ' : '✗ ') + r.msg;
    out.className = 'test-line ' + (r.ok ? 'ok' : 'bad');
    if (match) render(); // 大厅里开局前没有牌局可刷
    if (r.ok) setTimeout(() => d.classList.add('hidden'), 1200);
  });
}

// OpenRouter 模型挑选（A1，凭 Q52①）：**清单当场拉，不预置会腐烂的名单**。
// 拉不到就退回自由输入框（老路子照旧能用）——宁可让人自己敲，也不摆一份三个月前的幽灵名单。
let orCache = null;
function wireOpenRouterPicker(d) {
  const base = d.querySelector('#gBase');
  const box = d.querySelector('#orBox');
  const list = d.querySelector('#orList');
  const filter = d.querySelector('#orFilter');
  const note = d.querySelector('#orNote');
  const sync = () => box.classList.toggle('hidden', !isOpenRouter(base.value));
  base.addEventListener('input', sync);
  sync();
  d.querySelector('#gDS').addEventListener('click', () => {
    base.value = 'https://api.deepseek.com/v1';
    sync();
  });
  d.querySelector('#gOR').addEventListener('click', () => {
    base.value = OPENROUTER_BASE;
    d.querySelector('#gFmt').value = 'openai'; // OpenRouter 是 OpenAI 兼容口，Anthropic 模型也从这个口进
    sync();
  });

  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    let ms = orCache ?? [];
    if (q === '免费') ms = ms.filter((m) => m.free);
    else if (q === '便宜')
      ms = [...ms].filter((m) => !m.free && m.priceKnown).sort((a, b) => a.promptPrice - b.promptPrice);
    else if (q) ms = ms.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    list.innerHTML = ms
      .slice(0, 60)
      .map((m) => {
        const price = m.free
          ? '免费'
          : m.priceKnown
            ? `$${perMillion(m.promptPrice).toFixed(2)}/$${perMillion(m.completionPrice).toFixed(2)} 每百万`
            : '价格不定（路由型）';
        return `<button class="or-row" data-id="${m.id}"><b>${m.id}</b><span>${price}${m.reasoning ? ' · 思考型（慢且贵）' : ''}</span></button>`;
      })
      .join('');
    note.textContent = `清单 ${orCache?.length ?? 0} 个，显示 ${Math.min(ms.length, 60)} 个。`;
  };

  d.querySelector('#orLoad').addEventListener('click', async (e) => {
    e.target.disabled = true;
    note.textContent = '拉取中…';
    try {
      orCache = orCache ?? (await fetchModels()); // 清单是公开的：拉名单不用把钥匙递出去
      filter.classList.remove('hidden');
      list.classList.remove('hidden');
      draw();
    } catch {
      note.textContent = '清单拉不下来（网络或它那边的事）——照旧手敲 Model 就行。';
    }
    e.target.disabled = false;
  });
  filter.addEventListener('input', draw);
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.or-row');
    if (!row) return;
    d.querySelector('#gModel').value = row.dataset.id;
    note.textContent = `已选 ${row.dataset.id}`;
  });
}

// ---------- 客席配置（Q28）：自带钥匙，模型以本名入座 ----------
function openGuestConfig() {
  const d = $('drawer');
  d.classList.remove('hidden');
  d.scrollTop = 0;
  const g = loadGuest() ?? { baseUrl: '', apiKey: '', model: '', format: 'openai' };
  d.innerHTML = `<button class="close-x" id="closeDrawer">×</button>
    <h2>客席</h2>
    <p class="p-idline">自带钥匙，让你的模型以本名上桌——素颜，无人设，只守规矩。换模型＝换人，各记各的账。钥匙只存这台设备，浏览器直连模型商。</p>
    <label>Base URL</label><input id="gBase" value="${g.baseUrl}" placeholder="https://api.deepseek.com/v1">
    <p class="dim-line">一把钥匙开一屋子模型：<button class="linkish" id="gOR">用 OpenRouter</button>　·　<button class="linkish" id="gDS">用 DeepSeek</button></p>
    <label>API Key</label><input id="gKey" type="password" value="${g.apiKey}">
    <label>Model</label><input id="gModel" value="${g.model}" placeholder="deepseek-chat">
    <div id="orBox" class="hidden">
      <div class="btnrow" style="margin-top:0.5rem"><button class="ghost" id="orLoad">拉一份现在的模型清单</button></div>
      <input id="orFilter" class="hidden" placeholder="筛一筛：claude / deepseek / 便宜 / 免费">
      <div id="orList" class="or-list hidden"></div>
      <p id="orNote" class="dim-line"></p>
    </div>
    <label>格式</label><select id="gFmt">
      <option value="openai" ${g.format !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容</option>
      <option value="anthropic" ${g.format === 'anthropic' ? 'selected' : ''}>Anthropic</option>
    </select>
    <div class="btnrow"><button class="primary" id="saveGuestBtn">保存并试一手</button>${loadGuest() ? '<button class="ghost" id="clearGuestBtn">撤席</button>' : ''}</div>
    <div id="guestTest" class="test-line"></div>`;
  d.querySelector('#closeDrawer').addEventListener('click', () => d.classList.add('hidden'));
  wireOpenRouterPicker(d);
  d.querySelector('#clearGuestBtn')?.addEventListener('click', () => {
    saveGuest(null);
    d.classList.add('hidden');
    showLobby();
  });
  d.querySelector('#saveGuestBtn').addEventListener('click', async () => {
    const cfg = {
      baseUrl: d.querySelector('#gBase').value.trim(),
      apiKey: d.querySelector('#gKey').value.trim(),
      model: d.querySelector('#gModel').value.trim(),
      format: d.querySelector('#gFmt').value,
    };
    const btn = d.querySelector('#saveGuestBtn');
    const out = d.querySelector('#guestTest');
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      out.textContent = '✗ 三格都要填';
      out.className = 'test-line bad';
      return;
    }
    saveGuest(cfg); // 先落座再试嗓——试失败也保留，可live修
    btn.disabled = true;
    out.className = 'test-line';
    out.textContent = '验证中…';
    const r = await testGuest(cfg);
    btn.disabled = false;
    out.textContent = (r.ok ? '✓ ' : '✗ ') + r.msg;
    out.className = 'test-line ' + (r.ok ? 'ok' : 'bad');
    if (r.ok)
      setTimeout(() => {
        d.classList.add('hidden');
        showLobby();
      }, 900);
  });
}

// ==================== 好友房（Q29）：远程房间驱动 ====================
// 服务端权威＋座位重映射（自己恒为 A）之后，本节只做四件事：
// 入房流程、事件重放（把服务端事件译成既有演出）、等位/报告界面、短语盘与旁注。

const myStoredSeal = () => localStorage.getItem('kai.seal.v1');

// 名章挑选（裁决②：零自由文本下的命名）——一次挑定，跨房复用。
// 大厅还开着时弹（z-index 50），弹层必须临时置顶，否则被大厅盖住＝"按钮点了没反应"
function pickSeal(cb) {
  if (myStoredSeal()) return cb();
  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.classList.add('ontop');
  ov.innerHTML = `<div class="card fade-in"><h2>挑一枚名章</h2>
    <p class="p-idline">好友房里没有名字，只有章——桌上喊你就喊这个字。</p>
    <div class="seal-pick">${SEALS.map((s) => `<button class="seal" data-s="${s}">${s}</button>`).join('')}</div>
    <p class="dim-line" style="margin-top:0.8rem"><button class="linkish" id="sealCancel">先不了</button></p></div>`;
  const done = () => {
    ov.classList.add('hidden');
    ov.classList.remove('ontop');
  };
  ov.querySelector('#sealCancel').addEventListener('click', done);
  ov.querySelectorAll('[data-s]').forEach((el) =>
    el.addEventListener('click', () => {
      localStorage.setItem('kai.seal.v1', el.dataset.s);
      done();
      cb();
    }),
  );
}

function toastFx(text) {
  const t = document.createElement('div');
  t.className = 'toast-fx';
  t.textContent = text;
  $('app').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function enterRoom({ roomId, hostKey = null }) {
  atTable = true;
  matchGen++;
  muteBubble();
  labMods = [];
  sandbox = false;
  $('lobby').classList.add('hidden');
  seats = ['A', 'B', 'C'];
  SEAT_PERSONA = { B: PERSONAS.laolitou, C: { seal: '客', name: '朋友', idle: [], pace: 'fast' } };
  NAMES = { A: '客人', B: '老李头', C: '朋友' };
  document.documentElement.style.setProperty('--persona-verdict', "'老李头批：'");
  myDiceByRound = {};
  sel = null;
  busy = false;
  pickPending = null;
  room = {
    id: roomId,
    isHost: !!hostKey,
    roster: null,
    lastPhase: null,
    replayed: 0,
    lastChallenger: null,
    pendingReport: null,
    matchEnded: false,
    queue: Promise.resolve(),
    pendingSays: [],
  };
  const myRoom = room;
  const guard = (fn) => (...a) => {
    if (room === myRoom) fn(...a);
  };
  room.net = joinRoom({
    room: roomId,
    hostKey,
    device: deviceId(),
    seal: myStoredSeal() ?? undefined,
    pass: hostKey ? loadPass() : null, // AI 调用计房主配额（暗号只从主家带上桌）
    handlers: {
      onRoom: guard(onRoomRoster),
      onOb: guard(queueReplay),
      onSay: guard((m) => {
        if (busy) room.pendingSays.push(m);
        else speak(m.text, m.seat);
      }),
      onPhrase: guard((m) => showPhrase(m.seat, m.id)),
      onBet: guard((m) => toastFx(`${dispName(m.bettor)}押${dispName(m.on)}赢这拍 · ${m.amount} 注`)),
      onBetResult: guard((m) =>
        toastFx(
          m.bettor === 'A'
            ? m.hit
              ? `旁注押中 ＋${m.amount}`
              : `旁注押空 −${m.amount}`
            : `${dispName(m.bettor)}的旁注${m.hit ? '押中了' : '押空了'}`,
        ),
      ),
      onReport: guard((m) => {
        room.pendingReport = m;
        tryShowRoomReport();
      }),
      onErr: guard((msg) => toastFx(msg)),
      onDown: guard(() => toastFx('连接断了，重连中…')),
      onUp: guard(() => {}),
    },
  });
  match = room.net.matchLike;
  buildOppArea();
  buildModRow(); // 好友房 v1 不带词条（裁决④）：清空词条章
  buildPhraseUI();
  render();
  showRoomWait();
}

function onRoomRoster(m) {
  const wasPlaying = room.lastPhase === 'playing';
  room.roster = m;
  room.lastPhase = m.phase;
  const c = m.seats.find((x) => x.seat === 'C');
  if (c?.occupied) {
    SEAT_PERSONA.C = { seal: c.seal, name: c.name, idle: [], pace: 'fast' };
    NAMES.C = c.name;
    buildOppArea();
  }
  if (m.phase === 'waiting') showRoomWait();
  else if (m.phase === 'playing' && !wasPlaying && !busy) $('overlay').classList.add('hidden');
  render();
}

// ---------- 事件重放：服务端事件 → 既有演出（一次一个，摊牌动画期间排队） ----------
function queueReplay() {
  const myRoom = room;
  room.queue = room.queue
    .then(() => (room === myRoom ? replayRoomEvents() : null))
    .catch(() => {});
}

async function replayRoomEvents() {
  const o = ob();
  if (!o) return;
  if (o.events.length < room.replayed) {
    // 新的一场（事件流从头来）：重置重放游标与局部状态
    room.replayed = 0;
    room.matchEnded = false;
    room.pendingReport = null;
    room.lastChallenger = null;
    myDiceByRound = {};
    sel = null;
    busy = false;
  }
  for (;;) {
    const cur = ob();
    if (!cur || cur.events.length < room.replayed) return;
    if (room.replayed >= cur.events.length) break;
    const e = cur.events[room.replayed++];
    await presentRoomEvent(e);
  }
  render();
  flushSays();
  tryShowRoomReport();
}

async function presentRoomEvent(e) {
  switch (e.type) {
    case 'roundStart':
      sel = null;
      render();
      return;
    case 'peek':
      if (e.player !== 'A') {
        sfx.land();
        document.querySelectorAll(`#strip-${e.player} .die`).forEach((el) => el.classList.add('reveal'));
      } else render();
      return;
    case 'bid':
      sfx.tick();
      render();
      return;
    case 'calc':
      stampFx('算'); // 拨算盘是公开动作：房里谁算了，两端都看得见
      render();
      return;
    case 'declare':
      stampFx(stampText(e.declaration));
      render();
      return;
    case 'challenge':
      room.lastChallenger = e.player;
      return;
    case 'reveal': {
      const o = ob();
      const next = o.events[room.replayed];
      const re = next?.type === 'roundEnd' ? (room.replayed++, next) : { transfers: {}, diceCount: {} };
      muteBubble();
      await presentShowdown(e, re, e.challenger ?? room.lastChallenger ?? 'B');
      const ended = ob()?.over || ob()?.events.slice(0, room.replayed + 1).some((x) => x.type === 'matchEnd');
      if (!ended) finishShowdown(re);
      flushSays();
      return;
    }
    case 'roundEnd':
      return; // 已随 reveal 同拍消费
    case 'matchEnd':
      room.matchEnded = true;
      busy = false;
      return;
    default:
      return;
  }
}

function flushSays() {
  if (!room || busy) return;
  for (const m of room.pendingSays.splice(0)) speak(m.text, m.seat);
}

function showPhrase(seat, id) {
  const text = PHRASES[id];
  if (text == null) return;
  if (seat === 'A') toastFx(`你拍了「${text}」`);
  else speak(`「${text}」`, seat);
}

// 短语盘（裁决③）：人类间唯一社交动词——「话」章开面板，拍一句全桌可见
function buildPhraseUI() {
  $('phrasePanel')?.remove();
  const btn = document.createElement('button');
  btn.className = 'stamp mod';
  btn.id = 'phraseBtn';
  btn.textContent = '话';
  const panel = document.createElement('div');
  panel.id = 'phrasePanel';
  panel.className = 'hidden';
  panel.innerHTML = PHRASES.map((p, i) => `<button class="phrase-chip" data-i="${i}">${p}</button>`).join('');
  panel.addEventListener('click', (e) => {
    const i = e.target.dataset?.i;
    if (i != null) {
      room?.net.phrase(+i);
      panel.classList.add('hidden');
    }
  });
  btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  $('modRow').appendChild(btn);
  $('app').appendChild(panel);
}

// F1 观战条：出局后这桌就不是你的戏了——默认 4 倍速，想直接看结果就跳战报。
// 只在本地局出现：好友房的节奏在服务端，本地快进给不了承诺。
function renderWatchBar(o, meAlive) {
  const show = !room && !meAlive && !o.over;
  watchSpeed = room ? 1 : skipToReport ? 40 : meAlive ? 1 : 4;
  let bar = $('watchBar');
  if (!bar) {
    if (!show) return;
    bar = document.createElement('div');
    bar.id = 'watchBar';
    $('app').appendChild(bar);
  }
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  bar.innerHTML =
    `<span>观战 · ${skipToReport ? '快进中' : '4×'}</span>` +
    (skipToReport ? '' : '<button class="phrase-chip" id="skipBtn">跳到战报</button>');
  bar.querySelector('#skipBtn')?.addEventListener('click', () => {
    skipToReport = true;
    muteBubble();
    render();
  });
}

// 观战旁注（Q37）：出局才有的按钮——押下一拍开牌谁赢（服务端管帽与结算）
function renderBetBar(o, meAlive) {
  let bar = $('betBar');
  if (!room) {
    bar?.classList.add('hidden');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'betBar';
    $('app').appendChild(bar);
  }
  const show = !meAlive && !o.over;
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  const alive = o.players.filter((q) => q.alive && q.id !== 'A');
  bar.innerHTML =
    `<span>旁注 · 押下一拍谁赢：</span>` +
    alive.map((q) => `<button class="phrase-chip" data-bet="${q.id}">${dispName(q.id)}</button>`).join('');
  bar.querySelectorAll('[data-bet]').forEach((el) =>
    el.addEventListener('click', () => room.net.bet(el.dataset.bet)),
  );
}

// ---------- 等位与报告 ----------
function showRoomWait() {
  if (!room || room.roster?.phase === 'playing') return;
  const ov = $('overlay');
  ov.classList.remove('hidden');
  const r = room.roster;
  const me = r?.seats.find((x) => x.seat === 'A');
  const c = r?.seats.find((x) => x.seat === 'C');
  const guestReady = c?.occupied && c?.connected;
  const link = `${location.origin}${location.pathname.replace(/index\.html$/, '')}#room=${room.id}`;
  ov.innerHTML = `<div class="card fade-in"><h2>好友房</h2>
    ${
      room.isHost
        ? `<p class="p-idline">链接甩给朋友，人到即坐。老李头占第三席当主持——他两个都读。</p>
    <p class="note-item mono-sm">${link}</p>
    <div class="btnrow"><button class="ghost" id="copyLink">复制链接</button></div>`
        : `<p class="p-idline">你在桌边坐下了。等主家开局。</p>`
    }
    <div class="wait-seats">
      <p class="note-item">「${me?.seal ?? myStoredSeal() ?? '主'}」你 · 已就座</p>
      <p class="note-item">「李」老李头 · 主持${room.isHost && !loadPass() ? '（无暗号：只行棋不说话）' : ''}</p>
      <p class="note-item">${c?.occupied ? `「${c.seal}」${c.name} · ${c.connected ? '已就座' : '掉线'}` : '空位 · 等好友点链接进来…'}</p>
    </div>
    ${room.isHost ? `<div class="btnrow"><button class="primary" id="roomStart" ${guestReady ? '' : 'disabled'}>开局</button></div>` : ''}
    <p class="dim-line" style="margin-top:0.8rem"><button class="linkish" id="roomLeaveWait">离开房间</button></p>
  </div>`;
  ov.querySelector('#copyLink')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(link);
      e.target.textContent = '已复制';
    } catch {
      prompt('手动复制：', link);
    }
  });
  ov.querySelector('#roomStart')?.addEventListener('click', () => room.net.start());
  ov.querySelector('#roomLeaveWait')?.addEventListener('click', leaveRoom);
}

// 双人对比报告卡（Q29 新分享物）：服务端算数、两端同卡
function tryShowRoomReport() {
  if (!room?.pendingReport || !room.matchEnded || busy) return;
  const m = room.pendingReport;
  const me = m.packs.A;
  const fr = m.packs.C;
  const pctf = (v) => `${Math.round((v ?? 0) * 100)}%`;
  const rows = [
    ['虚报率', pctf(me.bluffRate), pctf(fr.bluffRate)],
    ['开牌命中', `${me.challengeHits}/${me.challenges}`, `${fr.challengeHits}/${fr.challenges}`],
    ['被开', `${me.timesChallenged}`, `${fr.timesChallenged}`],
    ['盲 / 抬', `${me.blinds} / ${me.raises}`, `${fr.blinds} / ${fr.raises}`],
    ['身家', `${me.chips}`, `${fr.chips}`],
  ];
  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `<div class="card fade-in">
    <h2>好友房 · 第 ${m.matchNo} 场</h2>
    <div class="persona">${m.standings.map((s) => dispName(s)).join(' ＞ ')}</div>
    <table class="stat-table duel"><tr><th></th><th>你「${me.seal}」</th><th>「${fr.seal}」</th></tr>
      ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}
    </table>
    ${me.insight ? `<p class="insight">你的破绽：${me.insight}</p>` : ''}
    ${fr.insight ? `<p class="insight">「${fr.seal}」的破绽：${fr.insight}</p>` : ''}
    <p class="book-stats">老李头身家 ${m.ai.chips}</p>
    ${m.verdict ? `<div class="verdict">${m.verdict}</div>` : ''}
  </div>
  <div class="again-row">
    <button class="ghost" id="roomLeaveBtn">散伙</button>
    ${room.isHost ? '<button class="primary again" id="roomAgain">再来一局</button>' : '<span class="wait-note">等主家再开一局…</span>'}
  </div>
  <div class="small-note">截屏即可分享 · 好友房记房内账，不动各自本地账本 · kai-dice.pages.dev</div>`;
  ov.querySelector('#roomAgain')?.addEventListener('click', () => room.net.again());
  ov.querySelector('#roomLeaveBtn').addEventListener('click', leaveRoom);
}

function leaveRoom() {
  room?.net.close();
  room = null;
  match = null;
  atTable = false;
  matchGen++;
  muteBubble();
  disarmIdle();
  $('phrasePanel')?.remove();
  $('betBar')?.remove();
  $('overlay').classList.add('hidden');
  $('drawer').classList.add('hidden');
  if (location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname);
  showLobby();
}

// ---------- 许愿台（Q39 愿望编译器）：人话 → AST → 引擎回译确认 → 200 场冒烟 → 上桌 ----------
const wishChannel = () => guestChannelOf() ?? officialChannelOf(); // 编译调用 BYOK 优先（Q39）

function openWishPanel() {
  const d = $('drawer');
  d.classList.remove('hidden');
  d.scrollTop = 0;
  const chan = wishChannel();
  const wlog = loadWishLog();
  d.innerHTML = `<button class="close-x" id="closeDrawer">×</button>
    <h2>许愿台</h2>
    <p>想要一条这桌上没有的新规矩？用一句大白话写下来。接下来都是自动的：AI 把它翻成一张规则卡，先念给你听——你点头，桌子就自己试打两百场（看会不会卡死、会不会算错账）——全过了，这张卡就挂到下面的架子上，勾上就能开打。</p>
    <p>桌子会的动作有限，办不到的愿望会退回来，并告诉你差在哪。</p>
    <label>你的愿望（草稿只存在这台设备上）</label>
    <textarea id="wishText" rows="3" placeholder="例：每场一次，看过骰后我可以把赌注翻倍，并亮出自己一颗骰">${localStorage.getItem('kai.wishdraft.v1') ?? ''}</textarea>
    <div class="btnrow"><button class="primary" id="compileBtn" ${chan ? '' : 'disabled'}>许愿</button></div>
    ${chan ? '' : '<p class="test-line bad">许愿要先连上 AI：在「设置」里填暗号，或在大厅「客席」卡填自带钥匙</p>'}
    <div id="wishOut"></div>
    <h2>词条架</h2>
    <p>这桌会的新规矩都挂在这。「体检」＝重新试打一遍，再请老李头评一评这张卡带不带劲。</p>
    ${allMods()
      .map(
        (m) => `
      <div class="book">
        <div class="book-head">「${m.name}」<span class="book-tag">${m.origin === 'wish' ? '许愿' : '官方'}</span>
          <span class="spacer"></span>
          <button class="linkish" data-exam="${m.id}">体检</button>
          ${m.origin === 'wish' ? `<button class="linkish" data-del="${m.id}">撕掉</button>` : ''}
        </div>
        <p class="note-item">${m.card}</p>
        <div id="exam-${m.id}"></div>
      </div>`,
      )
      .join('')}
    ${
      wlog.length
        ? `<h2>没实现的愿望</h2><p class="dim-line">这些愿望超出了桌子现在会的动作。账都记着——等桌子学了新本事，它们就是第一批候选。</p>${wlog
            .slice(0, 8)
            .map((w) => `<p class="note-item">「${w.text}」<br>✗ ${w.reason}${w.missing ? `（差的本事：${w.missing}）` : ''}</p>`)
            .join('')}`
        : ''
    }`;
  d.querySelector('#closeDrawer').addEventListener('click', () => d.classList.add('hidden'));
  const ta = d.querySelector('#wishText');
  ta.addEventListener('input', () => localStorage.setItem('kai.wishdraft.v1', ta.value));
  d.querySelector('#compileBtn').addEventListener('click', () => runCompile(ta.value.trim(), d.querySelector('#wishOut')));
  d.querySelectorAll('[data-exam]').forEach((el) =>
    el.addEventListener('click', () => {
      const mod = allMods().find((m) => m.id === el.dataset.exam);
      if (mod) runExam(mod, $(`exam-${mod.id}`));
    }),
  );
  d.querySelectorAll('[data-del]').forEach((el) =>
    el.addEventListener('click', () => {
      saveWishes(loadWishes().filter((w) => w.id !== el.dataset.del));
      const l = loadLab();
      saveLab({ ...l, picks: l.picks.filter((x) => x !== el.dataset.del) });
      openWishPanel(); // 重绘
    }),
  );
}

async function runCompile(text, out) {
  if (!text) return;
  const chan = wishChannel();
  if (!chan) return;
  out.innerHTML = '<p class="test-line">AI 正在把你的愿望翻成规则卡…</p>';
  const r = await compileWish(text, chan, { existingTypes: activeTypes() });
  if (!r.ok) {
    if (!r.retryable) addWishLog({ text: text.slice(0, 60), reason: r.reason, missing: r.missing ?? null });
    out.innerHTML = `<p class="test-line bad">✗ ${r.reason}${r.missing ? `（差的本事：${r.missing}）` : ''}</p>${
      r.retryable ? '<p class="dim-line">网络没接上，等一下再试一次就行。</p>' : '<p class="dim-line">这条已记进「没实现的愿望」。换个提法也许就行。</p>'
    }`;
    return;
  }
  // 回译确认（Q39：锁编译幻觉）——作者点头，词条才生效
  out.innerHTML = `<div class="book"><div class="book-head">「${r.ast.name}」<span class="book-tag">规则卡草稿</span></div><p class="note-item">${r.card}</p></div>
    <p class="dim-line">上面这张卡就是你的愿望上桌后的样子——念出来的意思，和你想的一样吗？</p>
    <div class="btnrow"><button class="primary" id="wishGo">一样，试打两百场</button><button class="ghost" id="wishNo">不一样，改词重许</button></div>
    <div class="test-line" id="wishSmoke"></div>`;
  out.querySelector('#wishNo').addEventListener('click', () => (out.innerHTML = ''));
  out.querySelector('#wishGo').addEventListener('click', async () => {
    const line = out.querySelector('#wishSmoke');
    out.querySelector('#wishGo').disabled = true;
    const mod = { id: `wish-${r.ast.actions[0].type}`, name: r.ast.name, card: r.card, origin: 'wish', actions: r.ast.actions };
    const sm = await smokeMods([mod], { games: 200, onProgress: (g, n) => (line.textContent = `桌子自己试打中 ${g}/${n} 场…`) });
    if (!sm.ok || sm.uses === 0) {
      const reason = sm.ok
        ? '试打了两百场，这条规矩一次都没触发——出场条件定得太苛刻，把条件放宽点再许一次'
        : `试打时桌子出了乱子（${sm.errors[0]}），这张卡不能上桌`;
      addWishLog({ text: text.slice(0, 60), reason, missing: null });
      line.textContent = `✗ ${reason}`;
      line.className = 'test-line bad';
      return;
    }
    saveWishes([...loadWishes(), { id: mod.id, ast: r.ast, card: r.card }]);
    const l = loadLab();
    saveLab({ on: true, picks: [...new Set([...l.picks, mod.id])] });
    localStorage.removeItem('kai.wishdraft.v1');
    line.textContent = `✓ 两百场试打全过（这条规矩被用了 ${sm.uses} 次）。规则卡已挂上架子并勾选——回大厅点「开实验局」就能玩`;
    line.className = 'test-line ok';
  });
}

// 三门体检（词条上你桌前的自动前置；复活测试留给你本人当终审）
async function runExam(mod, out) {
  out.innerHTML = '<p class="test-line">体检中…</p>';
  const others = activeTypes().filter((t) => !mod.actions.some((a) => a.type === t));
  const r = await examMod(mod, {
    channel: wishChannel(),
    games: 200,
    existingTypes: others,
    onProgress: (g, n) => (out.innerHTML = `<p class="test-line">试打 ${g}/${n} 场…</p>`),
  });
  out.innerHTML = r.gates
    .map(
      (g) =>
        `<p class="test-line ${g.pass === true ? 'ok' : g.pass === false ? 'bad' : ''}">${
          g.pass === true ? '✓' : g.pass === false ? '✗' : '—'
        } ${g.name}：${g.detail}</p>`,
    )
    .join('');
}

// ---------- 选桌（开局前：先模式后对手；花名册数据驱动，人设只增不改代码） ----------
function showLobby() {
  const lb = $('lobby');
  const led = loadLedger();
  let mode = loadTable();
  let picked = loadLineup(mode);
  const need = () => (mode === 'duo' ? 1 : 2);
  // 卡上只放对局数据：对你战绩；没打过＝生面孔（身家在榜上）
  const dataOf = (per) => {
    const rec = mindOf(profile, per.id).record;
    return rec.plays ? `对你 ${rec.plays} 战 ${rec.beat} 胜` : '生面孔';
  };
  // 榜（平等公民）：你和他们同一种行——胜率＋身家，身家即座次；点行翻开玩家页
  const rateOf = (wins, plays) => (plays ? `${Math.round((wins / plays) * 100)}%` : '—');
  const boardHtml = () =>
    [
      { id: 'you', seal: '客', name: '你', bal: led.you, rate: rateOf(profile.wins, profile.matches) },
      ...rosterAll().map((per) => {
        const rec = mindOf(profile, per.id).record;
        return { id: per.id, seal: per.seal, name: per.name, bal: balanceOf(led, per.id), rate: rateOf(rec.wins, rec.plays) };
      }),
    ]
      .sort((a, b) => b.bal - a.bal)
      .map(
        (r, i) => `<button class="board-row ${r.id === 'you' ? 'me' : ''}" data-pg="${r.id}">
          <span class="rank">${i + 1}</span><span class="seal mini">${r.seal}</span><span class="board-name">${r.name}</span><span class="rate">${r.rate}</span><b${r.bal < 0 ? ' class="debt"' : ''}>${r.bal}</b>
        </button>`,
      )
      .join('');
  const draw = () => {
    const note =
      localStorage.getItem('kai.note.v1') === 'byok-moved'
        ? '<button class="lobby-note" id="lobbyNote">钥匙已分流：你的自带钥匙在「客席」卡上；官方人物（李/飞/账）只认「设置」里的暗号。点此收起</button>'
        : '';
    lb.innerHTML = `<div class="lobby-title">开！</div>
      ${note}
      <div class="board">${boardHtml()}</div>
      <div class="mode-row">
        <button class="mode-btn ${mode === 'duo' ? 'sel' : ''}" data-m="duo">单挑</button>
        <button class="mode-btn ${mode === 'trio' ? 'sel' : ''}" data-m="trio">三人桌</button>
      </div>
      <p class="mode-note">${
        mode === 'trio'
          ? '副席 · 朋友局／混沌局：热闹，但两个人分他的心——想被读透，回单挑。'
          : '正席 · 一整场他只读你一个人。'
      }</p>
      <div class="roster">${rosterAll()
        .map(
          (per) => `<button class="p-card ${picked.includes(per.id) ? 'sel' : ''}" data-p="${per.id}">
            <span class="seal">${per.seal}</span>
            <span class="p-info">
              <span class="p-name">${per.name}</span>
              <span class="p-sub">${per.tag ?? ''}</span>
              <span class="p-data">${dataOf(per)}</span>
            </span>
            ${per.bare && !per.hosted ? '<span class="card-edit" data-edit="1">改</span>' : ''}
          </button>`,
        )
        .join('')}${
        guestPersona()
          ? ''
          : `<button class="p-card add-guest" id="addGuest">
            <span class="seal">＋</span>
            <span class="p-info">
              <span class="p-name">客席</span>
              <span class="p-sub">自带钥匙 · 你的模型以本名上桌</span>
            </span>
          </button>`
      }</div>
      ${(() => {
        // 实验桌（Q32）：默认关；开着即沙盒。词条可多勾（获批反驳②：单轴纪律管毕业评审，不管沙盒并存）
        const lab = loadLab();
        return `<div class="lab-box">
        <button class="lab-head" id="labToggle"><span>实验桌</span><i class="${lab.on ? 'on' : ''}">${lab.on ? '开 · 沙盒' : '关'}</i></button>
        ${
          lab.on
            ? `<div class="lab-chips">${allMods()
                .map(
                  (m) =>
                    `<button class="lab-chip ${lab.picks.includes(m.id) ? 'sel' : ''}" data-mod="${m.id}">${m.name}${m.origin === 'wish' ? '<u>愿</u>' : ''}</button>`,
                )
                .join('')}<button class="lab-chip wish" id="wishBtn">许愿＋</button></div>
        <p class="lab-note">勾上的新规矩全桌明牌——对面读的是同一张卡。实验局随便造：不入榜、不记账、不进档案。</p>`
            : ''
        }
      </div>`;
      })()}
      <button class="primary" id="lobbyStart" ${picked.length === need() ? '' : 'disabled'}>${loadLab().on && pickedMods().length ? '开实验局' : '开局'}</button>
      <button class="mode-btn room-line" id="roomBtn">好友房 · 邀朋友同桌</button>
      <div class="lobby-links"><a id="lobbySettings">设置</a><a href="about.html">说明</a></div>`;
    lb.querySelectorAll('.mode-btn').forEach((el) =>
      el.addEventListener('click', () => {
        mode = el.dataset.m;
        picked = picked.slice(0, need());
        for (const id of Object.keys(rosterMap())) if (picked.length < need() && !picked.includes(id)) picked.push(id);
        draw();
      }),
    );
    lb.querySelector('#labToggle').addEventListener('click', () => {
      const l = loadLab();
      saveLab({ ...l, on: !l.on });
      draw();
    });
    lb.querySelectorAll('.lab-chip[data-mod]').forEach((el) =>
      el.addEventListener('click', () => {
        const l = loadLab();
        const id = el.dataset.mod;
        saveLab({ ...l, picks: l.picks.includes(id) ? l.picks.filter((x) => x !== id) : [...l.picks, id] });
        draw();
      }),
    );
    lb.querySelector('#wishBtn')?.addEventListener('click', openWishPanel);
    lb.querySelector('#roomBtn').addEventListener('click', () => {
      pickSeal(async () => {
        const btn = lb.querySelector('#roomBtn');
        btn.disabled = true;
        btn.textContent = '开房中…';
        try {
          const { room: rid, hostKey } = await createRemoteRoom();
          lb.classList.add('hidden');
          enterRoom({ roomId: rid, hostKey });
        } catch {
          btn.disabled = false;
          btn.textContent = '房间服务没应——稍后再试';
        }
      });
    });
    lb.querySelector('#addGuest')?.addEventListener('click', openGuestConfig);
    lb.querySelectorAll('.p-card[data-p]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target.dataset?.edit) return openGuestConfig(); // 客席卡角上的「改」
        const id = el.dataset.p;
        picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-need());
        draw();
      }),
    );
    lb.querySelector('#lobbyStart').addEventListener('click', () => {
      localStorage.setItem('kai.table.v1', mode);
      localStorage.setItem('kai.lineup.v1', JSON.stringify(picked));
      lb.classList.add('hidden');
      newMatch();
    });
    lb.querySelectorAll('.board-row').forEach((el) =>
      el.addEventListener('click', () => openPlayerPage(el.dataset.pg)),
    );
    lb.querySelector('#lobbySettings').addEventListener('click', () => openDrawer('brain', true));
    lb.querySelector('#lobbyNote')?.addEventListener('click', () => {
      localStorage.removeItem('kai.note.v1');
      draw();
    });
  };
  draw();
  lb.classList.remove('hidden');
}

// ---------- 玩家页（榜上每行翻开一页；你和他们同一种书卡语法——平等公民） ----------
function openPlayerPage(id) {
  const d = $('drawer');
  d.classList.remove('hidden');
  d.scrollTop = 0;
  const led = loadLedger();
  let body;
  if (id === 'you') {
    const lastStat = profile.stats.at(-1);
    const insight = lastStat ? condBrief(lastStat) : '';
    const bits = [
      `身家 ${led.you}${led.you <= 0 ? '（赊着）' : ''}`,
      profile.matches ? `${profile.matches} 场 ${profile.wins} 胜` : '',
      (profile.resets ?? 0) > 0 ? `翻篇 ${profile.resets} 次` : '',
    ].filter(Boolean);
    body = `<div class="book">
      <div class="book-head"><span class="seal mini">客</span>你<span class="book-tag">酒馆的客人</span></div>
      <p class="book-stats">${bits.join(' · ')}</p>
      ${insight ? `<p class="insight">破绽：${insight}</p>` : ''}
      ${statTableHtml()}
      <p style="margin-top:0.8rem"><button id="resetLedger" class="linkish">翻篇</button></p>
    </div>`;
  } else {
    const per = rosterMap()[id];
    if (!per) return;
    body = `<p class="p-idline">${per.blurb ?? ''}</p>` + bookHtml(per, [`身家 ${balanceOf(led, id)}`]);
  }
  d.innerHTML = `<button class="close-x" id="closeDrawer">×</button>${body}`;
  d.querySelector('#closeDrawer').addEventListener('click', () => d.classList.add('hidden'));
  d.querySelector('#resetLedger')?.addEventListener('click', (e) => {
    saveLedger({ you: 100, personas: {} }); // 全馆回到初始身家（你 100，他们各自的家底）
    profile = bumpResets(profile); // Q12：翻篇免费，但记进档案
    e.target.textContent = '已翻篇';
    e.target.disabled = true;
    showLobby(); // 榜与卡跟着刷新
  });
}

// 离桌（局内→大厅）：本场不记档——账本只在场终写回，中途走人等于这场没发生
function leaveTable() {
  if (room) return leaveRoom();
  atTable = false;
  matchGen++;
  disarmIdle();
  muteBubble();
  $('drawer').classList.add('hidden');
  $('overlay').classList.add('hidden');
  showLobby();
}

// ---------- 开场 ----------
async function newMatch() {
  atTable = true;
  matchGen++;
  $('overlay').classList.add('hidden');
  muteBubble();
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const ledger = loadLedger();
  labMods = pickedMods(); // 实验桌（Q32）：勾了词条即沙盒
  sandbox = labMods.length > 0;
  const lineup = loadLineup(loadTable());
  seats = ['A', ...lineup.map((_, i) => SEAT_IDS[i])];
  SEAT_PERSONA = {};
  NAMES = { A: '客人' };
  const startChips = { A: ledger.you };
  const ros = rosterMap();
  lineup.forEach((pid, i) => {
    const seat = SEAT_IDS[i];
    SEAT_PERSONA[seat] = ros[pid];
    NAMES[seat] = ros[pid].name;
    startChips[seat] = balanceOf(ledger, pid);
  });
  match = await createMatch({ seed, config: { players: seats, startChips, mods: labMods } });
  opponents = {};
  pokeFeed = {};
  for (const s of seats.slice(1)) {
    const persona = SEAT_PERSONA[s];
    pokeFeed[s] = []; // F9：戳他的话滚进这条追加事实流（引用同一数组，push 即生效）
    opponents[s] = createOpponent({
      channel: () => chanForPersona(persona), // 通道跟人走：官方人设→暗号；客席→自带钥匙
      profile: profileBrief(profile, persona.id),
      persona,
      ctx: {
        names: NAMES,
        three: isTrio(),
        hypotheses: mindOf(profile, persona.id).hypotheses,
        extraFacts: pokeFeed[s],
      },
    });
  }
  opponent = opponents.B; // B 席＝主家：开场白与判词主笔（谁坐主位谁执笔）
  document.documentElement.style.setProperty('--persona-verdict', `'${SEAT_PERSONA.B.name.replace(/['"\\]/g, '')}批：'`);
  buildOppArea();
  buildModRow();
  buildPokeUI();
  myDiceByRound = {};
  sel = null;
  busy = false;
  fallbackNoticed = false;
  skipToReport = false;
  watchSpeed = 1;
  sfx.shake();
  speakOpener(ledger);
  render();
  armIdle();
  showCoach();
  // 训练轮毕业（F4）：扶手要当面拆，否则玩家只会觉得"数字怎么没了"
  if (profile.matches === TRAIN_MATCHES && !localStorage.getItem('kai.trained.v1')) {
    localStorage.setItem('kai.trained.v1', '1');
    setTimeout(() => toastFx('训练轮拆了：想要准数，自己拨算盘'), 1400);
  }
  if (labMods.length) showRuleCardsIntro(); // 词条以明牌规则卡在局前展示（Q32；AI 侧同卡走提示词）
}

// 局前规则卡：全桌明牌——你读的和他们读的是同一张卡
function showRuleCardsIntro() {
  const ov = $('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `<div class="card fade-in"><h2>实验桌</h2>
    ${labMods.map((m) => `<div class="rule-card"><b>「${m.name}」</b><p>${m.card}</p></div>`).join('')}
    <p class="dim-line" style="margin-top:0.6rem">明牌：他们读的是同一张卡。实验局不入榜不入账不入档案。</p></div>
    <div class="again-row"><button class="primary again" id="rcGo">上桌</button></div>`;
  ov.querySelector('#rcGo').addEventListener('click', () => ov.classList.add('hidden'));
}

// 开场白（§5.3-bis 硬节拍）：主家亲口说——LLM 按自己的声口引用旧账；写死的老李头腔已废。
// 沉默模式不代言（无通道＝无开场白，明显变弱是诚实的）。事实素材全为裁判层中性口径。
function speakOpener(ledger) {
  const per = SEAT_PERSONA.B;
  const ch = chanForPersona(per);
  if (!ch) return;
  const gen = matchGen;
  const facts = openerFacts(profile, ledger); // 素材抽成纯函数（可测：Q14 节拍是否真落地）
  const mind = mindOf(profile, per.id);
  if (mind.peeks > 0) facts.push(`他翻过你的小本子 ${mind.peeks} 次`); // F8 反身彩蛋
  // F7 揭诈时刻（Q47）：偶尔把上一场留档的一句诈自己揭了——调味不主食，频率随人设
  const bait = mind.baits?.at(-1);
  if (bait && Math.random() < (per.gear?.revealBait ?? 0.25))
    facts.push(
      `上一场第 ${bait.round} 局你嘴上说的是「${bait.say}」，心里想的其实是「${bait.belief}」——这一句你可以自己揭出来`,
    );
  personaLine(ch, {
    ledger: buildLedger(ob()), // F0b：开场白也过出口校验（只许引用给它的事实）
    persona: per,
    task: profile.matches
      ? '开场白：老客回来了，开一局。第一句必须引用下面旧账里的一条具体事实——让他知道这儿记着他。'
      : '开场白：生面孔头回上桌，用你的方式招呼一句、开局。不要讲规则。',
    facts: facts.join('；'),
  }).then((line) => {
    if (line && gen === matchGen && atTable) speak(line, 'B');
  });
}

// ---------- 新手指引（首次打开一次）：箭头标注三个操作点 ----------
function showCoach() {
  if (localStorage.getItem('kai.coach.v1') || profile.matches > 0) return;
  disarmIdle();
  // 标注分道：sxF/exF 指定箭头在文字条与目标上的锚点位，各占横向通道不相交
  const marks = [
    [['myDice'], '① 点骰盅，偷看自己的骰子', 0.30, 0.24, 0.55, 0.5],
    [['bidBtn'], '② 报数：桌上共有几个几', 0.40, 0.04, 0.25, 0.2],
    [['openBtn'], '③ 觉得他吹牛，拍「开」', 0.50, 0.42, 0.72, 0.5],
    [['blindBtn', 'zhaiBtn', 'raiseBtn'], '④ 盲、斋、抬：池子翻倍，赢多输也多', 0.60, 0.02, 0.1, 0.9],
  ].filter(([ids]) => ids.every((id) => $(id)));
  // F3 教学补课（Q43⑥）：癞子／阶梯／三印代价／算盘——三条底规不该靠玩家自己撞出来
  const c = document.createElement('div');
  c.id = 'coach';
  c.innerHTML = `<svg></svg>
    <div class="coach-rules">
      <p>1 点是万能牌，算作任意点数（宣「斋」的那局失效）。</p>
      <p>报价只能往上抬：数量加大，或同数量、点数加大。抬不动了就只能开。</p>
      <p>盲 ×2、斋 ×1.5、抬 ×2 —— 倍率对全桌双向生效，赢多输也多。</p>
      <p>想要准数就拨算盘：算出来的数只有你看得见，但你在算，全桌都看得见。</p>
    </div>
    <div class="anywhere">看明白了？点任意处，上桌</div>`;
  $('app').appendChild(c);
  const appBox = $('app').getBoundingClientRect();
  const svg = c.querySelector('svg');
  let paths = '';
  for (const [ids, text, topF, leftF, sxF, exF] of marks) {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.textContent = text;
    tip.style.top = `${topF * 100}%`;
    tip.style.left = `${leftF * 100}%`;
    c.appendChild(tip);
    for (const id of ids) $(id).classList.add('coach-glow');
    // 弧线：从文字条锚点飞向首目标锚点
    const tb = tip.getBoundingClientRect();
    const gb = $(ids[0]).getBoundingClientRect();
    const sx = tb.left + tb.width * sxF - appBox.left;
    const sy = tb.bottom + 6 - appBox.top;
    const ex = gb.left + gb.width * exF - appBox.left;
    const ey = gb.top - 10 - appBox.top;
    const cx = (sx + ex) / 2 + (ex > sx ? 24 : -24);
    const cy = (sy + ey) / 2;
    paths += `<path d="M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}"/>
      <polygon points="${ex - 5},${ey - 9} ${ex + 5},${ey - 9} ${ex},${ey + 2}"/>`;
  }
  svg.innerHTML = paths;
  c.addEventListener('click', () => {
    localStorage.setItem('kai.coach.v1', '1');
    for (const [ids] of marks) for (const id of ids) $(id).classList.remove('coach-glow');
    c.remove();
    const o = ob();
    if (o.turn === 'A' && !o.over && !busy) armIdle();
  });
}

$('bidBtn').addEventListener('click', onBid);
$('openBtn').addEventListener('click', () => {
  if (room) return void match.act('A', { type: 'challenge' }, { elapsedMs: performance.now() - turnStart });
  doShowdown('A');
});
$('blindBtn').addEventListener('click', () => onDeclare('blind'));
$('zhaiBtn').addEventListener('click', () => onDeclare('zhai'));
$('raiseBtn').addEventListener('click', () => onDeclare('raise'));
$('cntDown').addEventListener('click', () => { sel.count--; render(); });
$('cntUp').addEventListener('click', () => { sel.count++; render(); });
$('menuBtn').addEventListener('click', () => openDrawer());

// 启动：好友房邀请链接直入（#room=xxx），否则进大厅
promoteHostedOnce(); // 托管席升主位的一次性迁移（老设备的花名册选择）
const roomHash = location.hash.match(/^#room=([a-z0-9]{10})$/);
if (roomHash) pickSeal(() => enterRoom({ roomId: roomHash[1] }));
else showLobby();
