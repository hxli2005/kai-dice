// Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · macrostructure: in-place workbench.
// 方向 O「三管机」的生产表现层 · 2026-10 复古未来主义「任务控制台」皮肤（搪瓷、镀铬、辉光管、宝石灯、胶木键）。
// 规则事实只从 observe() 的快照进入；本模块不拥有、不推断、也不修改任何引擎状态。

import { allLegalBids } from '../rules.js';
import { isEnglish } from './i18n.js';

const L = (zh, en) => (isEnglish() ? en : zh);

const W = 195;
const H = 422;
const SS = 4;
const RS = 3; // 低分辨率几何不变；栅格 3×，辉光管与镀铬边在高 DPR 手机上也不糊。
const GLY = '◢◣◤◥▲▼◆◇░▒▓ｱｶｻﾀﾅﾊﾏﾔ'; // 盖住的骰子只滚符号，不滚数字——免得被误读成点数。
const PIPS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};
// 复古未来主义「任务控制台」：上管青绿磷光（它）、中管辉光管橙（报价）、下管琥珀（你）。
const PH = {
  a: { glass: '#010d0c', fade: '1,13,12', deep: '#042320', lo: '#1b6e66', mid: '#5cf2d8', hot: '#e4fffa' },
  b: { glass: '#0d0402', fade: '13,4,2', deep: '#2a0d04', lo: '#7d2e0f', mid: '#ff7a2e', hot: '#ffe4c8' },
  c: { glass: '#0e0902', fade: '14,9,2', deep: '#2b1a05', lo: '#80581a', mid: '#ffc24f', hot: '#fff5da' },
};
const CH = {
  enamelHi: '#2f6b67',
  enamel: '#21504d',
  enamelLo: '#123230',
  deck: '#1a4542',
  deckLo: '#0d2726',
  cream: '#f3e8cc',
  orange: '#ff6a2a',
  orangeHi: '#ff9a5c',
  mustard: '#f6b73f',
  amberLo: '#3a2a0c',
  red: '#ff4a2e',
  redLo: '#46140c',
  chromeHi: '#f6f7f2',
  chrome: '#a9b2ae',
  chromeLo: '#3d4846',
  inkDim: '#9cc0b8',
  chassis: '#21504d',
  key: '#f3e8cc',
};
const FONT = {
  ui: 'system-ui,"PingFang SC",sans-serif',
  mono: '"Space Mono","SFMono-Regular","PingFang SC",Menlo,ui-monospace,monospace',
  display: '"Michroma","ZCOOL QingKe HuangYou","PingFang SC",system-ui,sans-serif',
  han: '"ZCOOL QingKe HuangYou","PingFang SC","Hiragino Sans GB",system-ui,sans-serif',
  nixie: '"Helvetica Neue","Avenir Next",ui-sans-serif,system-ui,sans-serif',
};
const TUBES = {
  a: { x: 4, y: 4, w: 187, h: 108 },
  b: { x: 4, y: 120, w: 187, h: 80 },
  c: { x: 4, y: 220, w: 187, h: 92 },
};
const LED = { x: 6, y: 202, w: 183, h: 16 };
const FACE_KEY_Y = 316;
const COUNT_KEY_Y = 340;
const KEY_Y = 366;
export const SETTLEMENT_HOLD_MS = 3000;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const easeOut = (p) => 1 - (1 - p) ** 3;
const CHIP_TRACES = {
  up: [[156, 27], [185, 27], [185, 115], [171, 115], [171, 128]],
  down: [[156, 228], [185, 228], [185, 145], [171, 145], [171, 141]],
};
function tracePoint(trace, progress) {
  let total = 0;
  const lengths = [];
  for (let i = 1; i < trace.length; i++) {
    const dx = trace[i][0] - trace[i - 1][0];
    const dy = trace[i][1] - trace[i - 1][1];
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    total += length;
  }
  let distance = clamp(progress, 0, 1) * total;
  for (let i = 1; i < trace.length; i++) {
    const length = lengths[i - 1];
    if (distance <= length) {
      const p = length ? distance / length : 0;
      return [
        trace[i - 1][0] + (trace[i][0] - trace[i - 1][0]) * p,
        trace[i - 1][1] + (trace[i][1] - trace[i - 1][1]) * p,
      ];
    }
    distance -= length;
  }
  return trace.at(-1);
}
const nowMs = () => performance.now();

export function toTubeView(o, {
  opponentName = L('它', 'AI'),
  selectedBid = null,
  busy = false,
  connected = null,
  sandbox = false,
} = {}) {
  if (!o) return null;
  const me = o.players.find((p) => p.id === 'A');
  const opp = o.players.find((p) => p.id === 'B');
  const legal = o.legal ?? [];
  const legalTypes = new Set(legal.map((a) => a.type));
  const legalBids = legalTypes.has('bid')
    ? allLegalBids(o.currentBid, o.zhai, o.diceCount.you + o.diceCount.opp)
    : [];
  const legalCounts = [...new Set(legalBids.map((a) => a.count))];
  const legalFaces = selectedBid
    ? [...new Set(legalBids.filter((a) => a.count === selectedBid.count).map((a) => a.face))]
    : [];
  const declares = Object.fromEntries(
    ['blind', 'zhai', 'raise'].map((declaration) => [
      declaration,
      legal.some((a) => a.type === 'declare' && a.declaration === declaration),
    ]),
  );
  const alivePlayers = o.players.filter((p) => p.alive);
  const stakePerSeat = Math.round(o.potUnits * o.potMult);
  const roundStart = o.events?.findLast((e) => e.type === 'roundStart' && e.round === o.round);
  const modActions = (o.mods ?? [])
    .flatMap((m) => m.actions.map((a) => ({ ...a, mod: m.name })))
    .filter((a) => legalTypes.has(a.type));
  return {
    round: o.round,
    opponentName,
    connected,
    sandbox,
    busy,
    myTurn: o.turn === 'A' && !o.over && !busy && !!me?.alive,
    turn: o.turn,
    currentBid: o.currentBid ? { ...o.currentBid } : null,
    selectedBid: selectedBid ? { ...selectedBid } : null,
    myDice: o.yourDice ? [...o.yourDice] : null,
    myDiceCount: me?.diceCount ?? o.diceCount?.you ?? 0,
    oppDiceCount: opp?.diceCount ?? o.diceCount?.opp ?? 0,
    oppShown: [...(o.shown?.B ?? [])],
    myShown: [...(o.shown?.A ?? [])],
    // 桌面把本局筹码先托管：每名存活者各放 stakePerSeat，结算时整池交给赢家。
    // 这与引擎的净转账等价，却能让“从谁来、到池、再到谁”在画面上守恒。
    pot: o.potUnits * alivePlayers.length,
    potEffective: stakePerSeat * alivePlayers.length,
    potMult: o.potMult,
    stakePerSeat,
    activeSeats: alivePlayers.length,
    chips: {
      upper: opp?.chips ?? 0,
      lower: me?.chips ?? 0,
    },
    fuse: clamp(o.bidCount ?? 0, 0, 10),
    seal: roundStart?.commits?.B ? roundStart.commits.B.slice(0, 8).toUpperCase() : '--------',
    legal: {
      bid: legalTypes.has('bid'),
      faces: legalFaces,
      countDown: !!(selectedBid && legalCounts.some((count) => count < selectedBid.count)),
      countUp: !!(selectedBid && legalCounts.some((count) => count > selectedBid.count)),
      open: legalTypes.has('challenge'),
      peek: legalTypes.has('peek'),
      ...declares,
    },
    declarations: {
      blind: !!o.blind?.A,
      zhai: !!o.zhai,
      raise: !!o.raises?.A,
    },
    modActions,
  };
}

