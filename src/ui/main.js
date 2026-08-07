// UI 状态机：引擎先行落子，表现层跟随（DESIGN §7.3）。
// 玩家与 AI 对手走同一套 observe/act——本文件只是人类的"客户端"。

import { createMatch } from '../engine.js';
import { allLegalBids } from '../rules.js';
import { probBidTrue } from '../probability.js';
import { createOpponent, settleVerdict } from '../ai/agent.js';
import { chat } from '../ai/llm.js';
import { DEFAULT_PERSONA } from '../ai/personas.js';
import { computeStats, persona, templateVerdict } from './report.js';
import { loadProfile, appendMatch, profileBrief, loadByok, saveByok, loadLedger, saveLedger } from './profile.js';
import { sfx, unlockAudio } from './audio.js';

document.addEventListener('pointerdown', unlockAudio, { once: true });

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => `${Math.round(p * 100)}%`;
const TURN_MS = 20_000; // §2.4 软计时

const PIPS = {
  1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};
const dieHtml = (face, cls = '') =>
  `<span class="die ${cls}">${PIPS[face].map((p) => `<i class="p-${p}"></i>`).join('')}</span>`;
const backHtml = (cls = '') => `<span class="die back ${cls}"></span>`;

let profile = loadProfile();
let match, opponent, myDiceByRound, sel, busy, turnStart, timerRAF, typeTimer;

// 零配置官方通道（§9.2）：只填暗号 → 同域 /api/llm 代理；三格全填 → 自带 API
function channelOf() {
  const b = loadByok();
  if (!b || !b.apiKey) return null;
  if (!b.baseUrl)
    return {
      baseUrl: `${location.origin}/api/llm`,
      apiKey: b.apiKey,
      model: 'deepseek-chat',
      format: 'openai',
      headers: { 'X-Device': deviceId() }, // 设备日配额（§9.3）
    };
  return b;
}

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

