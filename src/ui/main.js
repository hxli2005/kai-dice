// UI 状态机：引擎先行落子，表现层跟随（DESIGN §7.3）。
// 玩家与 AI 对手走同一套 observe/act——本文件只是人类的"客户端"。

import { createMatch } from '../engine.js';
import { allLegalBids } from '../rules.js';
import { probBidTrue } from '../probability.js';
import { createOpponent, settleVerdict, reflect } from '../ai/agent.js';
import { chat } from '../ai/llm.js';
import { PERSONAS } from '../ai/personas.js';
import { computeStats, persona, templateVerdict, condBrief } from './report.js';
import { loadProfile, appendMatch, profileBrief, bumpResets, mindOf, saveProfile, loadPass, savePass, loadGuest, saveGuest, loadLedger, saveLedger, balanceOf } from './profile.js';
import { sfx, unlockAudio } from './audio.js';

document.addEventListener('pointerdown', unlockAudio, { once: true });

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => `${Math.round(p * 100)}%`;
const IDLE_MS = 30_000; // §2.4（Q19 修订）：无倒计时无超时代报；挂机 >30s 人设催话

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
let seats = ['A', 'B'];
let opponents = {}; // seat -> AI 客户端
const typeTimers = {}; // 每席位独立打字机

// 座次（§2.5）：阵容数据驱动——人设只增不改代码。A=玩家，其余按序入座
const SEAT_IDS = ['B', 'C', 'D', 'E'];
// 客席（Q28 用户裁决）：素颜模型以本名上桌——身份=模型名，换模型=换人各记各的账
function guestPersona() {
  const g = loadGuest();
  if (!g?.model) return null;
  return {
    id: `model:${g.model}`,
    name: g.model.slice(0, 24),
    seal: (g.model[0] ?? '客').toUpperCase(),
    tag: '客席 · 素颜上桌',
    identity: `一个以本名上桌的语言模型（${g.model}）。`,
    bare: true,
    gear: { probInject: 'full', usesBlind: true },
    strategy: { challengeThreshold: 0.3 },
    idle: ['……'],
    pace: 'fast',
    bankroll: 300, // TODO(Q25/Q28④) 客席身家占位
  };
}
const rosterAll = () => {
  const g = guestPersona();
  return [...Object.values(PERSONAS), ...(g ? [g] : [])];
};
const rosterMap = () => Object.fromEntries(rosterAll().map((p) => [p.id, p]));
let SEAT_PERSONA = {}; // seat -> persona（newMatch 构建）
let NAMES = { A: '客人' };
const isTrio = () => seats.length > 2;
const dispName = (s) => (s === 'A' ? '你' : NAMES[s]);
// 桌型与阵容（选桌页写入；花名册可增，缺位按册序补齐）
function loadTable() {
  return localStorage.getItem('kai.table.v1') === 'duo' ? 'duo' : 'trio';
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
  if (!pass) return null;
  return {
    baseUrl: `${location.origin}/api/llm`,
    apiKey: pass,
    model: per?.gear?.model ?? 'deepseek-chat', // Q18 原版演员按人设钉（代理端白名单校验）
    format: 'openai',
    headers: { 'X-Device': deviceId() }, // 设备日配额（§9.3）
  };
}
function guestChannelOf() {
  const g = loadGuest();
  return g?.apiKey && g?.baseUrl ? g : null;
}
const chanForPersona = (per) => (per?.bare ? guestChannelOf() : officialChannelOf(per));

// 降级原因 → 人话（连接状态可见性）
function friendlyError(msg = '') {
  if (msg.includes('401')) return '暗号不对';
  if (msg.includes('429')) return '今日额度用完';
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
      headers: { authorization: `Bearer ${ch.apiKey}` },
    });
    const j = await r.json();
    if (!j.secrets) return { ok: false, msg: '官方通道未开（服务端没配 key）' };
    if (j.pass !== true) return { ok: false, msg: '暗号不对' };
    return { ok: true, msg: '已连通' };
  } catch {
    return { ok: false, msg: '这个域名没有官方通道' };
  }
}
async function testGuest(cfg) {
  try {
    await chat(cfg, { system: '连通测试', user: '回复一个字', maxTokens: 4, timeoutMs: 8000 });
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
  }, 28);
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
  $('oppName').textContent = '三人桌';
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
    $(`dice-${s}`).innerHTML = ps.alive ? backHtml('mini').repeat(ps.diceCount) : '<i class="out-mark">出局</i>';
    renderChips(`meta-${s}`, ps.chips);
    const dot = $(`brain-${s}`);
    if (!chanForPersona(SEAT_PERSONA[s])) dot.className = 'brain hidden';
    else {
      const last = opponents[s]?.logs.at(-1);
      dot.className = 'brain ' + (last ? (last.silentFallback ? 'off' : 'on') : 'idle');
    }
  }
}

