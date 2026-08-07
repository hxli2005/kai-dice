// UI 状态机：引擎先行落子，表现层跟随（DESIGN §7.3）。
// 玩家与老周走同一套 observe/act——本文件只是人类的"客户端"。

import { createMatch } from '../engine.js';
import { allLegalBids } from '../rules.js';
import { probBidTrue } from '../probability.js';
import { createLaoZhou, settleVerdict } from '../ai/agent.js';
import { computeStats, persona, templateVerdict } from './report.js';
import { loadProfile, appendMatch, profileBrief, loadByok, saveByok } from './profile.js';
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
let match, laoZhou, myDiceByRound, sel, busy, turnStart, timerRAF, typeTimer;

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

// 结算高潮：筹码从池心成串飞向赢家，大数字滚着涨（爽感预算的第二拍）
async function chipFlight(ov, amount, youWin) {
  const stage = document.createElement('div');
  stage.className = 'chip-flight';
  ov.appendChild(stage);
  const amt = document.createElement('div');
  amt.className = `win-amt ${youWin ? 'win' : 'lose'}`;
  amt.textContent = youWin ? '＋0' : '−0';
  stage.appendChild(amt);
  const toks = tokensOf(amount).slice(0, 14);
  const n = toks.length;
  toks.forEach(([d, cls], i) => {
    const c = document.createElement('span');
    c.className = `chip-dot ${cls}`;
    c.innerHTML = `<i>${d}</i>`;
    c.style.setProperty('--dx', `${Math.random() * 140 - 70}px`);
    c.style.setProperty('--dy', `${(youWin ? 1 : -1) * (230 + Math.random() * 90)}px`);
    c.style.animationDelay = `${i * 90}ms`;
    stage.appendChild(c);
    setTimeout(() => sfx.coin(), i * 90);
  });
  // 数字滚动与筹码流同步
  const dur = n * 90 + 350;
  const t0 = performance.now();
  await new Promise((done) => {
    const roll = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const v = Math.round(amount * k);
      amt.textContent = youWin ? `＋${v}` : `−${v}`;
      if (k < 1) requestAnimationFrame(roll);
      else done();
    };
    roll();
  });
  if (amount >= 8) sfx.jackpot();
  await sleep(500);
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
    g.innerHTML = `若他乱报，「${o.currentBid.count} 个 ${o.currentBid.face}」为真 <b>${pct(p)}</b>`;
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

// ---------- 老周回合 ----------
async function aiTurn() {
  const o = match.observe('B');
  if (o.over) return;
  busy = true;
  render();
  const t0 = performance.now();
  const d = await laoZhou.decide(o);
  if (d.action.type === 'peek') {
    // 揭盅是公开动作（§2.3）——他看骰，你看得见
    await match.act('B', d.action);
    sfx.land();
    $('oppDice').querySelectorAll('.die').forEach((el) => el.classList.add('reveal'));
    busy = false;
    return aiTurn();
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
  const stats = computeStats(o.events, 'A', myDiceByRound);
  const byok = loadByok();
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
        <dt>筹码</dt><dd>${end.chips.A}</dd>
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
  renderCard(byok ? '老周在写你的档案……' : templateVerdict(stats, won));

  let verdict = null;
  let note = '';
  if (byok) {
    const r = await settleVerdict(byok, { won, statsText });
    if (r) ({ verdict, note } = r);
    renderCard(verdict ?? templateVerdict(stats, won));
  }
  const aiNotes = laoZhou.logs.map((l) => l.note).filter(Boolean).slice(-2);
  profile = appendMatch(profile, { won, stats, notes: [...aiNotes, note] });
}

// ---------- 抽屉：规矩 / 档案 / BYOK / 公平说明（统一入口，桌面不放说明） ----------
function openDrawer() {
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
    </ul>
    <h2>它眼中的你</h2>
    <p>${profileBrief(profile) || '还没有档案。打一场，他就开始记了。'}</p>
    ${profile.notes.slice(-6).map((n) => `<p class="note-item">${n}</p>`).join('')}
    <h2>换个脑子（自带 API）</h2>
    <p>钥匙只存这台设备，浏览器直连模型商，不经任何中间服务器。留空则用沉默模式（他不说话，只算数）。</p>
    <label>Base URL</label><input id="fBase" value="${byok.baseUrl}" placeholder="https://api.deepseek.com/v1">
    <label>API Key</label><input id="fKey" type="password" value="${byok.apiKey}">
    <label>Model</label><input id="fModel" value="${byok.model}" placeholder="deepseek-chat">
    <label>格式</label><select id="fFmt">
      <option value="openai" ${byok.format !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容</option>
      <option value="anthropic" ${byok.format === 'anthropic' ? 'selected' : ''}>Anthropic</option>
    </select>
    <div class="btnrow"><button class="primary" id="saveByok">存好，下一场生效</button></div>
    <h2>为什么信它</h2>
    <p>① 每局开始，双方骰面先封哈希上屏，摊牌可验——他不能重掷，你也不能。② 他和你走同一套接口，拿同样的字节：接口里没有你的骰面这个字段。③ 你按下之前的犹豫不采样，落子才算数。</p>`;
  d.querySelector('#closeDrawer').addEventListener('click', () => {
    d.classList.add('hidden');
    const o = ob();
    if (o.turn === 'A' && !o.over && !busy) startTimer();
  });
  d.querySelector('#saveByok').addEventListener('click', () => {
    saveByok({
      baseUrl: d.querySelector('#fBase').value.trim(),
      apiKey: d.querySelector('#fKey').value.trim(),
      model: d.querySelector('#fModel').value.trim(),
      format: d.querySelector('#fFmt').value,
    });
    d.classList.add('hidden');
  });
}

// ---------- 开场 ----------
async function newMatch() {
  $('overlay').classList.add('hidden');
  muteBubble();
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  match = await createMatch({ seed });
  laoZhou = createLaoZhou({ channel: loadByok(), profile: profileBrief(profile) });
  myDiceByRound = {};
  sel = null;
  busy = false;
  sfx.shake();
  speak(
    profile.matches === 0
      ? '坐。规矩就一条：只能把话越报越大，不信就开。'
      : `又来了。第 ${profile.matches + 1} 场，前头你赢 ${profile.wins} 场。摇盅。`,
  );
  render();
  startTimer();
}

$('bidBtn').addEventListener('click', onBid);
$('openBtn').addEventListener('click', () => doChallenge('A'));
$('blindBtn').addEventListener('click', () => onDeclare('blind'));
$('zhaiBtn').addEventListener('click', () => onDeclare('zhai'));
$('cntDown').addEventListener('click', () => { sel.count--; render(); });
$('cntUp').addEventListener('click', () => { sel.count++; render(); });
$('gear').addEventListener('click', openDrawer);
$('rulesBtn').addEventListener('click', openDrawer);

newMatch();