// 保存即测试：官方通道走 ping 免费校验暗号；自带 API 打一次最小真调用
async function testChannel() {
  const ch = channelOf();
  if (!ch) return { ok: false, msg: '没填钥匙——他保持沉默' };
  if (ch.baseUrl.endsWith('/api/llm')) {
    try {
      const r = await fetch(`${location.origin}/api/llm/ping`, {
        headers: { authorization: `Bearer ${ch.apiKey}` },
      });
      const j = await r.json();
      if (!j.secrets) return { ok: false, msg: '官方通道未开（服务端没配 key）' };
      if (j.pass !== true) return { ok: false, msg: '暗号不对' };
      return { ok: true, msg: '暗号对上了——他的嘴已归位' };
    } catch {
      return { ok: false, msg: '这个域名没有官方通道' };
    }
  }
  try {
    await chat(ch, { system: '连通测试', user: '回复一个字', maxTokens: 4, timeoutMs: 8000 });
    return { ok: true, msg: '接上了——他的嘴已归位' };
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

// ---------- 台词气泡（打字机，不阻塞输入 §3.5） ----------
function speak(text) {
  if (!text) return;
  const b = $('bubble');
  b.classList.remove('hidden', 'silent');
  clearInterval(typeTimer);
  let i = 0;
  b.textContent = '';
  typeTimer = setInterval(() => {
    b.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 28);
}
function muteBubble() {
  clearInterval(typeTimer);
  $('bubble').classList.add('hidden');
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

function render() {
  const o = ob();
  const myTurn = o.turn === 'A' && !o.over && !busy;
  // 镜像：他的暗骰与你的骰子同尺寸同位置——骰子行即血条
  $('oppDice').innerHTML = backHtml().repeat(o.diceCount.opp);

  const marks =
    (o.zhai ? '<span class="mark">斋 ×1.5</span>' : '') +
    (o.blind.A ? '<span class="mark">你盲 ×2</span>' : '') +
    (o.blind.B ? '<span class="mark">他盲 ×2</span>' : '');
  const mult = 2 ** (o.blind.A ? 1 : 0) * 2 ** (o.blind.B ? 1 : 0) * (o.zhai ? 1.5 : 1);
  $('pot').innerHTML = `第 ${o.round} 局 · 池 <b>${o.potUnits * 2}</b> 注${marks}`;
  renderPotChips(o.potUnits * 2, mult > 1);

  $('bidBig').innerHTML = o.currentBid
    ? `<span class="n">${o.currentBid.count}</span><span class="x">个</span>${dieHtml(o.currentBid.face, !o.zhai && o.currentBid.face === 1 ? 'wild' : '')}`
    : `<span class="none">${o.over ? '' : o.turn === 'A' ? '等你开口' : '他在想'}</span>`;

  // 镜像：封印与筹码余额各贴各的骰子行
  const rs = lastEvent(o, 'roundStart');
  $('oppCommit').textContent = `封 ${rs.commits.B.slice(0, 10)}`;
  $('myCommit').textContent = `封 ${rs.commits.A.slice(0, 10)}`;
  renderChips('oppChips', o.chips.opp);
  renderChips('myChips', o.chips.you);

  // 我的骰子：未看则盖着（点击=看骰）；盲局锁死
  const mine = $('myDice');
  if (o.yourDice) {
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
    g.innerHTML = `按你的骰子算，「${o.currentBid.count} 个 ${o.currentBid.face}」为真 <b>${pct(p)}</b>`;
  } else if (o.currentBid) {
    g.textContent = o.blind.A ? '盲局——你选的路' : '看了骰才有数';
  } else {
    g.textContent = myTurn ? `桌上共 ${o.diceCount.you + o.diceCount.opp} 颗骰，你先报` : '';
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
    $('bidBtn').textContent = `报 ${sel.count} 个 ${sel.face}${myP}`;
  } else {
    $('bidBtn').textContent = '没法再抬';
  }
  $('bidBtn').disabled = !myTurn || !bids;
  // 赌注焊在扳机上：拍开就是这个数（§2.2 开值＝单方投入×赔率）
  $('openBtn').innerHTML = o.currentBid ? `开<small>±${Math.round(o.potUnits * mult)}</small>` : '开';
  $('openBtn').disabled = !myTurn || !o.currentBid;
  $('blindBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'blind');
  $('zhaiBtn').disabled = !myTurn || !o.legal.some((a) => a.type === 'declare' && a.declaration === 'zhai');

  $('hint').textContent = hintFor(o, myTurn);

  // 连接状态点：亮=LLM 在线，红=已降级沉默模式，灰=尚未开口；未配置则隐藏
  const dot = $('brainDot');
  if (!channelOf()) dot.className = 'brain hidden';
  else {
    const last = opponent?.logs.at(-1);
    dot.className = 'brain ' + (last ? (last.silentFallback ? 'off' : 'on') : 'idle');
  }
}

// 首场只给最短操作指引（§2.5），规则全文在「规」页——桌面上只留对局
function hintFor(o, myTurn) {
  if (o.over || !myTurn) return '';
  if (!o.yourDice && !o.blind.A) return '点骰盅看牌';
  if (profile.matches === 0 && o.round === 1)
    return o.currentBid ? '抬价，或拍「开」' : '报：桌上至少有几个几点';
  return '';
}

// ---------- 计时（§2.4：超时＝最小抬价，本身即信号） ----------
function startTimer() {
  turnStart = performance.now();
  cancelAnimationFrame(timerRAF);
  const bar = $('timer');
  const tick = () => {
    const left = 1 - (performance.now() - turnStart) / TURN_MS;
    bar.firstElementChild.style.transform = `scaleX(${Math.max(0, left)})`;
    bar.classList.toggle('low', left < 0.25);
    if (left <= 0) return onTimeout();
    timerRAF = requestAnimationFrame(tick);
  };
  tick();
}
function stopTimer() {
  cancelAnimationFrame(timerRAF);
  $('timer').firstElementChild.style.transform = 'scaleX(1)';
  $('timer').classList.remove('low');
}

async function onTimeout() {
  const o = ob();
  if (o.turn !== 'A' || o.over || busy) return;
  stopTimer();
  const bids = allLegalBids(o.currentBid, o.zhai, o.diceCount.you + o.diceCount.opp);
  if (bids.length) {
    await match.act('A', { type: 'bid', ...bids[0] }, { elapsedMs: TURN_MS, timeout: true });
    render();
    $('hint').textContent = '手停了——替你抬了最小价';
    aiTurn();
  } else {
    doChallenge('A', TURN_MS, true);
  }
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

async function onDeclare(declaration) {
  await match.act('A', { type: 'declare', declaration }, { elapsedMs: performance.now() - turnStart });
  stampFx(declaration === 'blind' ? '盲 ×2' : '斋 ×1.5');
  render();
}

async function onBid() {
  stopTimer();
  await match.act('A', { type: 'bid', ...sel }, { elapsedMs: performance.now() - turnStart });
  sfx.tick();
  render();
  aiTurn();
}

// ---------- 对手回合 ----------
async function aiTurn() {
  const o = match.observe('B');
  if (o.over) return;
  busy = true;
  render();
  const t0 = performance.now();
  const d = await opponent.decide(o);
  if (d.action.type === 'peek') {
    // 揭盅是公开动作（§2.3）——他看骰，你看得见
    await match.act('B', d.action);
    sfx.land();
    $('oppDice').querySelectorAll('.die').forEach((el) => el.classList.add('reveal'));
    busy = false;
    return aiTurn();
  }
  if (d.silentFallback && d.error && channelOf() && !fallbackNoticed) {
    fallbackNoticed = true;
    $('hint').textContent = `接不上他的脑子（${friendlyError(d.error)}），先闭嘴算账`;
  }
  await sleep(Math.max(0, 900 + Math.random() * 800 - (performance.now() - t0)));
  const elapsedMs = performance.now() - t0;
  if (d.action.type === 'challenge') return doChallenge('B', elapsedMs, false, d.say);
  await match.act('B', d.action, { elapsedMs });
  if (d.action.type === 'declare')
    stampFx(d.action.declaration === 'blind' ? '盲 ×2' : '斋 ×1.5');
  else sfx.tick();
  if (d.say) speak(d.say);
  busy = false;
  if (d.action.type === 'declare') return aiTurn();
  render();
  startTimer();
}

// ---------- 开牌演出（juice 预算全在这一拍，§6） ----------
async function doChallenge(by, elapsedMs = null, timeout = false, sayText = '') {
  busy = true;
  stopTimer();
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
  ov.innerHTML = `<div class="kai">开！</div>
    <div class="row-label">${by === 'A' ? '你拍了桌子' : '他拍了桌子'} · 验「${rv.bid.count} 个 ${rv.bid.face}」</div>
    <div><div class="row-label">他</div><div class="dicerow" id="rvB"></div></div>
    <div><div class="row-label">你</div><div class="dicerow" id="rvA"></div></div>
    <div class="count" id="rvCount"></div>
    <div class="verdict-line" id="rvLine"></div>`;
  await sleep(500);
  // 逐颗揭骰
  for (const [pid, rowId] of [['B', 'rvB'], ['A', 'rvA']]) {
    const row = ov.querySelector(`#${rowId}`);
    for (const f of rv.dice[pid]) {
      row.insertAdjacentHTML('beforeend', dieHtml(f, `reveal ${!rv.zhai && f === 1 ? 'wild' : ''}`));
      sfx.land();
      await sleep(110);
    }
  }
  await sleep(300);
  // 清点：命中发光，其余转暗
  let n = 0;
  const cnt = ov.querySelector('#rvCount');
  const allDice = [...rv.dice.B, ...rv.dice.A];
  const dieEls = [...ov.querySelectorAll('#rvB .die, #rvA .die')];
  for (let i = 0; i < dieEls.length; i++) {
    if (isMatch(allDice[i])) {
      dieEls[i].classList.add('hit');
      cnt.textContent = `${++n}`;
      sfx.tick();
      await sleep(140);
    } else {
      dieEls[i].classList.add('dark');
    }
  }
  await sleep(350);
  const youLose = re.loser === 'A';
  cnt.textContent = `实有 ${rv.actual} 个 —— 报 ${rv.bid.count} 个，${rv.stands ? '成立' : '不成立'}`;
  ov.querySelector('#rvLine').innerHTML = `${youLose ? '你' : '他'}输了这局，掉一颗骰`;
  sfx.loseDie();
  speak(sayText || challengeLine(rv, re));
  await sleep(600);
  await chipFlight(ov, re.transfer, !youLose);
  await sleep(1100);

  const end = lastEvent(o, 'matchEnd');
  if (end) return showReport(end);
  ov.classList.add('hidden');
  sfx.shake();
  busy = false;
  sel = null; // 新局重置报价选择
  render();
  showDelta(youLose ? -re.transfer : re.transfer);
  const next = ob();
  myDiceByRound[next.round] = null;
  if (next.turn === 'A') startTimer();
  else aiTurn();
}

// 结算分层话术（§3.5）：全部由摊牌真实数据生成，不许编
function challengeLine(rv, re) {
  const iOpened = (rv.stands ? re.loser : re.loser === 'A' ? 'B' : 'A') === 'B';
  const pHis = probBidTrue(rv.bid, rv.dice.B, rv.dice.A.length, rv.zhai);
  if (iOpened && re.loser === 'A')
    return `我算过，你这话只有${pct(pHis)}是真的。骰子替我作证。`;
  if (iOpened && re.loser === 'B')
    return pHis < 0.4
      ? `${pct(pHis)}的话你也敢咬死——这把算你的，记下了。`
      : '这把是我手快。';
  if (!iOpened && re.loser === 'B') return '你赢的这把不是运气，是我本人。已记入档案。';
  return `我没骗你。${rv.bid.count} 个 ${rv.bid.face}，一个不少。`;
}

// ---------- 报告卡（§5.2：核心传播物） ----------
async function showReport(end) {
  const o = ob();
  const won = end.winner === 'A';
  saveLedger({ you: end.chips.A, opp: end.chips.B }); // 账本落袋，下一场带着走
  const stats = computeStats(o.events, 'A', myDiceByRound);
  const byok = channelOf();
  const statsText =
    `${end.rounds}局${won ? '客人赢' : '客人输'}；虚报率${pct(stats.bluffRate)}；` +
    `开牌${stats.myChallenges}次命中${stats.myChallengeHits}次；被开${stats.timesChallenged}次；` +
    `平均思考${(stats.avgTimeMs / 1000).toFixed(1)}秒` +
    (stats.slowest ? `；最久一手：第${stats.slowest.round}局想了${(stats.slowest.ms / 1000).toFixed(0)}秒才报${stats.slowest.bid.count}个${stats.slowest.bid.face}` : '') +
    (stats.myBlinds ? `；盲报${stats.myBlinds}次` : '');

  const ov = $('overlay');
  ov.classList.remove('hidden');
  const renderCard = (verdict) => {
    ov.innerHTML = `<div class="card fade-in">
      <h2>酒桌档案 · 第 ${profile.matches + 1} 场</h2>
      <div class="persona">${persona(stats)}</div>
      <dl>
        <dt>胜负</dt><dd>${won ? `赢 · ${end.rounds} 局` : `输 · ${end.rounds} 局`}</dd>
        <dt>身家</dt><dd>${end.chips.A}${end.chips.A <= 0 ? '（赊着）' : ''}</dd>
        <dt>虚报率</dt><dd>${pct(stats.bluffRate)}</dd>
        <dt>开牌命中</dt><dd>${stats.myChallengeHits}/${stats.myChallenges}</dd>
        <dt>被他开</dt><dd>${stats.timesChallenged} 次</dd>
        <dt>平均思考</dt><dd>${(stats.avgTimeMs / 1000).toFixed(1)} 秒</dd>
      </dl>
      <div class="verdict">${verdict}</div>
    </div>
    <button class="primary again" id="againBtn">再来一局</button>
    <div class="small-note">截屏即可分享 · 这一场已记进他的本子</div>`;
    ov.querySelector('#againBtn').addEventListener('click', newMatch);
  };
  renderCard(byok ? `${DEFAULT_PERSONA.name}在写你的档案……` : templateVerdict(stats, won));

  let verdict = null;
  let note = '';
  if (byok) {
    const r = await settleVerdict(byok, { won, statsText, persona: DEFAULT_PERSONA });
    if (r) ({ verdict, note } = r);
    renderCard(verdict ?? templateVerdict(stats, won));
  }
  const aiNotes = opponent.logs.map((l) => l.note).filter(Boolean).slice(-2);
  profile = appendMatch(profile, { won, stats, notes: [...aiNotes, note] });
}

// ---------- 抽屉：规矩 / 档案 / BYOK / 公平说明（统一入口，桌面不放说明） ----------
function openDrawer(section) {
  const d = $('drawer');
  const byok = loadByok() ?? { baseUrl: '', apiKey: '', model: '', format: 'openai' };
  stopTimer(); // 看规矩不吃决策钟；关闭时重开当轮
  d.classList.remove('hidden');
  d.innerHTML = `<button class="close-x" id="closeDrawer">×</button>
    <h2>规矩</h2>
    <ul>
      <li>你和他各摇五颗暗骰。轮流报数：「桌上至少有 N 个 X 点」——说的是双方合计。</li>
      <li>报数只能往上抬：数量加大，或数量不变、点数加大。首报至少 2 个。</li>
      <li>1 点是万能牌，替任何点数凑数。宣过「斋」的局例外。</li>
      <li>不信他，就拍「开」。数够了，开的人输；不够，报的人输。输家掉一颗骰子，骰子掉光，这场就完了。</li>
      <li>注池：每局双方各押 1 注底，此后每报一次数、双方各自动加 1 注。开牌定归属。</li>
      <li>筹码面额：白 1 · 红 5 · 绿 25 · 黑 100（金环）。</li>
      <li>宣言（轮到你、开口之前）：「盲」＝整局不看自己的骰子，本局池 ×2；「斋」＝本局 1 点不作万能，池 ×1.5，只有一局的首报者能宣。</li>
      <li>每手 20 秒。超时自动替你抬最小价——你的犹豫，他看得见、记得住。</li>
      <li>表盘概率只按你手里的骰子和纯运气算，不猜人心。他敢不敢这么报、是不是在钓你开——得你自己读。他那边的表盘也一样。</li>
    </ul>
    <h2 id="profileSec">它眼中的你</h2>
    <p>${profileBrief(profile) || '还没有档案。打一场，他就开始记了。'}</p>
    ${
      profile.stats.length
        ? `<table class="stat-table"><tr><th>场</th><th>胜负</th><th>虚报率</th><th>开牌</th><th>被开</th><th>均时</th></tr>${profile.stats
            .slice(-8)
            .map((s, i, arr) => {
              const idx = profile.stats.length - arr.length + i + 1;
              return `<tr><td>${idx}</td><td>${s.won === true ? '胜' : s.won === false ? '负' : '—'}</td><td>${Math.round(s.bluffRate * 100)}%</td><td>${s.myChallengeHits}/${s.myChallenges}</td><td>${s.timesChallenged}</td><td>${(s.avgTimeMs / 1000).toFixed(1)}s</td></tr>`;
            })
            .join('')}</table>`
        : ''
    }
    ${profile.notes.slice(-6).map((n) => `<p class="note-item">${n}</p>`).join('')}
    <p>身家 ${loadLedger().you}（他 ${loadLedger().opp}）· <button id="resetLedger" class="linkish">把账翻篇，各回 100</button></p>
    <h2>接上他的脑子</h2>
    <p>两种接法：① 拿到暗号的，只填 API Key 一格（填暗号），走官方通道；② 自带 API 的，三格全填，浏览器直连模型商、钥匙只存这台设备。全空则他不说话，只算数。</p>
    <label>Base URL</label><input id="fBase" value="${byok.baseUrl}" placeholder="https://api.deepseek.com/v1">
    <label>API Key</label><input id="fKey" type="password" value="${byok.apiKey}">
    <label>Model</label><input id="fModel" value="${byok.model}" placeholder="deepseek-chat">
    <label>格式</label><select id="fFmt">
      <option value="openai" ${byok.format !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容</option>
      <option value="anthropic" ${byok.format === 'anthropic' ? 'selected' : ''}>Anthropic</option>
    </select>
    <div class="btnrow"><button class="primary" id="saveByok">存好，马上生效</button></div>
    <div id="byokTest" class="test-line"></div>
    <h2>为什么信它</h2>
    <p>① 每局开始，双方骰面先封哈希上屏，摊牌可验——他不能重掷，你也不能。② 他和你走同一套接口，拿同样的字节：接口里没有你的骰面这个字段。③ 你按下之前的犹豫不采样，落子才算数。</p>`;
  if (section === 'profile') d.querySelector('#profileSec').scrollIntoView();
  else d.scrollTop = 0;
  d.querySelector('#resetLedger').addEventListener('click', (e) => {
    saveLedger({ you: 100, opp: 100 });
    e.target.textContent = '翻篇了，下一场生效';
    e.target.disabled = true;
  });
  d.querySelector('#closeDrawer').addEventListener('click', () => {
    d.classList.add('hidden');
    const o = ob();
    if (o.turn === 'A' && !o.over && !busy) startTimer();
  });
  d.querySelector('#saveByok').addEventListener('click', async () => {
    saveByok({
      baseUrl: d.querySelector('#fBase').value.trim(),
      apiKey: d.querySelector('#fKey').value.trim(),
      model: d.querySelector('#fModel').value.trim(),
      format: d.querySelector('#fFmt').value,
    });
    const btn = d.querySelector('#saveByok');
    const out = d.querySelector('#byokTest');
    btn.disabled = true;
    out.className = 'test-line';
    out.textContent = '试他的脑子……';
    const r = await testChannel();
    btn.disabled = false;
    out.textContent = (r.ok ? '✓ ' : '✗ ') + r.msg;
    out.className = 'test-line ' + (r.ok ? 'ok' : 'bad');
    render();
    if (r.ok) setTimeout(() => d.classList.add('hidden'), 1200);
  });
}

// ---------- 开场 ----------
async function newMatch() {
  $('overlay').classList.add('hidden');
  muteBubble();
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const ledger = loadLedger();
  match = await createMatch({ seed, config: { startChips: { A: ledger.you, B: ledger.opp } } });
  opponent = createOpponent({ channel: channelOf, profile: profileBrief(profile), persona: DEFAULT_PERSONA });
  myDiceByRound = {};
  sel = null;
  busy = false;
  fallbackNoticed = false;
  sfx.shake();
  speak(
    profile.matches === 0
      ? '坐。规矩就一条：只能把话越报越大，不信就开。'
      : ledger.you <= 0
        ? `账上你欠着 ${-ledger.you}。先赊着，骰子照摇。`
        : `又来了。第 ${profile.matches + 1} 场，你账上还剩 ${ledger.you}。摇盅。`,
  );
  render();
  startTimer();
  showCoach();
}

// ---------- 新手指引（首次打开一次）：箭头标注三个操作点 ----------
function showCoach() {
  if (localStorage.getItem('kai.coach.v1') || profile.matches > 0) return;
  stopTimer();
  // 标注分道：sxF/exF 指定箭头在文字条与目标上的锚点位，各占横向通道不相交
  const marks = [
    [['myDice'], '① 点骰盅，偷看自己的骰子', 0.30, 0.24, 0.55, 0.5],
    [['bidBtn'], '② 报数：桌上共有几个几', 0.40, 0.04, 0.25, 0.2],
    [['openBtn'], '③ 觉得他吹牛，拍「开」', 0.50, 0.42, 0.72, 0.5],
    [['blindBtn', 'zhaiBtn'], '④ 玩狠的按这里：盲、斋，赔率翻倍', 0.60, 0.02, 0.1, 0.9],
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
    if (o.turn === 'A' && !o.over && !busy) startTimer();
  });
}

// 人设上屏（Q10④：UI 从人设对象读取，不写死名字）
$('seal').textContent = DEFAULT_PERSONA.seal;
$('oppName').textContent = DEFAULT_PERSONA.name;
document.documentElement.style.setProperty('--persona-verdict', `'${DEFAULT_PERSONA.name}批：'`);

$('bidBtn').addEventListener('click', onBid);
$('openBtn').addEventListener('click', () => doChallenge('A'));
$('blindBtn').addEventListener('click', () => onDeclare('blind'));
$('zhaiBtn').addEventListener('click', () => onDeclare('zhai'));
$('cntDown').addEventListener('click', () => { sel.count--; render(); });
$('cntUp').addEventListener('click', () => { sel.count++; render(); });
$('gear').addEventListener('click', () => openDrawer('profile'));
$('rulesBtn').addEventListener('click', () => openDrawer());

newMatch();