function render() {
  const o = ob();
  const meAlive = o.players.find((q) => q.id === 'A').alive;
  const myTurn = o.turn === 'A' && !o.over && !busy && meAlive;

  if (isTrio()) renderTrio(o);
  else {
    // 镜像：他的暗骰与你的骰子同尺寸同位置——骰子行即血条
    $('oppDice').innerHTML = backHtml().repeat(o.diceCount.opp);
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
    (o.potUnits - 1 >= 6 ? '<span class="mark">深水 ×2</span>' : '');
  const aliveN = o.players.filter((q) => q.alive).length;
  $('roundTag').textContent = `第 ${o.round} 局`;
  $('pot').innerHTML = marks;
  renderPotChips(o.potUnits * aliveN, o.potMult > 1);

  // 中央只放对局物：报价者名＋报价大字；无报价时留白（思考状态由座位动画表达，不摆文字）
  const bidderTag = o.currentBid && isTrio() ? `<span class="bidder-tag">${dispName(o.currentBid.player)}：</span>` : '';
  $('bidBig').innerHTML = o.currentBid
    ? `${bidderTag}<span class="n">${o.currentBid.count}</span><span class="x">个</span>${dieHtml(o.currentBid.face, !o.zhai && o.currentBid.face === 1 ? 'wild' : '')}`
    : `<span class="none"></span>`;

  renderChips('myChips', o.chips.you);

  // 我的骰子：未看则盖着（点击=看骰）；盲局锁死；出局清空
  const mine = $('myDice');
  if (!meAlive) {
    mine.innerHTML = '';
  } else if (o.yourDice) {
    mine.innerHTML = o.yourDice
      .map((f) => dieHtml(f, !o.zhai && f === 1 ? 'wild' : ''))
      .join('');
  } else {
    mine.innerHTML = backHtml().repeat(o.diceCount.you);
    if (!o.blind.A)
      mine.querySelectorAll('.die').forEach((el) =>
        el.addEventListener('click', onPeek, { once: true }),
      );
  }

  // 概率表盘：事实工具双发（附B.1）
  const g = $('gauge');
  if (o.currentBid && o.yourDice) {
    const p = probBidTrue(o.currentBid, o.yourDice, o.diceCount.opp, o.zhai);
    g.innerHTML = `「${o.currentBid.count} 个 ${o.currentBid.face}」真 <b>${pct(p)}</b>`;
  } else if (o.currentBid && o.blind.A) {
    g.textContent = '盲局';
  } else if (!meAlive) {
    g.textContent = '出局 · 观战';
  } else {
    g.textContent = '';
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
    const myP = o.yourDice ? ` · ${pct(probBidTrue(sel, o.yourDice, o.diceCount.opp, o.zhai))}` : '';
    $('bidBtn').textContent = `报${myP}`;
  } else {
    $('bidBtn').textContent = '—';
  }
  $('bidBtn').disabled = !myTurn || !bids;
  $('openBtn').innerHTML = '开<span class="bang">!</span>'; // 开谁由报价行具名；半角叹号手控间距防歪
  $('openBtn').disabled = !myTurn || !o.currentBid;
  $('blindBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'blind');
  $('zhaiBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'zhai');
  $('raiseBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'raise');

  $('hint').textContent = hintFor(o, myTurn);

  // 连接状态点（duo；trio 各 strip 自带）：亮=在线，红=降级，灰=未开口
  const dot = $('brainDot');
  if (isTrio() || !chanForPersona(SEAT_PERSONA.B)) dot.className = 'brain hidden';
  else {
    const last = opponent?.logs.at(-1);
    dot.className = 'brain ' + (last ? (last.silentFallback ? 'off' : 'on') : 'idle');
  }
}

// 首场只给最短操作指引（§2.5），规则全文在「规」页——桌面上只留对局
function hintFor() {
  return ''; // 设施不说话：教学归指引层，状态归数据（gauge/按钮）
}

// ---------- 计时（§2.4：超时＝最小抬价，本身即信号） ----------
// §2.4（Q19）：不设钟。turnStart 只做用时记录基准；挂机 >30s 人设催一句（循环换句，无机制后果）
function armIdle() {
  turnStart = performance.now();
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
  sfx.land();
  render();
  $('myDice').querySelectorAll('.die').forEach((el) => el.classList.add('reveal'));
  const o = ob();
  myDiceByRound[o.round] = o.yourDice;
}

const stampText = (d) => (d === 'blind' ? '盲 ×2' : d === 'zhai' ? '斋 ×1.5' : '抬 ×2');

async function onDeclare(declaration) {
  await match.act('A', { type: 'declare', declaration }, { elapsedMs: performance.now() - turnStart });
  stampFx(stampText(declaration));
  render();
}

async function onBid() {
  disarmIdle();
  await match.act('A', { type: 'bid', ...sel }, { elapsedMs: performance.now() - turnStart });
  sfx.tick();
  render();
  driveTurn();
}

// ---------- 回合调度（§2.5）：轮到谁驱动谁；AI 台词打字与下一位的网络请求并行（节拍 ≤4s） ----------
function driveTurn() {
  if (!atTable) return;
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
  const d = await ai.decide(o);
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
  if (d.silentFallback && d.error && chanForPersona(ai.persona) && !fallbackNoticed) {
    fallbackNoticed = true;
    $('hint').textContent = `${NAMES[seat]}未连接（${friendlyError(d.error)}）`;
  }
  // 人设节奏：阿飞近乎秒出，老李头想得慢
  const floor = ai.persona.pace === 'fast' ? 350 + Math.random() * 350 : 900 + Math.random() * 800;
  await sleep(Math.max(0, floor - (performance.now() - t0)));
  if (gen !== matchGen) return;
  const elapsedMs = performance.now() - t0;
  if (d.action.type === 'challenge') return doChallenge(seat, elapsedMs, false, d.say);
  await match.act(seat, d.action, { elapsedMs });
  if (d.action.type === 'declare') stampFx(stampText(d.action.declaration));
  else sfx.tick();
  if (d.say) speak(d.say, seat);
  busy = false;
  if (d.action.type === 'declare') return aiTurnFor(seat);
  render();
  driveTurn();
}

// ---------- 开牌演出（juice 预算全在这一拍，§6） ----------
async function doChallenge(by, elapsedMs = null, timeout = false, sayText = '') {
  busy = true;
  disarmIdle();
  muteBubble();
  if (by === 'A' && elapsedMs === null) elapsedMs = performance.now() - turnStart;
  await match.act(by, { type: 'challenge' }, { elapsedMs, timeout });
  const o = ob();
  const rv = lastEvent(o, 'reveal');
  const re = lastEvent(o, 'roundEnd');
  const isMatch = (f) => f === rv.bid.face || (!rv.zhai && f === 1);

  sfx.slam();
  $('app').classList.add('shake');
  setTimeout(() => $('app').classList.remove('shake'), 400);
  const ov = $('overlay');
  ov.classList.remove('hidden');
  // 摊牌行：其他人在上，你压轴
  const seatsIn = [...Object.keys(rv.dice).filter((s) => s !== 'A'), ...(rv.dice.A ? ['A'] : [])];
  ov.innerHTML = `<div class="kai">开！</div>
    <div class="row-label">${by === 'A' ? '你' : NAMES[by]}拍了桌子，开${rv.bid.player === 'A' ? '你' : NAMES[rv.bid.player]} · 验「${rv.bid.count} 个 ${rv.bid.face}」</div>
    ${seatsIn
      .map(
        (s) =>
          `<div><div class="row-label">${dispName(s)}</div><div class="dicerow" id="rv${s}"></div></div>`,
      )
      .join('')}
    <div class="count" id="rvCount"></div>
    <div class="verdict-line" id="rvLine"></div>`;
  await sleep(500);
  // 逐颗揭骰
  for (const s of seatsIn) {
    const row = ov.querySelector(`#rv${s}`);
    for (const f of rv.dice[s]) {
      row.insertAdjacentHTML('beforeend', dieHtml(f, `reveal ${!rv.zhai && f === 1 ? 'wild' : ''}`));
      sfx.land();
      await sleep(isTrio() ? 80 : 110);
    }
  }
  await sleep(300);
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
      await sleep(isTrio() ? 110 : 140);
    } else {
      dieEls[i].classList.add('dark');
    }
  }
  await sleep(350);
  const youLose = re.loser === 'A';
  cnt.textContent = `实有 ${rv.actual} 个 —— 报 ${rv.bid.count} 个，${rv.stands ? '成立' : '不成立'}`;
  ov.querySelector('#rvLine').innerHTML = `${dispName(re.loser)}输了这局，掉一颗骰`;
  sfx.loseDie();
  const line = sayText ? { text: sayText, seat: by !== 'A' ? by : 'B' } : challengeLine(rv, re);
  speak(line.text, line.seat);
  await sleep(600);
  const myDelta = re.transfers?.A ?? 0;
  if (myDelta !== 0) await chipFlight(ov, Math.abs(myDelta), myDelta > 0);
  await sleep(1100);

  // §3.3 复盘学习触发①：被打脸的 AI 当场短反思（异步，不挡节拍；输入全为已公开信息）
  for (const s of seats.slice(1)) {
    if (re.loser !== s) continue;
    const ai = opponents[s];
    const ch = chanForPersona(ai.persona);
    if (!ch) continue;
    const mind = mindOf(profile, ai.persona.id);
    reflect(ch, { persona: ai.persona, factText: roundFactText(rv, re, s), hypotheses: mind.hypotheses })
      .then((hyps) => {
        if (hyps) {
          mind.hypotheses = hyps;
          saveProfile(profile);
        }
      });
  }

  const end = lastEvent(o, 'matchEnd');
  if (end) return showReport(end);
  ov.classList.add('hidden');
  sfx.shake();
  busy = false;
  sel = null; // 新局重置报价选择
  render();
  if (myDelta !== 0) showDelta(myDelta);
  const next = ob();
  myDiceByRound[next.round] = null;
  // 玩家刚出局 → 观战提示（§2.5 淘汰观战：看他们收尾）
  if (re.diceCount.A === 0 && !end) $('hint').textContent = '出局 · 观战';
  driveTurn();
}

// 从摊牌事件回溯某席位每局骰面（公开信息）——供 AI 行为统计复算
function diceByRoundOf(events, seat) {
  const map = {};
  let round = 0;
  for (const e of events) {
    if (e.type === 'roundStart') round = e.round;
    if (e.type === 'reveal' && e.dice[seat]) map[round] = e.dice[seat];
  }
  return map;
}

// 反思素材：本局公开事实一句话（骰面已摊牌公开，合宪）
function roundFactText(rv, re, seat) {
  const who = (p) => (p === seat ? '你' : p === 'A' ? '客人' : NAMES[p]);
  const diceStr = Object.entries(rv.dice)
    .map(([q, d]) => `${who(q)}[${d.join(',')}]`)
    .join('，');
  return `第${re.round}局摊牌：${diceStr}。${who(rv.challenger)}开${who(rv.bid.player)}的「${rv.bid.count}个${rv.bid.face}」，实有${rv.actual}个，${rv.stands ? '成立' : '不成立'}——${who(re.loser)}输，付${re.transfer}注。`;
}

// 结算分层话术（§3.5）：全部由摊牌真实数据生成，不许编。返回 {text, seat=说话者}
function challengeLine(rv, re) {
  const bidder = rv.bid.player;
  const challenger = rv.challenger;
  const winner = re.winner;
  const say = (seat, text) => ({ seat, text });
  const pOf = (seat) => {
    const mine = rv.dice[seat] ?? [];
    const unknown = Object.entries(rv.dice)
      .filter(([k]) => k !== seat)
      .reduce((s, [, d]) => s + d.length, 0);
    return probBidTrue(rv.bid, mine, unknown, rv.zhai);
  };
  // AI 开你
  if (challenger !== 'A' && bidder === 'A') {
    const pHis = pOf(challenger);
    return re.loser === 'A'
      ? say(challenger, `我算过，你这话只有${pct(pHis)}是真的。骰子替我作证。`)
      : say(challenger, pHis < 0.4 ? `${pct(pHis)}的话你也敢咬死——这把算你的，记下了。` : '这把是我手快。');
  }
  // 你开 AI
  if (challenger === 'A' && bidder !== 'A') {
    return re.loser === bidder
      ? say(bidder, '你赢的这把不是运气，是我本人。已记入档案。')
      : say(bidder, `我没骗你。${rv.bid.count} 个 ${rv.bid.face}，一个不少。`);
  }
  // AI 开 AI（三人桌互咬——赢家说话）
  if (challenger !== 'A' && bidder !== 'A') {
    return winner === challenger
      ? say(challenger, `${NAMES[bidder]}，这种话留着骗客人吧。收钱。`)
      : say(bidder, `急什么。${rv.bid.count} 个 ${rv.bid.face}，一个不少——${NAMES[challenger]}你付账。`);
  }
  return say('B', `${rv.bid.count} 个 ${rv.bid.face}，摊开了。`);
}

// ---------- 报告卡（§5.2：核心传播物） ----------
async function showReport(end) {
  const o = ob();
  const won = end.winner === 'A';
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
  const stats = computeStats(o.events, 'A', myDiceByRound);
  const byok = chanForPersona(opponent.persona); // 判词主笔（B 席）用自己的通道执笔
  const standingsLine = end.standings
    ? end.standings.map((s, i) => `${i + 1}. ${dispName(s)}`).join('　')
    : '';
  // 判词素材（Q15 证据分级）：一级决策事实＋二级条件倾向（心理侧，杀伤力最大）；
  // 用时是三级遥测——秒数不给，只有极端犹豫化成现象学一句
  const statsText =
    (isTrio() ? `三人桌，名次：${end.standings.map(dispName).join(' > ')}；` : '') +
    `${end.rounds}局${won ? '客人赢' : '客人输'}；虚报率${pct(stats.bluffRate)}；` +
    `开牌${stats.myChallenges}次命中${stats.myChallengeHits}次；被开${stats.timesChallenged}次` +
    (stats.myBlinds ? `；盲报${stats.myBlinds}次` : '') +
    (stats.myRaises ? `；拍抬${stats.myRaises}次` : '') +
    (condBrief(stats) ? `；条件倾向（心理侧，判词优先引用）：${condBrief(stats)}` : '') +
    ((profile.resets ?? 0) > 0 ? `；此人历史上把账翻篇过${profile.resets}次` : '') +
    (stats.slowest && stats.slowest.ms > 8000
      ? `；全场最犹豫的一手：第${stats.slowest.round}局报${stats.slowest.bid.count}个${stats.slowest.bid.face}前他停了半天`
      : '');

  const ov = $('overlay');
  ov.classList.remove('hidden');
  const renderCard = (verdict) => {
    ov.innerHTML = `<div class="card fade-in">
      <h2>酒桌档案 · 第 ${profile.matches + 1} 场</h2>
      <div class="persona">${persona(stats)}</div>
      <dl>
        ${isTrio() && end.standings ? `<dt>名次</dt><dd>${standingsLine}</dd>` : ''}
        <dt>胜负</dt><dd>${won ? `赢 · ${end.rounds} 局` : `输 · ${end.rounds} 局`}</dd>
        <dt>身家</dt><dd>${end.chips.A}${end.chips.A <= 0 ? '（赊着）' : ''}</dd>
        <dt>虚报率</dt><dd>${pct(stats.bluffRate)}</dd>
        <dt>开牌命中</dt><dd>${stats.myChallengeHits}/${stats.myChallenges}</dd>
        <dt>被他开</dt><dd>${stats.timesChallenged} 次</dd>
        <dt>平均思考</dt><dd>${(stats.avgTimeMs / 1000).toFixed(1)} 秒</dd>
      </dl>
      <div class="verdict">${verdict}</div>
    </div>
    <div class="again-row">
      <button class="ghost" id="lobbyBtn">换桌</button>
      <button class="primary again" id="againBtn">再来一局</button>
    </div>
    <div class="small-note">截屏即可分享 · 这一场已记进他的本子</div>`;
    ov.querySelector('#againBtn').addEventListener('click', newMatch);
    ov.querySelector('#lobbyBtn').addEventListener('click', () => {
      ov.classList.add('hidden');
      showLobby();
    });
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
    });
    if (r) {
      ({ verdict, note } = r);
      // §3.3 触发②：场终全量复盘——修订后的规律假设入主观层
      if (r.hypotheses) mindB.hypotheses = r.hypotheses;
    }
    renderCard(verdict ?? templateVerdict(stats, won));
  }
  // 每个在场 AI 把观察记进自己的本子（档案双层：主观层私有）
  for (const s of seats.slice(1)) {
    if (s === 'B') continue; // 主笔（B 席）的经 appendMatch 记
    const ai = opponents[s];
    const extra = ai.logs.map((l) => l.note).filter(Boolean).slice(-2);
    const mind = mindOf(profile, ai.persona.id);
    mind.notes = [...mind.notes, ...extra].slice(-30);
  }
  const aiNotes = opponent.logs.map((l) => l.note).filter(Boolean).slice(-2);
  profile = appendMatch(profile, { won, stats, notes: [...aiNotes, note], personaId: opponent.persona.id });
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
        ? '<a href="#secRules">规矩</a><a href="#secBrain">设置</a>'
        : '<a href="#profileSec">档案</a><a href="#secRules">规矩</a><a href="#secSeal">封印</a><a class="leave" id="leaveBtn">离桌</a>'
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
      <li>轮流报「桌上共有几个几」，只能往上抬。</li>
      <li>1 点是万能牌；斋局失效。</li>
      <li>开只开上家：数够，开的人输；不够，报的人输。输家掉一骰，掉光出局。</li>
      <li>每报一手，全桌各追 1 注；开牌胜者收整池。</li>
      <li>盲＝没看骰就能宣、全局不看，池×2　｜　斋＝首报者宣，1 失效，池×1.5　｜　抬＝轮到你拍章，池×2，每人每局一次。</li>
      <li>第 6 手报价起进深水：池自动再 ×2。倍率全部相乘。</li>
      <li>白1 · 红5 · 绿25 · 黑100。不限时——但你手停多久，他们都记着。</li>
    </ul>

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
    <label>暗号（官方通道——只喂官方人物）</label><input id="fPass" type="password" value="${loadPass()}">
    <div class="btnrow"><button class="primary" id="savePassBtn">保存</button></div>
    <div id="passTest" class="test-line"></div>
    <p class="dim-line">自带 API？在大厅的「客席」卡上填钥匙，你的模型以本名上桌。</p>`
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
    <label>API Key</label><input id="gKey" type="password" value="${g.apiKey}">
    <label>Model</label><input id="gModel" value="${g.model}" placeholder="deepseek-chat">
    <label>格式</label><select id="gFmt">
      <option value="openai" ${g.format !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容</option>
      <option value="anthropic" ${g.format === 'anthropic' ? 'selected' : ''}>Anthropic</option>
    </select>
    <div class="btnrow"><button class="primary" id="saveGuestBtn">保存并试一手</button>${loadGuest() ? '<button class="ghost" id="clearGuestBtn">撤席</button>' : ''}</div>
    <div id="guestTest" class="test-line"></div>`;
  d.querySelector('#closeDrawer').addEventListener('click', () => d.classList.add('hidden'));
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
    lb.innerHTML = `<div class="lobby-title">开！</div>
      <div class="board">${boardHtml()}</div>
      <div class="mode-row">
        <button class="mode-btn ${mode === 'duo' ? 'sel' : ''}" data-m="duo">单挑</button>
        <button class="mode-btn ${mode === 'trio' ? 'sel' : ''}" data-m="trio">三人桌</button>
      </div>
      <div class="roster">${rosterAll()
        .map(
          (per) => `<button class="p-card ${picked.includes(per.id) ? 'sel' : ''}" data-p="${per.id}">
            <span class="seal">${per.seal}</span>
            <span class="p-info">
              <span class="p-name">${per.name}</span>
              <span class="p-sub">${per.tag ?? ''}</span>
              <span class="p-data">${dataOf(per)}</span>
            </span>
            ${per.bare ? '<span class="card-edit" data-edit="1">改</span>' : ''}
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
      <button class="primary" id="lobbyStart" ${picked.length === need() ? '' : 'disabled'}>开局</button>
      <div class="lobby-links"><a id="lobbySettings">设置</a><a href="about.html">说明</a></div>`;
    lb.querySelectorAll('.mode-btn').forEach((el) =>
      el.addEventListener('click', () => {
        mode = el.dataset.m;
        picked = picked.slice(0, need());
        for (const id of Object.keys(rosterMap())) if (picked.length < need() && !picked.includes(id)) picked.push(id);
        draw();
      }),
    );
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
    body = `<p class="p-idline">${per.identity}</p>` + bookHtml(per, [`身家 ${balanceOf(led, id)}`]);
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
  match = await createMatch({ seed, config: { players: seats, startChips } });
  opponents = {};
  for (const s of seats.slice(1)) {
    const persona = SEAT_PERSONA[s];
    opponents[s] = createOpponent({
      channel: () => chanForPersona(persona), // 通道跟人走：官方人设→暗号；客席→自带钥匙
      profile: profileBrief(profile, persona.id),
      persona,
      ctx: { names: NAMES, three: isTrio(), hypotheses: mindOf(profile, persona.id).hypotheses },
    });
  }
  opponent = opponents.B; // B 席＝主家：开场白与判词主笔（谁坐主位谁执笔）
  document.documentElement.style.setProperty('--persona-verdict', `'${SEAT_PERSONA.B.name.replace(/['"\\]/g, '')}批：'`);
  buildOppArea();
  myDiceByRound = {};
  sel = null;
  busy = false;
  fallbackNoticed = false;
  sfx.shake();
  speak(openerLine(ledger), 'B');
  render();
  armIdle();
  showCoach();
}