export function createTubeStage(canvas, handlers = {}) {
  const viewport = canvas.closest('.tube-viewport');
  const a11y = document.getElementById('tubeA11y');
  const speechEl = document.getElementById('tubeSpeech');
  const off = document.createElement('canvas');
  off.width = W * RS;
  off.height = H * RS;
  let ctx = off.getContext('2d');
  ctx.scale(RS, RS);
  const main2d = ctx;
  canvas.width = W * SS;
  canvas.height = H * SS;
  canvas.style.imageRendering = 'auto';

  const tubes = {};
  for (const [key, base] of Object.entries(TUBES)) {
    const pc = document.createElement('canvas');
    pc.width = base.w * RS;
    pc.height = base.h * RS;
    const pctx = pc.getContext('2d');
    pctx.scale(RS, RS);
    pctx.fillStyle = PH[key].glass;
    pctx.fillRect(0, 0, base.w, base.h);
    tubes[key] = { ...base, pc, pctx };
  }

  // 画布字体不会被 DOM 顺带加载；拿不到（大陆网络）就用系统字兜底，照常画。
  for (const [font, text] of [
    ['16px "ZCOOL QingKe HuangYou"', '开报盲斋抬戳扩局你池判定成立不掐中空个'],
    ['16px "Michroma"', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.'],
    ['700 16px "Space Mono"', '0123456789-+×·ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  ]) document.fonts?.load?.(font, text).catch(() => {});
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedMq.matches;
  const onReduced = (e) => (reduced = e.matches);
  reducedMq.addEventListener?.('change', onReduced);

  let active = false;
  let disposed = false;
  let view = null;
  let lastView = null;
  let phase = 'boot';
  let bootAt = 0;
  let power = 0;
  let warm = { a: 0, b: 0, c: 0, ctl: 0 };
  let timeScale = 1;
  let last = nowMs();
  let time = 0;
  let fr = 1;
  let parX = 0;
  let parY = 0;
  let shakeX = 0;
  let shakeY = 0;
  let flash = 0;
  let glitch = 0;
  let judLed = 0;
  let ledHitAt = -Infinity;
  let judHitAt = -Infinity;
  let bidPop = 0;
  let potPop = 0;
  let deny = null;
  let press = null;
  let pokeMenu = false;
  let moreMenu = false;
  let speech = { full: '', shown: '', n: 0, acc: 0, doneAt: 0 };
  let followSpeech = true;
  let thinking = false;
  let wave = { ph: 0, voice: 0, flat: 0, chaos: 0 };
  let reveal = null;
  let verdict = null;
  let float = null;
  let displayPot = 0;
  let displayStacks = { up: 0, down: 0 };
  let lastSpark = 0;
  let quality = 3;
  let lowFrames = 0;
  let renderError = null;
  let poolLevel = 0;
  let dialK = 0;
  const buttons = [];
  const particles = [];
  const tubeParticles = { a: [], b: [], c: [] };
  const packs = [];
  const ripples = [];

  function setActive(next) {
    active = !!next;
    viewport?.classList.toggle('hidden', !active);
    document.getElementById('app')?.classList.toggle('tube-mode', active);
    if (active && phase === 'boot' && bootAt === 0) bootAt = nowMs();
  }

  const onSpeechScroll = () => {
    if (!speechEl) return;
    followSpeech = speechEl.scrollHeight - speechEl.scrollTop - speechEl.clientHeight < 8;
  };
  const stopSpeechPointer = (event) => event.stopPropagation();
  speechEl?.addEventListener('scroll', onSpeechScroll);
  speechEl?.addEventListener('pointerdown', stopSpeechPointer);

  function syncSpeech() {
    if (!speechEl) return;
    speechEl.textContent = speech.shown;
    speechEl.classList.toggle('hidden', !speech.full);
    speechEl.dataset.typing = speech.n < speech.full.length ? 'true' : 'false';
    if (followSpeech) speechEl.scrollTop = speechEl.scrollHeight;
  }

  function announce(text) {
    if (a11y && text) a11y.textContent = text;
  }

  function setThinking(next) {
    thinking = !!next;
    if (thinking) {
      wave.chaos = Math.max(wave.chaos, 0.18);
      announce(isEnglish() ? 'AI is thinking.' : '对手正在思考。');
    }
  }

  function say(text, seat = 'B') {
    if (!text || seat !== 'B') return;
    speech = { full: text, shown: '', n: 0, acc: 0, doneAt: 0 };
    followSpeech = true;
    syncSpeech();
    announce(`${view?.opponentName ?? L('它', 'AI')}: ${text}`);
  }

  // 真流式管线的接点：上游逐 token 调用；现有非流式通道仍可调用 say()。
  function appendSpeech(token, seat = 'B') {
    if (!token || seat !== 'B') return;
    if (speech.n >= speech.full.length) speech.doneAt = 0;
    speech.full += token;
    syncSpeech();
  }

  function clearSpeech() {
    speech = { full: '', shown: '', n: 0, acc: 0, doneAt: 0 };
    followSpeech = true;
    syncSpeech();
  }

  function update(next) {
    if (!next) return;
    lastView = view;
    view = next;
    const effectivePot = (value) => value?.potEffective ?? (value?.pot ?? 0) * (value?.potMult ?? 1);
    const stackTarget = (value, side) => (value?.chips?.[side === 'up' ? 'upper' : 'lower'] ?? 0) - (value?.stakePerSeat ?? 0);
    const newRound = lastView?.round !== next.round;
    if (!Number.isFinite(displayPot) || lastView == null || newRound) {
      displayPot = effectivePot(next);
      displayStacks = { up: stackTarget(next, 'up'), down: stackTarget(next, 'down') };
      if (newRound) packs.length = 0;
    }
    if (newRound) {
      verdict = null;
      reveal = null;
      float = null;
      judLed = 0;
      wave.flat = 0;
      speech = { full: speech.full, shown: speech.shown, n: speech.n, acc: 0, doneAt: speech.doneAt };
    }
    const oldBid = lastView?.currentBid;
    const newBid = next.currentBid;
    const bidChanged = !!(newBid && (!oldBid || oldBid.count !== newBid.count || oldBid.face !== newBid.face || oldBid.player !== newBid.player));
    const stakeDelta = Math.max(0, (next.stakePerSeat ?? 0) - (lastView?.stakePerSeat ?? next.stakePerSeat ?? 0));
    if (!newRound && stakeDelta > 0 && !reveal) {
      bidPop = 1;
      const lead = bidChanged && newBid.player === 'B' ? 'up' : 'down';
      const follow = lead === 'up' ? 'down' : 'up';
      ledHitAt = time;
      packs.push({ from: lead, born: time, dur: reduced ? 120 : 390, amount: stakeDelta, flow: 'in' });
      packs.push({ from: follow, born: time + (reduced ? 40 : 120), dur: reduced ? 120 : 390, amount: stakeDelta, flow: 'in' });
      handlers.sfx?.tick?.();
    } else if (!newRound && !reveal && packs.length === 0) {
      displayPot = effectivePot(next);
      displayStacks = { up: stackTarget(next, 'up'), down: stackTarget(next, 'down') };
    }
    if (bidChanged) {
      bidPop = 1;
      ledHitAt = time;
    }
    const label = newBid
      ? (isEnglish()
          ? `${newBid.player === 'A' ? 'You' : next.opponentName} bids ${newBid.count} × ${newBid.face}`
          : `${newBid.player === 'A' ? '你' : next.opponentName}报 ${newBid.count} 个 ${newBid.face}`)
      : (isEnglish() ? `Round ${next.round}` : `第 ${next.round} 局`);
    announce(label);
  }

  function finishBoot() {
    power = 1;
    warm = { a: 1, b: 1, c: 1, ctl: 1 };
    phase = 'idle';
  }

  function scaledWait(ms) {
    if (reduced) ms = Math.min(150, ms * 0.35);
    return new Promise((resolve) => {
      let acc = 0;
      let prev = nowMs();
      const tick = () => {
        const n = nowMs();
        acc += (n - prev) * timeScale;
        prev = n;
        if (acc >= ms || disposed) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function burstTube(key, x, y, count, palette, speed = 1.5) {
    if (reduced || quality < 2) count = Math.min(3, count);
    const list = tubeParticles[key];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random());
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.8, life: 1, c: palette[i % palette.length] });
    }
  }

  function shellBurst(x, y, count, color) {
    if (reduced || quality < 2) count = Math.min(2, count);
    for (let i = 0; i < count; i++) particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 1.7,
      vy: -0.5 - Math.random() * 1.4,
      life: 1,
      c: color,
    });
  }

  async function showShowdown({ rv, re, by, sayText = '', names = {} }) {
    if (!active) return false;
    phase = 'seq';
    timeScale = 1;
    pokeMenu = false;
    moreMenu = false;
    wave.chaos = 1;
    reveal = {
      rv,
      re,
      by,
      names,
      upper: rv.dice.B ?? [],
      lower: rv.dice.A ?? [],
      upperN: 0,
      lowerN: rv.dice.A?.length ?? 0,
      countN: 0,
      countIndex: 0,
    };
    if (sayText) say(sayText, by);
    await scaledWait(240);
    flash = 1;
    glitch = 1;
    shakeX = reduced ? 0 : 4;
    shakeY = reduced ? 0 : 2;
    handlers.sfx?.slam?.();
    wave.flat = 1;
    const upperFaces = reveal.upper;
    for (let i = 0; i < upperFaces.length; i++) {
      reveal.upperN = i + 1;
      burstTube('a', 27 + i * 30 + 11, 69, 6, [PH.a.mid, PH.a.hot]);
      handlers.sfx?.land?.();
      await scaledWait(160);
    }
    const all = [...upperFaces, ...reveal.lower];
    const isHit = (face) => face === rv.bid.face || (!rv.zhai && face === 1);
    for (let i = 0; i < all.length; i++) {
      reveal.countIndex = i + 1;
      if (isHit(all[i])) {
        reveal.countN++;
        handlers.sfx?.tick?.();
        const key = i < upperFaces.length ? 'a' : 'c';
        const j = i < upperFaces.length ? i : i - upperFaces.length;
        burstTube(key, (key === 'a' ? 27 : 10) + j * (key === 'a' ? 30 : 36) + 12, key === 'a' ? 69 : 45, 4, [PH[key].hot]);
        await scaledWait(150);
      }
    }
    const success = rv.calza ? !!rv.exact : !!rv.stands;
    const actual = reveal.countN;
    const winnerTag = re.winner === 'A' ? L('你', 'you') : L('它', 'the AI');
    const loserTag = re.loser === 'A' ? L('你', 'you') : L('它', 'the AI');
    verdict = {
      title: rv.calza
        ? (rv.exact ? L('掐  中', 'CALZA') : L('掐  空', 'MISSED'))
        : success ? L('成  立', 'STANDS') : L('不 成 立', 'FALSE'),
      relation: `${actual} ${rv.calza ? (rv.exact ? '=' : '≠') : success ? '≥' : '<'} ${rv.bid.count}`,
    };
    judLed = 1;
    judHitAt = time;
    announce(isEnglish()
      ? `${verdict.title}: actual ${actual}; ${rv.calza ? `calza ${rv.bid.count}` : `bid ${rv.bid.count}`}. ${loserTag} lose; ${winnerTag} take the ${Math.round(displayPot)} pot.`
      : `${verdict.title}：实中 ${actual}，${rv.calza ? `掐 ${rv.bid.count}` : `报价 ${rv.bid.count}`}；${loserTag}输，托管池 ${Math.round(displayPot)} 全部归${winnerTag}`);
    flash = Math.max(flash, 0.25);
    if (!reduced) {
      shakeX = 3;
      shakeY = 2;
    }
    handlers.sfx?.verdict?.();
    burstTube('b', TUBES.b.w / 2, 50, 24, [PH.b.hot, PH.b.mid], 2.2);
    await scaledWait(85);
    const winnerSide = re.winner === 'A' ? 'down' : 'up';
    const startPot = Math.max(0, displayPot);
    const steps = clamp(Math.ceil(startPot / 3), 5, 10);
    const packetAmount = steps ? startPot / steps : 0;
    for (let i = 0; i < steps; i++) {
      packs.push({
        from: winnerSide,
        born: time,
        dur: reduced ? 120 : 390,
        amount: packetAmount,
        flow: 'out',
        reverse: true,
      });
      handlers.sfx?.chips?.();
      await scaledWait(85);
    }
    await scaledWait(reduced ? 130 : 410);
    displayPot = 0;
    if (startPot) {
      float = { text: `+${Math.round(startPot)}`, key: winnerSide === 'down' ? 'c' : 'a', born: time };
      const key = winnerSide === 'down' ? 'c' : 'a';
      burstTube(key, key === 'c' ? 150 : 24, key === 'c' ? 18 : 94, 8, [PH[key].hot, PH[key].mid]);
      handlers.sfx?.jackpot?.();
    }
    phase = 'settle';
    timeScale = 1;
    // 结算是需要阅读的静态信息，不应被点按加速或“减少动态效果”压缩。
    await new Promise((resolve) => setTimeout(resolve, SETTLEMENT_HOLD_MS));
    return true;
  }

  function clearShowdown() {
    reveal = null;
    verdict = null;
    float = null;
    judLed = 0;
    judHitAt = -Infinity;
    wave.flat = 0;
    if (phase !== 'boot') phase = 'idle';
    timeScale = 1;
  }

  function pillow(c, x, y, w, h, r, bow) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.quadraticCurveTo(x + w / 2, y - bow, x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.quadraticCurveTo(x + w + bow, y + h / 2, x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.quadraticCurveTo(x + w / 2, y + h + bow, x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.quadraticCurveTo(x - bow, y + h / 2, x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function rr(c, x, y, w, h, r) {
    const k = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + k, y);
    c.arcTo(x + w, y, x + w, y + h, k);
    c.arcTo(x + w, y + h, x, y + h, k);
    c.arcTo(x, y + h, x, y, k);
    c.arcTo(x, y, x + w, y, k);
    c.closePath();
  }

  function tx(text, x, y, size, color, { bold = false, mono = false, font = null, align = 'left', alpha = 1, glow = 0, baseline = 'top', weight = null } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    const w = weight ?? (bold ? '700' : size <= 8 ? '600' : '400');
    ctx.font = `${w} ${size}px ${FONT[font ?? (mono ? 'mono' : 'ui')]}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (glow && quality > 1) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow * RS;
    }
    ctx.fillText(String(text), x, y);
    ctx.restore();
  }

  function glowOn(color, blur) {
    if (quality < 2) return;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * RS;
  }

  function glowOff() {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  // 磷光骰：圆角玻璃块＋发光圆点。1 点（癞子）外加一圈环，飞局里一眼认出万能牌。
  function drawDie(x, y, size, face, pal, hit = false, covered = false) {
    ctx.save();
    rr(ctx, x, y, size, size, size * 0.22);
    if (covered) {
      ctx.fillStyle = pal.deep;
      ctx.globalAlpha *= 0.85;
      ctx.fill();
      ctx.setLineDash([1.6, 1.6]);
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = pal.lo;
      ctx.stroke();
      ctx.setLineDash([]);
      const g = GLY[(time / 150 + x) % GLY.length | 0];
      tx(g, x + size / 2, y + size / 2 + 0.6, size * 0.42, pal.mid, { mono: true, align: 'center', baseline: 'middle', alpha: 0.7 });
    } else {
      const body = ctx.createLinearGradient(x, y, x, y + size);
      body.addColorStop(0, pal.lo);
      body.addColorStop(1, pal.deep);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = pal.mid;
      ctx.stroke();
      ctx.globalAlpha *= 0.22;
      ctx.fillStyle = pal.hot;
      rr(ctx, x + size * 0.12, y + size * 0.08, size * 0.76, size * 0.16, size * 0.08);
      ctx.fill();
      ctx.globalAlpha /= 0.22;
      const u = size / 4;
      const pr = Math.max(1, size * 0.085);
      ctx.fillStyle = pal.hot;
      glowOn(pal.mid, 2.5);
      for (const i of PIPS[face] ?? []) {
        ctx.beginPath();
        ctx.arc(x + u * (1 + (i % 3)), y + u * (1 + ((i / 3) | 0)), face === 1 ? pr * 1.45 : pr, 0, Math.PI * 2);
        ctx.fill();
      }
      glowOff();
      if (face === 1) {
        ctx.strokeStyle = pal.hot;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (hit) {
      rr(ctx, x - 1, y - 1, size + 2, size + 2, size * 0.25);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = pal.hot;
      glowOn(pal.mid, 5);
      ctx.stroke();
      glowOff();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = pal.hot;
      ctx.fill();
    }
    ctx.restore();
  }

  // 筹码不画成赌场圆片：一粒能量珠，沿管线流进储液管。
  function puck(x, y, pal, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    glowOn(pal.mid, 4);
    ctx.fillStyle = pal.mid;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    glowOff();
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(x - 0.6, y - 0.6, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawChipDock(x, y, value, pal, pulse = 0) {
    const v = Math.round(value);
    const debt = v < 0;
    ctx.save();
    rr(ctx, x, y, 46, 18, 5);
    ctx.globalAlpha *= 0.8;
    ctx.fillStyle = pal.deep;
    ctx.fill();
    ctx.globalAlpha /= 0.8;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = pal.lo;
    ctx.stroke();
    // 原子轨道徽：两道椭圆＋核
    const cx = x + 9;
    const cy = y + 9;
    ctx.globalAlpha *= debt ? 0.4 : 1;
    ctx.strokeStyle = pal.mid;
    ctx.lineWidth = 0.6;
    for (const rot of [-0.55, 0.55]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, 2.3, rot, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
    ctx.fill();
    const orbit = time / 520;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(orbit) * 6 * Math.cos(-0.55) - Math.sin(orbit) * 2.3 * Math.sin(-0.55), cy + Math.cos(orbit) * 6 * Math.sin(-0.55) + Math.sin(orbit) * 2.3 * Math.cos(-0.55), 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (debt) {
      ctx.strokeStyle = pal.hot;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 16);
      ctx.lineTo(x + 16, y + 2);
      ctx.stroke();
    }
    tx(String(v), x + 43, y + 9.6, 9.5, pal.hot, { bold: true, mono: true, align: 'right', baseline: 'middle', glow: 2 });
    if (pulse > 0) {
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = pal.hot;
      rr(ctx, x - pulse * 2, y - pulse, 46 + pulse * 4, 18 + pulse * 2, 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 托管池：一支竖立的储液管，液面随池子涨落（对数刻度，底注也看得见）。
  function drawReservoir(x, y, w, h, value, pal, pulse = 0) {
    const target = value > 0 ? clamp(Math.log2(1 + value) / 7, 0.1, 1) : 0;
    poolLevel += (target - poolLevel) * Math.min(1, 0.14 * fr);
    ctx.save();
    rr(ctx, x, y, w, h, w / 2);
    ctx.fillStyle = pal.deep;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const top = y + h * (1 - poolLevel);
    const liquid = ctx.createLinearGradient(0, top, 0, y + h);
    liquid.addColorStop(0, pal.mid);
    liquid.addColorStop(1, pal.lo);
    ctx.fillStyle = liquid;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, top + Math.sin(time / 260) * 0.5, w, y + h - top + 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.hot;
    ctx.fillRect(x, top + Math.sin(time / 260) * 0.5, w, 0.7);
    if (poolLevel > 0.05) {
      for (let i = 0; i < 4; i++) {
        const k = ((time / 1400 + i * 0.27) % 1);
        const by = y + h - k * (y + h - top);
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.beginPath();
        ctx.arc(x + w * (0.3 + 0.4 * ((i * 37) % 10) / 10), by, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = pal.mid;
    rr(ctx, x, y, w, h, w / 2);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 2.5, y + w / 2, 1, h - w);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.lo;
    ctx.lineWidth = 0.6;
    for (let i = 1; i < 5; i++) {
      const ty = y + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x + w + 1, ty);
      ctx.lineTo(x + w + (i % 2 ? 3 : 2), ty);
      ctx.stroke();
    }
    tx(Math.round(value), x + w / 2, y + h + 2, 9, pal.hot, { bold: true, mono: true, align: 'center', glow: 2 });
    if (pulse > 0) {
      ctx.globalAlpha = pulse * 0.8;
      ctx.strokeStyle = pal.hot;
      rr(ctx, x - pulse * 2, y - pulse * 2, w + pulse * 4, h + pulse * 4, w / 2 + pulse * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 倍率表：模拟指针，对数刻度 ×1 → ×16。
  function drawDial(cx, cy, r, mult, pal) {
    const A0 = Math.PI * 0.75;
    const SW = Math.PI * 1.5;
    const target = clamp(Math.log2(Math.max(1, mult)) / 4, 0, 1);
    dialK += (target - dialK) * Math.min(1, 0.12 * fr);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = pal.deep;
    ctx.fill();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = pal.lo;
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = pal.mid;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, A0 + SW * 0.5, A0 + SW);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.6;
    for (let i = 0; i <= 8; i++) {
      const a = A0 + (SW * i) / 8;
      const inner = i % 2 ? r - 3 : r - 4.5;
      ctx.strokeStyle = i % 2 ? pal.lo : pal.mid;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1));
      ctx.stroke();
    }
    const a = A0 + SW * dialK + (thinking ? Math.sin(time / 90) * 0.02 : 0);
    ctx.strokeStyle = pal.hot;
    ctx.lineWidth = 0.9;
    glowOn(pal.mid, 3);
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 2, cy - Math.sin(a) * 2);
    ctx.lineTo(cx + Math.cos(a) * (r - 2.5), cy + Math.sin(a) * (r - 2.5));
    ctx.stroke();
    glowOff();
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();
    const label = Number.isInteger(mult) ? `×${mult}` : `×${mult.toFixed(1)}`;
    tx(label, cx, cy + r * 0.42, 6.5, pal.hot, { bold: true, mono: true, align: 'center', glow: 1.5 });
    ctx.restore();
  }

  // 辉光管：菱形阳极网＋叠放的阴极鬼影＋点亮的那一根。
  function nixie(x, y, w, h, digit, pal, lit = true) {
    ctx.save();
    rr(ctx, x, y, w, h, w * 0.38);
    ctx.fillStyle = pal.deep;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = pal.lo;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    for (let i = -h; i < w + h; i += 2.6) {
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h * 0.55, y + h);
      ctx.moveTo(x + i + h * 0.55, y);
      ctx.lineTo(x + i, y + h);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const size = h * 0.74;
    const cx = x + w / 2;
    const cy = y + h / 2 + 1.5;
    for (const ghost of ['8', '0', '3']) tx(ghost, cx, cy, size, pal.lo, { font: 'nixie', align: 'center', baseline: 'middle', alpha: 0.16, weight: '200' });
    if (lit && digit != null && digit !== '') {
      const flicker = quality > 1 ? 0.94 + 0.06 * Math.sin(time / 37 + x) : 1;
      tx(digit, cx, cy, size, pal.mid, { font: 'nixie', align: 'center', baseline: 'middle', glow: 9, alpha: 0.9 * flicker, weight: '200' });
      tx(digit, cx, cy, size, pal.hot, { font: 'nixie', align: 'center', baseline: 'middle', glow: 2, alpha: flicker, weight: '200' });
    }
    ctx.restore();
    const sheen = ctx.createLinearGradient(x, 0, x + w, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
    sheen.addColorStop(0.22, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(0.75, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.08)');
    rr(ctx, x, y, w, h, w * 0.38);
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(255,226,196,0.28)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + w * 0.2, y + h - 1.6, w * 0.6, 1.6);
    ctx.restore();
  }

  function drawNixieRow(left, sym, right, pal, tube, { lit = true, y = 17, capH = 40 } = {}) {
    const capW = 21;
    const gap = 2.5;
    const mid = 22;
    const ls = left == null ? [null] : [...String(left)];
    const rs = right == null ? [null] : [...String(right)];
    const span = (n) => n * capW + (n - 1) * gap;
    let x = tube.w / 2 - (span(ls.length) + mid + span(rs.length)) / 2;
    for (const d of ls) {
      nixie(x, y, capW, capH, d, pal, lit && d != null);
      x += capW + gap;
    }
    x += mid / 2 - gap;
    tx(sym, x, y + capH / 2 + 1, sym.length > 1 || /[^\x00-\x7f]/.test(sym) ? 10 : 13, pal.mid, { font: /[^\x00-\x7f]/.test(sym) ? 'han' : 'mono', align: 'center', baseline: 'middle', glow: 4, alpha: lit ? 1 : 0.35 });
    x += mid / 2;
    for (const d of rs) {
      nixie(x, y, capW, capH, d, pal, lit && d != null);
      x += capW + gap;
    }
  }

  function drawRoundCounter(pal, tube) {
    const y = tube.h - 16;
    tx(L('局', 'R'), 6, y - 1, 9, pal.mid, { font: 'han' });
    // 机械计数器：三枚滚轮，末轮发亮。
    ctx.save();
    rr(ctx, 23, y - 2, 32, 13, 2.5);
    ctx.fillStyle = pal.deep;
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = pal.lo;
    ctx.stroke();
    const digits = String(view?.round ?? 1).padStart(3, '0').slice(-3);
    [...digits].forEach((digit, i) => {
      const wheel = ctx.createLinearGradient(0, y, 0, y + 9);
      wheel.addColorStop(0, 'rgba(0,0,0,0.6)');
      wheel.addColorStop(0.5, 'rgba(255,255,255,0.06)');
      wheel.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = wheel;
      ctx.fillRect(26 + i * 9.4, y, 7.6, 9);
      tx(digit, 29.8 + i * 9.4, y + 4.8, 6.5, i === 2 ? pal.hot : pal.mid, { mono: true, bold: true, align: 'center', baseline: 'middle', glow: i === 2 ? 2 : 0 });
    });
    ctx.restore();
  }

  function drawBidReadout(sel, pal, tube, enabled) {
    const y = 68;
    ctx.save();
    ctx.globalAlpha = enabled ? 1 : 0.42;
    ctx.strokeStyle = pal.lo;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(tube.w / 2 - 30, y + 18.5);
    ctx.lineTo(tube.w / 2 + 30, y + 18.5);
    ctx.stroke();
    tx(sel.count, tube.w / 2 - 19, y + 9.5, 16, pal.hot, { bold: true, mono: true, align: 'center', baseline: 'middle', glow: 3 });
    tx(L('个', '×'), tube.w / 2 - 4, y + 10.5, 8, pal.mid, { font: 'han', align: 'center', baseline: 'middle' });
    drawDie(tube.w / 2 + 7, y, 18, sel.face, pal);
    ctx.restore();
  }

  // 镀铬管框：金属环＋黑胶圈，管与管之间露出搪瓷机壳。
  function tubeFrame(tube) {
    ctx.save();
    const o = 3;
    const chrome = ctx.createLinearGradient(tube.x, tube.y - o, tube.x + tube.w * 0.35, tube.y + tube.h + o);
    chrome.addColorStop(0, CH.chromeHi);
    chrome.addColorStop(0.18, CH.chrome);
    chrome.addColorStop(0.5, CH.chromeLo);
    chrome.addColorStop(0.78, CH.chrome);
    chrome.addColorStop(1, CH.chromeLo);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, tube.x - o + 0.6, tube.y - o + 1.4, tube.w + o * 2, tube.h + o * 2, 16);
    ctx.fill();
    ctx.fillStyle = chrome;
    rr(ctx, tube.x - o, tube.y - o, tube.w + o * 2, tube.h + o * 2, 16);
    ctx.fill();
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    rr(ctx, tube.x - o + 0.4, tube.y - o + 0.4, tube.w + o * 2 - 0.8, tube.h + o * 2 - 0.8, 15.6);
    ctx.stroke();
    ctx.fillStyle = '#050707';
    rr(ctx, tube.x - 1.2, tube.y - 1.2, tube.w + 2.4, tube.h + 2.4, 14.5);
    ctx.fill();
    ctx.restore();
  }

  function drawTube(key, index, drawContent) {
    const tube = tubes[key];
    const pal = PH[key];
    tubeFrame(tube);
    const p = tube.pctx;
    const fade = 1 - 0.7 ** Math.max(fr, 0);
    if (fade > 0) {
      p.fillStyle = `rgba(${pal.fade},${fade.toFixed(3)})`;
      p.fillRect(0, 0, tube.w, tube.h);
    }
    const save = ctx;
    ctx = p;
    const level = warm[key];
    if (level > 0 && level < 0.35) {
      ctx.fillStyle = pal.hot;
      ctx.fillRect(tube.w / 2 - 2, tube.h / 2 - 1, 4, 2);
    } else if (level >= 0.35 && level < 0.7) {
      const k = (level - 0.35) / 0.35;
      ctx.fillStyle = pal.hot;
      ctx.fillRect(tube.w / 2 - (tube.w / 2 - 6) * k, tube.h / 2 - 1, (tube.w - 12) * k, 1);
    }
    ctx = save;

    ctx.save();
    pillow(ctx, tube.x, tube.y, tube.w, tube.h, 13, 2.5);
    ctx.clip();
    const glass = ctx.createRadialGradient(tube.x + tube.w / 2, tube.y + tube.h * 0.45, 2, tube.x + tube.w / 2, tube.y + tube.h / 2, tube.w * 0.62);
    glass.addColorStop(0, pal.deep);
    glass.addColorStop(1, pal.glass);
    ctx.fillStyle = glass;
    ctx.fillRect(tube.x - 3, tube.y - 3, tube.w + 6, tube.h + 6);
    ctx.save();
    pillow(ctx, tube.x + 3, tube.y + 3, tube.w - 6, tube.h - 6, 11, 2);
    ctx.clip();
    ctx.drawImage(tube.pc, tube.x, tube.y, tube.w, tube.h);
    if (level >= 0.7) {
      ctx.save();
      ctx.translate(tube.x, tube.y);
      ctx.globalAlpha = clamp((level - 0.7) / 0.3, 0, 1);
      drawContent(pal, { ...tube, x: 0, y: 0 });
      ctx.restore();
    }
    if (quality > 1) {
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#000';
      for (let y = tube.y + (index % 2); y < tube.y + tube.h; y += 1.5) ctx.fillRect(tube.x, y, tube.w, 0.5);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    const shade = ctx.createRadialGradient(tube.x + tube.w / 2, tube.y + tube.h / 2, tube.h * 0.3, tube.x + tube.w / 2, tube.y + tube.h / 2, tube.w * 0.6);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = shade;
    pillow(ctx, tube.x, tube.y, tube.w, tube.h, 13, 2.5);
    ctx.fill();
    // 玻璃反光：左上一道斜光
    const glare = ctx.createLinearGradient(tube.x, tube.y, tube.x + tube.w * 0.55, tube.y + tube.h * 0.7);
    glare.addColorStop(0, 'rgba(255,255,255,0.10)');
    glare.addColorStop(0.35, 'rgba(255,255,255,0.025)');
    glare.addColorStop(0.36, 'rgba(255,255,255,0)');
    glare.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glare;
    ctx.fill();
    const edge = ctx.createLinearGradient(0, tube.y, 0, tube.y + tube.h);
    edge.addColorStop(0, 'rgba(255,255,255,.26)');
    edge.addColorStop(0.35, 'rgba(255,255,255,.04)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.8;
    pillow(ctx, tube.x + 1.5, tube.y + 1.5, tube.w - 3, tube.h - 3, 12, 2.2);
    ctx.stroke();
    ctx.restore();
  }

  // 示波器：方格刻度＋带辉光的声纹。
  function drawWave(pal) {
    const y0 = 40;
    ctx.save();
    ctx.strokeStyle = pal.lo;
    ctx.lineWidth = 0.4;
    ctx.globalAlpha *= 0.45;
    ctx.beginPath();
    for (let x = 10; x <= 178; x += 12) {
      ctx.moveTo(x, 26);
      ctx.lineTo(x, 54);
    }
    for (let y = 26; y <= 54; y += 7) {
      ctx.moveTo(10, y);
      ctx.lineTo(178, y);
    }
    ctx.stroke();
    ctx.globalAlpha /= 0.45;
    ctx.setLineDash([0.6, 1.4]);
    ctx.globalAlpha *= 0.8;
    ctx.beginPath();
    ctx.moveTo(10, y0);
    ctx.lineTo(178, y0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    wave.ph += (0.09 + wave.chaos * 0.3 + (thinking ? 0.12 : 0)) * fr;
    wave.voice *= 0.86 ** fr;
    wave.chaos *= 0.985 ** fr;
    const amp = (5 + wave.voice * 7 + wave.chaos * 12 + (thinking ? 3 : 0)) * (1 - wave.flat);
    ctx.save();
    ctx.strokeStyle = pal.hot;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    glowOn(pal.mid, 5);
    ctx.beginPath();
    for (let x = 10; x <= 177; x += 1.5) {
      const k = (x - 10) / 167;
      const y = Math.sin(k * 9 + wave.ph) * Math.sin(k * 23 - wave.ph * 1.7) * amp;
      if (x === 10) ctx.moveTo(x, y0 + y);
      else ctx.lineTo(x, y0 + y);
    }
    ctx.stroke();
    glowOff();
    ctx.fillStyle = pal.hot;
    ctx.beginPath();
    ctx.arc(177, y0, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function stepTubeParticles(key) {
    const list = tubeParticles[key];
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.x += p.vx * fr;
      p.y += p.vy * fr;
      p.vy += 0.045 * fr;
      p.life -= 0.025 * fr;
      if (p.life <= 0) list.splice(i, 1);
      else {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawUpper(pal, tube) {
    const opponentLabel = [...(view?.opponentName ?? L('它', 'AI'))].length > 14
      ? `${[...(view?.opponentName ?? L('它', 'AI'))].slice(0, 14).join('')}…`
      : view?.opponentName ?? L('它', 'AI');
    tx(opponentLabel, 7, 6.5, 7.2, pal.mid, { font: 'display', glow: 2.5 });
    drawChipDock(tube.w - 52, 19, displayStacks.up, pal, potPop);
    const online = view?.connected !== false;
    const blink = thinking ? 0.45 + 0.55 * Math.abs(Math.sin(time / 180)) : 1;
    ctx.save();
    ctx.globalAlpha *= online ? blink : 0.5;
    ctx.fillStyle = online ? pal.hot : pal.lo;
    glowOn(pal.mid, online ? 4 : 0);
    ctx.beginPath();
    ctx.arc(isEnglish() ? tube.w - 40 : tube.w - 29, 10, 1.8, 0, Math.PI * 2);
    ctx.fill();
    glowOff();
    ctx.restore();
    tx(thinking ? L('在想', 'THINKING') : L('在看', 'WATCH'), tube.w - 8, 10.3, isEnglish() ? 5.4 : 7, thinking ? pal.hot : pal.mid, { mono: true, align: 'right', baseline: 'middle' });
    drawWave(pal);
    const count = reveal ? reveal.upper.length : view?.oppDiceCount ?? 0;
    for (let i = 0; i < count; i++) {
      const face = reveal?.upper[i] ?? view?.oppShown?.[i];
      const shown = reveal ? i < reveal.upperN : i < (view?.oppShown?.length ?? 0);
      drawDie(27 + i * 30, 58, 22, shown ? face : 1, pal, false, !shown);
    }
    if (speech.full && speech.n < speech.full.length) {
      speech.acc += fr;
      if (speech.acc > 2.2) {
        speech.acc = 0;
        speech.n++;
        speech.shown = speech.full.slice(0, speech.n);
        if (speech.n >= speech.full.length) speech.doneAt = time;
        syncSpeech();
        wave.voice = 1;
        if (speech.n % 3 === 0) handlers.sfx?.type?.();
      }
    }
    ctx.save();
    rr(ctx, 5.5, 86.5, 29, 11, 3);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = pal.lo;
    ctx.stroke();
    ctx.restore();
    tx(L('AI生成', 'AI TEXT'), 20, 92.3, 6, pal.mid, { mono: true, align: 'center', baseline: 'middle' });
    stepTubeParticles('a');
  }

  function drawCenter(pal, tube) {
    const bid = reveal?.rv.bid ?? view?.currentBid;
    const bidder = bid?.player === 'A' ? L('你', 'YOU') : [...(view?.opponentName ?? L('它', 'AI'))].slice(0, 10).join('');
    tx(verdict ? L('· 判 定 ·', '· RULING ·') : reveal ? L('· 点 清 ·', '· COUNT ·') : thinking ? L('· 对手在想 ·', '· AI THINKING ·') : bid ? (isEnglish() ? `· ${bidder} BID ·` : `· ${bidder} 报 ·`) : L('· 待 报 ·', '· AWAIT BID ·'),
      tube.w / 2, 5.5, 6.5, pal.mid, { mono: true, align: 'center', alpha: 0.85 });
    drawDial(22, 36, 13, view?.potMult ?? 1, pal);
    tx(L('倍率', 'MULT'), 22, 52, 5.5, pal.lo, { mono: true, align: 'center' });
    tx(L('池', 'POT'), tube.w - 17, 5, 6, pal.lo, { font: isEnglish() ? 'mono' : 'han', align: 'center' });
    drawReservoir(tube.w - 24, 14, 14, 44, displayPot, pal, potPop);
    if (verdict) {
      const sym = verdict.relation.split(' ')[1] ?? '·';
      drawNixieRow(reveal?.countN ?? 0, sym, bid?.count, pal, tube, { y: 14, capH: 36 });
      const blink = 0.86 + 0.14 * Math.sin(time / 120);
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle = pal.mid;
      glowOn(pal.mid, 8);
      rr(ctx, 44, 55, tube.w - 88, 14, 3);
      ctx.fill();
      glowOff();
      ctx.restore();
      tx(verdict.title, tube.w / 2, 62.5, 9.5, pal.glass, { font: 'han', align: 'center', baseline: 'middle' });
    } else if (reveal) {
      drawNixieRow(reveal.countN, '/', bid?.count, pal, tube, { y: 14, capH: 36 });
    } else if (bid) {
      const scale = 1 + bidPop * 0.1;
      ctx.save();
      ctx.translate(tube.w / 2, 37);
      ctx.scale(scale, scale);
      ctx.translate(-tube.w / 2, -37);
      drawNixieRow(bid.count, L('个', '×'), bid.face, pal, tube);
      ctx.restore();
    } else {
      drawNixieRow(null, '·', null, pal, tube, { lit: false });
    }
    stepTubeParticles('b');
  }

  function addButton(id, x, y, w, h, label, enabled = true, style = 'dark', font = 10, extra = {}) {
    buttons.push({ id, x, y, w, h, label, enabled, style, font, ...extra });
  }

  function drawLower(pal, tube) {
    drawChipDock(tube.w - 52, 5, displayStacks.down, pal, potPop);
    tx(L('你', 'YOU'), 7, 7, 8, pal.mid, { font: isEnglish() ? 'display' : 'han', glow: 2 });

    const faces = reveal?.lower ?? view?.myDice;
    const count = reveal?.lower.length ?? view?.myDiceCount ?? 0;
    for (let i = 0; i < count; i++) {
      const face = faces?.[i] ?? 1;
      const hit = !!(reveal && reveal.countIndex > reveal.upper.length + i && (face === reveal.rv.bid.face || (!reveal.rv.zhai && face === 1)));
      drawDie(10 + i * 36, 28, 30, face, pal, hit, !faces);
    }
    if (!faces && view?.legal.peek) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time / 420));
      tx(L('触摸骰仓看骰', 'TAP DICE BAY TO PEEK'), tube.w / 2, 13, isEnglish() ? 5.2 : 6.5, pal.mid, { mono: true, align: 'center', alpha: pulse });
      addButton('peek', TUBES.c.x + 6, TUBES.c.y + 22, TUBES.c.w - 12, 47, '', true);
    }

    const sel = view?.selectedBid;
    if (sel && !reveal) {
      const enabled = view.myTurn && view.legal.bid;
      drawBidReadout(sel, pal, tube, enabled);
    }
    drawRoundCounter(pal, tube);
    stepTubeParticles('c');
  }

  // 宝石灯排：五盏琥珀（阶梯）＋五盏红（深水）＋一盏判定灯，镀铬灯圈。
  function lamp(x, y, r, on, color, offColor) {
    ctx.save();
    ctx.fillStyle = CH.chromeLo;
    ctx.beginPath();
    ctx.arc(x, y, r + 0.9, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0.2, x, y, r);
    g.addColorStop(0, on ? '#fff6e0' : 'rgba(255,255,255,0.25)');
    g.addColorStop(0.35, on ? color : offColor);
    g.addColorStop(1, on ? color : offColor);
    if (on) glowOn(color, 6);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLedBar() {
    const ledX = (i) => (i < 5 ? LED.x + 9 + i * 12.5 : LED.x + 81 + (i - 5) * 12.5);
    ctx.save();
    rr(ctx, LED.x, LED.y + 1, LED.w, LED.h - 2, 4);
    ctx.fillStyle = '#0b1616';
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(LED.x + 72, LED.y + 3, 0.6, LED.h - 6);
    ctx.fillRect(LED.x + 145, LED.y + 3, 0.6, LED.h - 6);
    ctx.restore();
    const fuse = view?.fuse ?? 0;
    const stepPulse = phase === 'boot' ? 0 : Math.max(0, 1 - (time - ledHitAt) / 520);
    for (let i = 0; i < 10; i++) {
      const x = ledX(i) + 5;
      const deep = i >= 5;
      const on = phase === 'boot' ? ((time / 70) | 0) % 10 === i : i < fuse;
      lamp(x, LED.y + 11, 2.4, on, deep ? CH.red : CH.mustard, deep ? CH.redLo : CH.amberLo);
      if (i === fuse - 1 && stepPulse > 0) {
        ctx.save();
        ctx.globalAlpha = stepPulse;
        ctx.strokeStyle = deep ? CH.red : CH.mustard;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(x, LED.y + 11, 3.4 + (1 - stepPulse) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (phase !== 'boot' && fuse > 0 && time - lastSpark > 440) {
      lastSpark = time;
      const x = ledX(Math.min(9, fuse - 1)) + 5;
      shellBurst(x, LED.y + 9, fuse > 5 ? 2 : 1, fuse > 5 ? CH.red : CH.mustard);
    }
    tx(L('阶梯', 'LADDER'), LED.x + 5, LED.y + 2.6, isEnglish() ? 4.2 : 5, CH.inkDim, { mono: true });
    tx(fuse > 5 ? (isEnglish() ? `DEEP×${view?.potMult ?? 2}` : `深水×${view?.potMult ?? 2}`) : L('深水', 'DEEP'), LED.x + 77, LED.y + 2.6, isEnglish() ? 4.2 : 5, fuse > 5 ? CH.orangeHi : CH.inkDim, { mono: true });
    tx(L('判定', 'RULING'), LED.x + 150, LED.y + 2.6, isEnglish() ? 4 : 5, judLed ? CH.orangeHi : CH.inkDim, { mono: true });
    const judOn = judLed ? ((time / 180) | 0) % 2 === 0 : false;
    lamp(LED.x + LED.w - 9, LED.y + 9, 3.2, judOn, CH.red, CH.redLo);
  }

  // 胶木键帽：顶面渐变＋下沿厚度＋按下位移。奶油色＝报，橙＝开，墨绿＝其余。
  const KEY_SKIN = {
    light: { top: '#fbf1d8', bot: '#d8c597', lip: '#a8946a', ink: '#1d2826' },
    red: { top: '#ff8b4f', bot: '#e0501d', lip: '#9a3410', ink: '#fff2e0' },
    dark: { top: '#2f5552', bot: '#1d3a38', lip: '#0e2120', ink: '#efe3c6' },
    sel: { top: '#ffb46a', bot: '#ff7a2e', lip: '#a8461a', ink: '#2a1205' },
  };

  function keycap(x, y, w, h, skin, pushed, enabled) {
    const lip = pushed ? 1 : 2.4;
    ctx.save();
    ctx.globalAlpha *= enabled ? 1 : 0.4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    rr(ctx, x + 0.4, y + 1.6, w, h, 3.4);
    ctx.fill();
    ctx.fillStyle = skin.lip;
    rr(ctx, x, y + (pushed ? 1 : 0), w, h, 3.4);
    ctx.fill();
    const top = ctx.createLinearGradient(0, y, 0, y + h - lip);
    top.addColorStop(0, skin.top);
    top.addColorStop(1, skin.bot);
    ctx.fillStyle = top;
    rr(ctx, x, y + (pushed ? 1 : 0), w, h - lip, 3.2);
    ctx.fill();
    ctx.globalAlpha *= 0.55;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 2.5, y + (pushed ? 1.4 : 0.4), w - 5, 0.6);
    ctx.restore();
    return y + (pushed ? 1 : 0) + (h - lip) / 2;
  }

  function bevel(button) {
    const pushed = press?.id === button.id && time - press.at < 160;
    if (button.face) {
      const selected = !!button.selected;
      const skin = selected ? KEY_SKIN.sel : button.enabled ? KEY_SKIN.light : KEY_SKIN.dark;
      if (selected) {
        ctx.save();
        glowOn(CH.orange, 7);
        ctx.fillStyle = 'rgba(255,122,46,0.35)';
        rr(ctx, button.x, button.y + 1, button.w, button.h, 3.4);
        ctx.fill();
        glowOff();
        ctx.restore();
      }
      const cy = keycap(button.x, button.y, button.w, button.h, skin, pushed || selected, button.enabled || selected);
      const cx = button.x + button.w / 2;
      ctx.save();
      ctx.globalAlpha *= button.enabled || selected ? 1 : 0.55;
      ctx.fillStyle = selected ? KEY_SKIN.sel.ink : button.enabled ? KEY_SKIN.light.ink : '#6f8c88';
      for (const pip of PIPS[button.face]) {
        ctx.beginPath();
        ctx.arc(cx + ((pip % 3) - 1) * 4.2, cy + (Math.floor(pip / 3) - 1) * 4.2, button.face === 1 ? 1.7 : 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    const denied = deny?.id === button.id && time - deny.at < 300 ? Math.sin((time - deny.at) / 18) * 2 : 0;
    const skin = KEY_SKIN[button.style] ?? KEY_SKIN.dark;
    const x = button.x + denied;
    const cy = keycap(x, button.y, button.w, button.h, skin, pushed, button.enabled);
    if (button.lamp != null) {
      ctx.save();
      ctx.globalAlpha *= button.enabled || button.lamp ? 1 : 0.5;
      lamp(x + button.w - 5, button.y + 4.6, 1.5, !!button.lamp, CH.mustard, '#2a2a1c');
      ctx.restore();
    }
    if (button.label) {
      const han = /[㐀-鿿]/.test(button.label);
      tx(button.label, x + button.w / 2, cy + 0.4, button.font, skin.ink, {
        font: han ? 'han' : 'display',
        bold: !han,
        align: 'center',
        baseline: 'middle',
        alpha: button.enabled ? 1 : 0.4,
      });
    }
  }

  function drawCountGauge(message = '', count = null) {
    const x = 47;
    const y = COUNT_KEY_Y;
    ctx.save();
    rr(ctx, x, y + 0.5, 101, 21, 4);
    ctx.fillStyle = '#081111';
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();
    ctx.restore();
    if (message) {
      tx(message, x + 50.5, y + 11, 6.5, CH.orangeHi, { mono: true, align: 'center', baseline: 'middle' });
      return;
    }
    tx(L('数量', 'COUNT'), x + 8, y + 11, 6, CH.inkDim, { mono: true, baseline: 'middle' });
    if (count != null) {
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < Math.min(10, count) ? PH.c.mid : '#1d2a28';
        ctx.fillRect(x + 34 + i * 4.2, y + 8, 2.6, 6);
      }
      tx(count, x + 93, y + 11.3, 10, PH.c.hot, { mono: true, bold: true, align: 'right', baseline: 'middle', glow: 2 });
    }
  }

  function drawControls() {
    const canAct = view?.myTurn && phase !== 'seq' && phase !== 'settle';
    const selected = view?.selectedBid;
    const bidAdjust = !!(canAct && selected && view?.legal.bid);

    for (let face = 1; face <= 6; face++) {
      addButton(`face:${face}`, 8 + (face - 1) * 30, FACE_KEY_Y, 27, 22, '', !!(bidAdjust && view?.legal.faces?.includes(face)), 'dark', 10, {
        face,
        selected: selected?.face === face,
      });
    }

    if (pokeMenu) {
      const labels = isEnglish() ? ['Wrong', 'Bluffing', 'Hold on'] : ['你记错了', '你在演', '慢着'];
      labels.forEach((label, i) => addButton(`poke:${label}`, 9 + i * 59, COUNT_KEY_Y, 55, 22, label, !!canAct, 'dark', 7));
    } else if (moreMenu && view?.modActions?.length) {
      const items = [
        ...view.modActions.slice(0, 3).map((mod) => ({ id: `mod:${mod.type}`, label: mod.label, enabled: !!canAct })),
        { id: 'poke', label: L('戳', 'POKE'), enabled: !!canAct },
      ];
      items.forEach((item, i) => addButton(item.id, 8 + i * 45, COUNT_KEY_Y, 42, 22, item.label, item.enabled, 'dark', 7));
    } else {
      const denyMessage = deny && time - deny.at < 900 ? deny.message : '';
      addButton('countDown', 8, COUNT_KEY_Y, 35, 22, '−', !!(bidAdjust && view?.legal.countDown), 'dark', 13);
      drawCountGauge(denyMessage, selected && canAct ? selected.count : null);
      addButton('countUp', 152, COUNT_KEY_Y, 35, 22, '+', !!(bidAdjust && view?.legal.countUp), 'dark', 13);
    }

    if (phase === 'seq') {
      ctx.save();
      ctx.strokeStyle = CH.inkDim;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 0.6;
      ctx.setLineDash([3, 3]);
      rr(ctx, 8.5, KEY_Y + 0.5, 178, 29, 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      tx(L('演出中 · 触摸加速', 'SEQUENCE · TAP TO SKIP'), W / 2, KEY_Y + 15, isEnglish() ? 6 : 7.5, CH.inkDim, { mono: true, align: 'center', baseline: 'middle' });
    } else {
      addButton('bid', 8, KEY_Y, 86, 30, L('报', 'BID'), !!(canAct && view?.legal.bid), 'light', isEnglish() ? 10 : 16);
      addButton('open', 100, KEY_Y, 87, 30, L('开', 'CALL'), !!(canAct && view?.legal.open), 'red', isEnglish() ? 10 : 16);
    }
    const hasMods = !!view?.modActions?.length;
    const declarations = [
      ['blind', L('盲', 'BLIND'), !!view?.legal.blind, !!view?.declarations?.blind],
      ['zhai', L('斋', 'NO-WILD'), !!view?.legal.zhai, !!view?.declarations?.zhai],
      ['raise', L('抬', 'RAISE'), !!view?.legal.raise, !!view?.declarations?.raise],
      [hasMods ? 'more' : 'poke', hasMods ? L('扩', 'MORE') : L('戳', 'POKE'), true, null],
    ];
    declarations.forEach(([id, label, enabled, lit], i) => addButton(id, 8 + i * 46, KEY_Y + 34, 42, 20, label, !!(canAct && enabled), 'dark', isEnglish() ? 5.6 : 10, { lamp: lit }));
    for (const button of buttons) if (button.id !== 'peek') bevel(button);
  }

  function stepShellEffects() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * fr;
      p.y += p.vy * fr;
      p.vy += 0.04 * fr;
      p.life -= 0.03 * fr;
      if (p.life <= 0) particles.splice(i, 1);
      else {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (let i = packs.length - 1; i >= 0; i--) {
      const p = packs[i];
      if (time < p.born) continue;
      const k = clamp((time - p.born) / p.dur, 0, 1);
      const trace = p.reverse ? [...CHIP_TRACES[p.from]].reverse() : CHIP_TRACES[p.from];
      const pal = p.from === 'up' ? PH.a : PH.c;
      const train = clamp(Math.ceil(Math.abs(p.amount ?? 1)), 1, 3);
      for (let j = train - 1; j >= 0; j--) {
        const [x, y] = tracePoint(trace, easeOut(Math.max(0, k - j * 0.045)));
        puck(x, y, pal, 1 - j * 0.2);
      }
      if (k >= 1) {
        if (!p.applied && p.amount) {
          p.applied = true;
          if (p.flow === 'out') {
            displayPot = Math.max(0, displayPot - p.amount);
            displayStacks[p.from] += p.amount;
            const key = p.from === 'up' ? 'a' : 'c';
            burstTube(key, 151, p.from === 'up' ? 27 : 12, 5, [pal.hot, pal.mid], 1.5);
          } else {
            displayStacks[p.from] -= p.amount;
            displayPot += p.amount;
            burstTube('b', TUBES.b.w - 17, p.from === 'up' ? 14 : 22, 6, [PH.b.hot, pal.mid], 1.5);
          }
          potPop = 1;
          handlers.sfx?.chips?.();
        }
        packs.splice(i, 1);
      }
    }
    if (float) {
      const k = (time - float.born) / 1100;
      if (k >= 1) float = null;
      else {
        const tube = TUBES[float.key];
        const pal = PH[float.key];
        const alpha = k < 0.15 ? k / 0.15 : 1 - easeOut(Math.max(0, (k - 0.45) / 0.55));
        tx(float.text, tube.x + tube.w / 2, tube.y + (float.key === 'c' ? 25 : 55) - easeOut(k) * 12, 16, pal.hot, { bold: true, mono: true, align: 'center', alpha, glow: 6 });
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const k = (time - r.born) / 350;
      if (k >= 1) ripples.splice(i, 1);
      else {
        const s = easeOut(k) * 9;
        ctx.globalAlpha = 0.4 * (1 - k);
        ctx.strokeStyle = CH.cream;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(r.x, r.y, s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // 搪瓷机壳只画一次：斜向渐变、细颗粒、控制台下沉面板与橙色饰线。
  let chassisCache = null;
  function chassis() {
    if (chassisCache) return chassisCache;
    const cv = document.createElement('canvas');
    cv.width = W * RS;
    cv.height = H * RS;
    const c = cv.getContext('2d');
    c.scale(RS, RS);
    const g = c.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, CH.enamelHi);
    g.addColorStop(0.42, CH.enamel);
    g.addColorStop(1, CH.enamelLo);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    rr(c, 2.5, 313.5, W - 5, H - 315, 7);
    const deck = c.createLinearGradient(0, 313, 0, H);
    deck.addColorStop(0, CH.deckLo);
    deck.addColorStop(0.12, CH.deck);
    deck.addColorStop(1, CH.deckLo);
    c.fillStyle = deck;
    c.fill();
    c.lineWidth = 0.6;
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(8, 314, W - 16, 0.8);
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 3200; i++) {
      c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.07)';
      c.fillRect(rnd() * W, rnd() * H, 0.4, 0.4);
    }
    // 饰线：橙／芥末／奶油三色细条，贴在控制台上沿
    [[CH.orange, 0], [CH.mustard, 1.4], [CH.cream, 2.8]].forEach(([color, dy]) => {
      c.fillStyle = color;
      c.globalAlpha = 0.85;
      c.fillRect(W - 58, 312.6 - dy, 50, 0.8);
    });
    c.globalAlpha = 1;
    chassisCache = cv;
    return cv;
  }

  function draw() {
    ctx = main2d;
    buttons.length = 0;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(chassis(), 0, 0, W, H);

    if (phase === 'boot') {
      for (const [key, index] of [['a', 0], ['b', 1], ['c', 2]]) drawTube(key, index, () => {});
      drawLedBar();
      const cx = W / 2;
      const cy = H / 2 - 14;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.28);
      ctx.strokeStyle = CH.orange;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(0, 0, 46, 13, 0, 0, Math.PI * 2);
      ctx.stroke();
      const t = time / 380;
      ctx.fillStyle = CH.mustard;
      glowOn(CH.mustard, 6);
      ctx.beginPath();
      ctx.arc(Math.cos(t) * 46, Math.sin(t) * 13, 2, 0, Math.PI * 2);
      ctx.fill();
      glowOff();
      ctx.restore();
      tx(L('开！', 'KAI!'), cx, cy + 1, 30, CH.cream, { font: 'han', align: 'center', baseline: 'middle', glow: 8 });
      tx(L('三 管 机 · 正 在 通 电', 'THREE-TUBE TABLE · POWER ON'), cx, H / 2 + 14, isEnglish() ? 5.5 : 6.5, CH.inkDim, { mono: true, align: 'center' });
      tx(L('触 摸 跳 过', 'TAP TO SKIP'), cx, H / 2 + 28, 5.5, CH.inkDim, { mono: true, align: 'center', alpha: 0.6 });
      return;
    }

    ctx.save();
    ctx.translate(reduced ? 0 : shakeX * (Math.random() - 0.5), reduced ? 0 : shakeY * (Math.random() - 0.5));
    drawTube('a', 0, drawUpper);
    drawTube('b', 1, drawCenter);
    drawTube('c', 2, drawLower);
    drawLedBar();
    stepShellEffects();
    drawControls();
    ctx.restore();
    if (flash > 0 && !reduced) {
      ctx.globalAlpha = flash;
      ctx.fillStyle = '#fff1dc';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform sampler2D tex;uniform float t,power,glitch,look,q;uniform vec2 res;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec2 vb=v;vb.y=(vb.y-.5)/max(power,.001)+.5;vec2 c=vb*2.-1.;float edge=1.-step(1.,max(abs(c.x),abs(c.y)));vec2 uv=clamp(vb,0.,1.);uv.x+=(hash(vec2(floor(uv.y*64.),floor(t*24.)))-.5)*glitch*.06;vec2 st=vec2(uv.x,1.-uv.y);vec2 tp=1./res;vec2 dir=st-.5;float ca=.0007+glitch*.005;vec3 col;col.r=texture2D(tex,st+dir*ca).r;col.g=texture2D(tex,st).g;col.b=texture2D(tex,st-dir*ca).b;if(q>1.5){vec3 bl=vec3(0.);bl+=texture2D(tex,st+vec2(2.5,0.)*tp).rgb;bl+=texture2D(tex,st+vec2(-2.5,0.)*tp).rgb;bl+=texture2D(tex,st+vec2(0.,2.5)*tp).rgb;bl+=texture2D(tex,st+vec2(0.,-2.5)*tp).rgb;bl+=texture2D(tex,st+vec2(4.,4.)*tp).rgb;bl+=texture2D(tex,st+vec2(-4.,4.)*tp).rgb;bl+=texture2D(tex,st+vec2(4.,-4.)*tp).rgb;bl+=texture2D(tex,st+vec2(-4.,-4.)*tp).rgb;bl*=.125;float s=max(bl.r,max(bl.g,bl.b))-min(bl.r,min(bl.g,bl.b));col+=max(bl-.42,0.)*(.12+1.1*s);}col*=.988+.012*sin(st.y*res.y*3.14159);float vg=1.-smoothstep(.6,1.5,length(c));col*=mix(.9,1.03,vg);col+=vec3(1.)*(1.-smoothstep(.0,.05,abs(uv.y-.5)))*(1.-power)*1.4;col+=(hash(st*res+mod(t*60.,971.))-.5)*.012;col*=edge;float gla=exp(-pow(v.x*.78+v.y*.45-.60-look*.10,2.)*70.);col+=vec3(.85,.92,1.)*gla*.03;gl_FragColor=vec4(col,1.);}`;
  let glPack = null;
  let glOk = false;
  let glValidated = false;
  let fallbackCanvas = null;

  function ensureFallback() {
    if (fallbackCanvas) return fallbackCanvas;
    fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = W * SS;
    fallbackCanvas.height = H * SS;
    fallbackCanvas.className = 'tube-fallback';
    fallbackCanvas.setAttribute('aria-hidden', 'true');
    canvas.insertAdjacentElement('afterend', fallbackCanvas);
    return fallbackCanvas;
  }

  function buildGl() {
    if (new URLSearchParams(location.search).has('2d')) return null;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return null;
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform2f(gl.getUniformLocation(prog, 'res'), W * RS, H * RS);
      gl.viewport(0, 0, canvas.width, canvas.height);
      return {
        gl,
        t: gl.getUniformLocation(prog, 't'),
        power: gl.getUniformLocation(prog, 'power'),
        glitch: gl.getUniformLocation(prog, 'glitch'),
        look: gl.getUniformLocation(prog, 'look'),
        q: gl.getUniformLocation(prog, 'q'),
      };
    } catch (error) {
      console.warn('[三管机] WebGL 降级：', error.message);
      return null;
    }
  }

  function present() {
    if (glOk && glPack) {
      const gl = glPack.gl;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
      gl.uniform1f(glPack.t, (time / 1000) % 120);
      gl.uniform1f(glPack.power, power);
      gl.uniform1f(glPack.glitch, reduced ? 0 : glitch);
      gl.uniform1f(glPack.look, reduced ? 0 : parX);
      gl.uniform1f(glPack.q, quality);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 某些移动 GPU 会“成功”编译却只交付黑帧。首个可操作帧抽检白色主键，
      // 黑帧就立即转 2D，不能让特效能力拖垮可玩性。
      if (!glValidated && phase === 'idle' && view?.myTurn) {
        const pixels = new Uint8Array(40 * 20 * 4);
        gl.readPixels(184, 162, 40, 20, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let peak = 0;
        for (let i = 0; i < pixels.length; i += 4) peak = Math.max(peak, pixels[i], pixels[i + 1], pixels[i + 2]);
        glValidated = true;
        if (peak < 96) {
          glOk = false;
          console.info('[三管机] WebGL 黑帧，自动转 2D');
          ensureFallback();
        }
      }
      return;
    }
    const target = ensureFallback();
    canvas.classList.add('hidden');
    target.classList.remove('hidden');
    const out = target.getContext('2d');
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, target.width, target.height);
    out.drawImage(off, 0, 0, target.width, target.height);
  }

  glPack = buildGl();
  glOk = !!glPack;
  if (!glOk) ensureFallback();
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    glOk = false;
    ensureFallback();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    glPack = buildGl();
    glOk = !!glPack;
    glValidated = false;
    if (glOk) {
      canvas.classList.remove('hidden');
      fallbackCanvas?.classList.add('hidden');
    }
  });

  function toGame(event) {
    const target = fallbackCanvas && !fallbackCanvas.classList.contains('hidden') ? fallbackCanvas : canvas;
    const box = target.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * W, ((event.clientY - box.top) / box.height) * H];
  }

  function denyButton(id, message = L('现在不能用', 'NOT AVAILABLE')) {
    deny = { id, message, at: time };
    handlers.sfx?.deny?.();
    navigator.vibrate?.(24);
  }

  function activateButton(id) {
    const button = buttons.findLast((b) => b.id === id);
    if (button && !button.enabled) return denyButton(id);
    press = { id, at: time };
    navigator.vibrate?.(12);
    if (id === 'menu') handlers.menu?.();
    else if (id === 'peek') handlers.peek?.();
    else if (id === 'countDown') handlers.count?.(-1);
    else if (id === 'countUp') handlers.count?.(1);
    else if (id.startsWith('face:')) handlers.face?.(Number(id.slice(5)));
    else if (id === 'bid') {
      pokeMenu = false;
      moreMenu = false;
      handlers.bid?.();
    } else if (id === 'open') {
      pokeMenu = false;
      moreMenu = false;
      handlers.open?.();
    } else if (id === 'blind' || id === 'zhai' || id === 'raise') {
      pokeMenu = false;
      moreMenu = false;
      handlers.declare?.(id);
    } else if (id === 'more') {
      moreMenu = !moreMenu;
      pokeMenu = false;
    } else if (id === 'poke') {
      pokeMenu = !pokeMenu;
      moreMenu = false;
    } else if (id.startsWith('poke:')) {
      pokeMenu = false;
      handlers.poke?.(id.slice(5));
    } else if (id.startsWith('mod:')) {
      moreMenu = false;
      handlers.mod?.(id.slice(4));
    }
  }

  const pointerDown = (event) => {
    if (!active) return;
    const [x, y] = toGame(event);
    if (phase === 'boot') return finishBoot();
    if (phase === 'seq') {
      timeScale = 3.2;
      return;
    }
    const target = fallbackCanvas && !fallbackCanvas.classList.contains('hidden') ? fallbackCanvas : canvas;
    const box = target.getBoundingClientRect();
    const minGameW = (44 / box.width) * W;
    const minGameH = (44 / box.height) * H;
    const hit = [...buttons].reverse().find((b) => {
      const slopX = Math.max(0, (minGameW - b.w) / 2);
      const slopY = Math.max(0, (minGameH - b.h) / 2);
      return x >= b.x - slopX && x <= b.x + b.w + slopX && y >= b.y - slopY && y <= b.y + b.h + slopY;
    });
    if (hit) activateButton(hit.id);
    else ripples.push({ x, y, born: time });
  };
  const pointerMove = (event) => {
    if (!active || reduced) return;
    const [x, y] = toGame(event);
    parX = (x / W - 0.5) * 2;
    parY = (y / H - 0.5) * 2;
  };
  const pointerUp = () => (press = null);
  viewport?.addEventListener('pointerdown', pointerDown);
  viewport?.addEventListener('pointermove', pointerMove);
  viewport?.addEventListener('pointerup', pointerUp);

  function loop(ts) {
    if (disposed) return;
    const dt = Math.min(50, ts - last);
    last = ts;
    if (active) {
      fr = (dt * timeScale) / 16.7;
      time += dt * timeScale;
      if (phase === 'boot') {
        const elapsed = ts - bootAt;
        power = clamp(elapsed / 650, 0, 1);
        warm.a = clamp((elapsed - 650) / 420, 0, 1);
        warm.b = clamp((elapsed - 810) / 420, 0, 1);
        warm.c = clamp((elapsed - 970) / 420, 0, 1);
        warm.ctl = clamp((elapsed - 1130) / 300, 0, 1);
        if (elapsed >= 1430) finishBoot();
      }
      flash *= 0.88 ** Math.max(fr, 0);
      glitch *= 0.97 ** Math.max(fr, 0);
      shakeX *= 0.9 ** Math.max(fr, 0);
      shakeY *= 0.9 ** Math.max(fr, 0);
      bidPop *= 0.88 ** Math.max(fr, 0);
      potPop *= 0.88 ** Math.max(fr, 0);
      if (dt > 22) lowFrames++;
      else lowFrames = Math.max(0, lowFrames - 1);
      if (lowFrames > 180 && quality > 1) {
        quality--;
        lowFrames = 0;
        console.info(`[三管机] 自动降档到 ${quality}`);
      }
      try {
        draw();
        present();
      } catch (error) {
        if (!renderError) console.error('[三管机] 表现层降级：', error);
        renderError = error;
        glOk = false;
        ctx = main2d;
        ctx.fillStyle = CH.chassis;
        ctx.fillRect(0, 0, W, H);
        tx(L('显示已降级', 'DISPLAY FALLBACK'), W / 2, H / 2 - 10, isEnglish() ? 9 : 11, CH.key, { bold: true, align: 'center' });
        tx(L('规则与操作仍可继续', 'RULES AND CONTROLS STILL WORK'), W / 2, H / 2 + 10, isEnglish() ? 5.2 : 7, '#7b838f', { mono: true, align: 'center' });
        announce(isEnglish() ? `Display fallback: ${error?.message ?? 'unknown error'}` : `显示已降级：${error?.message ?? '未知错误'}`);
        present();
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    setActive,
    setThinking,
    update,
    say,
    appendSpeech,
    clearSpeech,
    showShowdown,
    clearShowdown,
    isActive: () => active,
    destroy() {
      disposed = true;
      viewport?.removeEventListener('pointerdown', pointerDown);
      viewport?.removeEventListener('pointermove', pointerMove);
      viewport?.removeEventListener('pointerup', pointerUp);
      reducedMq.removeEventListener?.('change', onReduced);
      speechEl?.removeEventListener('scroll', onSpeechScroll);
      speechEl?.removeEventListener('pointerdown', stopSpeechPointer);
      fallbackCanvas?.remove();
    },
  };
}