// 开场白（§5.3-bis 硬节拍）：回头客第一句必须引用上一场的具体事实——记忆的展示窗
function openerLine(ledger) {
  if (profile.matches === 0) return '坐。规矩就一条：只能把话越报越大，不信就开。';
  const last = profile.stats.at(-1);
  if (ledger.you <= 0) return `账上你欠着 ${-ledger.you}。先赊着，骰子照摇。`;
  if ((profile.resets ?? 0) > 0 && ledger.you === 100 && Object.keys(ledger.personas).length === 0)
    return `把账翻篇了？新本子，旧毛病。摇盅。`;
  if (!last) return `又来了。第 ${profile.matches + 1} 场。摇盅。`;
  // 引用旧账用中性主语：上一场的对手未必是本场主家，"我"字会把别人的账认到自己头上
  const bits = [];
  if (last.myChallenges > 0 && last.myChallengeHits === 0)
    bits.push(`上回你开了 ${last.myChallenges} 次，一次没中`);
  if (last.bluffRate > 0.5) bits.push(`上回你十句里一半是空的`);
  if (last.timesChallenged >= 2) bits.push(`上回你被掀了 ${last.timesChallenged} 回`);
  if (last.slowest && last.slowest.ms > 8000)
    bits.push(`上回第 ${last.slowest.round} 局你手停了半天才报 ${last.slowest.bid.count} 个 ${last.slowest.bid.face}`);
  if (last.myBlinds >= 2) bits.push(`上回你盲了 ${last.myBlinds} 把，胆子是真肥`);
  if (!bits.length)
    bits.push(last.won ? `上回让你赢了一场，我记着` : `上回你输得不难看，但还是输`);
  return `${bits[0]}——我可没忘。摇盅。`;
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
    [['blindBtn', 'zhaiBtn', 'raiseBtn'], '④ 玩狠的按这里：盲、斋、抬，赔率翻倍', 0.60, 0.02, 0.1, 0.9],
  ];
  const c = document.createElement('div');
  c.id = 'coach';
  c.innerHTML = '<svg></svg><div class="anywhere">看明白了？点任意处，上桌</div>';
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
$('openBtn').addEventListener('click', () => doChallenge('A'));
$('blindBtn').addEventListener('click', () => onDeclare('blind'));
$('zhaiBtn').addEventListener('click', () => onDeclare('zhai'));
$('raiseBtn').addEventListener('click', () => onDeclare('raise'));
$('cntDown').addEventListener('click', () => { sel.count--; render(); });
$('cntUp').addEventListener('click', () => { sel.count++; render(); });
$('menuBtn').addEventListener('click', () => openDrawer());

showLobby();
