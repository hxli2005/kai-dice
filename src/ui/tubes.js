// Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · macrostructure: in-place workbench.
// 方向 O「三管机」的生产表现层。
// 规则事实只从 observe() 的快照进入；本模块不拥有、不推断、也不修改任何引擎状态。

import { allLegalBids } from '../rules.js';

const W = 195;
const H = 422;
const SS = 4;
const RS = 2; // 低分辨率几何不变；文字与线条用 2× 栅格，避免高 DPR 手机上糊成光团。
const GLY = '0123456789ABCDEF◢◣▲▌░▒▓ｱｶｻﾀﾅﾊﾏﾔ';
const PIPS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};
const PH = {
  a: { glass: '#020b06', fade: '2,11,6', lo: '#1b6a43', mid: '#49e79a', hot: '#d8ffe8' },
  b: { glass: '#07090c', fade: '7,9,12', lo: '#566473', mid: '#d8e9f2', hot: '#ffffff' },
  c: { glass: '#100a02', fade: '16,10,2', lo: '#8a5d1d', mid: '#ffc66b', hot: '#fff1d8' },
};
const CH = {
  chassis: '#101216',
  rail: '#1a1d24',
  amber: '#ffb84d',
  red: '#ff3b30',
  key: '#dfe4e0',
  keyRed: '#b3271e',
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
  opponentName = '它',
  selectedBid = null,
  busy = false,
  privateCalc = '',
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
  const aiCalcCount = (o.events ?? []).filter((e) => e.type === 'calc' && e.actor === 'B').length;
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
    privateCalc,
    aiCalcCount,
    seal: roundStart?.commits?.B ? roundStart.commits.B.slice(0, 8).toUpperCase() : '--------',
    legal: {
      bid: legalTypes.has('bid'),
      faces: legalFaces,
      countDown: !!(selectedBid && legalCounts.some((count) => count < selectedBid.count)),
      countUp: !!(selectedBid && legalCounts.some((count) => count > selectedBid.count)),
      open: legalTypes.has('challenge'),
      calc: legalTypes.has('calc'),
      peek: legalTypes.has('peek'),
      ...declares,
    },
    declarations: {
      blind: !!o.blind?.A,
      zhai: !!o.zhai,
      raise: !!o.raises?.A,
      calc: !!o.calced?.A,
    },
    modActions,
  };
}

export function createTubeStage(canvas, handlers = {}) {
  const viewport = canvas.closest('.tube-viewport');
  const a11y = document.getElementById('tubeA11y');
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

  function announce(text) {
    if (a11y && text) a11y.textContent = text;
  }

  function setThinking(next) {
    thinking = !!next;
    if (thinking) wave.chaos = Math.max(wave.chaos, 0.18);
  }

  function say(text, seat = 'B') {
    if (!text || seat !== 'B') return;
    speech = { full: text, shown: '', n: 0, acc: 0, doneAt: 0 };
    announce(`${view?.opponentName ?? '它'}：${text}`);
  }

  // 真流式管线的接点：上游逐 token 调用；现有非流式通道仍可调用 say()。
  function appendSpeech(token, seat = 'B') {
    if (!token || seat !== 'B') return;
    if (speech.n >= speech.full.length) speech.doneAt = 0;
    speech.full += token;
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
    const label = newBid ? `${newBid.player === 'A' ? '你' : next.opponentName}报 ${newBid.count} 个 ${newBid.face}` : `第 ${next.round} 局`;
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
    const winnerTag = re.winner === 'A' ? '你' : '它';
    const loserTag = re.loser === 'A' ? '你' : '它';
    verdict = {
      title: rv.calza ? (rv.exact ? '掐  中' : '掐  空') : success ? '成  立' : '不 成 立',
      relation: `${actual} ${rv.calza ? (rv.exact ? '=' : '≠') : success ? '≥' : '<'} ${rv.bid.count}`,
    };
    judLed = 1;
    judHitAt = time;
    announce(`${verdict.title}：实中 ${actual}，${rv.calza ? `掐 ${rv.bid.count}` : `报价 ${rv.bid.count}`}；${loserTag}输，托管池 ${Math.round(displayPot)} 全部归${winnerTag}`);
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
    await scaledWait(700);
    phase = 'settle';
    timeScale = 1;
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

  function tx(text, x, y, size, color, { bold = false, mono = false, align = 'left', alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `${bold ? '700 ' : size <= 8 ? '600 ' : ''}${size}px ${mono ? '"SFMono-Regular","PingFang SC",Menlo,ui-monospace,monospace' : 'system-ui,"PingFang SC",sans-serif'}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(String(text), Math.round(x), Math.round(y));
    ctx.restore();
  }

  function drawDie(x, y, size, face, pal, hit = false, covered = false) {
    ctx.save();
    ctx.globalAlpha = covered ? 0.5 : 1;
    ctx.fillStyle = pal.lo;
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
    ctx.strokeStyle = covered ? pal.lo : pal.mid;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, size - 1, size - 1);
    if (covered) {
      const g = GLY[(time / 150 + x) % GLY.length | 0];
      tx(g, x + size / 2, y + size * 0.28, size * 0.42, pal.mid, { mono: true, align: 'center' });
    } else {
      const u = size / 7.5;
      const pip = Math.max(2, Math.round(u * 1.35));
      ctx.fillStyle = pal.hot;
      for (const i of PIPS[face] ?? [])
        ctx.fillRect(Math.round(x + u * 1.6 + (i % 3) * u * 2.05), Math.round(y + u * 1.35 + ((i / 3) | 0) * u * 2.05), pip, pip);
      if (face === 1) {
        ctx.strokeStyle = pal.hot;
        ctx.strokeRect(Math.round(x) + 2.5, Math.round(y) + 2.5, size - 5, size - 5);
      }
    }
    if (hit) {
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = pal.hot;
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
    }
    ctx.restore();
  }

  function puck(x, y, pal, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = pal.lo;
    ctx.fillRect(Math.round(x - 4), Math.round(y - 1), 8, 3);
    ctx.strokeStyle = pal.hot;
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y - 1), 4, 1.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawChipDock(x, y, value, pal, pulse = 0) {
    const v = Math.round(value);
    const debt = v < 0;
    ctx.save();
    ctx.globalAlpha *= 0.72 + pulse * 0.28;
    ctx.strokeStyle = pal.lo;
    ctx.strokeRect(x + 0.5, y + 0.5, 46, 18);
    ctx.fillStyle = pal.lo;
    ctx.fillRect(x + 3, y + 14, 14, 2);
    puck(x + 7, y + 12, pal, debt ? 0.25 : 0.72);
    puck(x + 10, y + 9, pal, debt ? 0.18 : 0.86);
    puck(x + 7, y + 6, pal, debt ? 0.12 : 1);
    if (debt) {
      ctx.strokeStyle = pal.hot;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 16);
      ctx.lineTo(x + 17, y + 3);
      ctx.stroke();
    }
    tx(String(v), x + 43, y + 4, 10, pal.hot, { bold: true, mono: true, align: 'right' });
    if (pulse > 0) {
      ctx.globalAlpha *= pulse;
      ctx.strokeStyle = pal.hot;
      ctx.strokeRect(x - pulse * 2 + 0.5, y - pulse + 0.5, 46 + pulse * 4, 18 + pulse * 2);
    }
    ctx.restore();
  }

  function drawHopper(cx, y, value, pal, pulse = 0, compact = false) {
    const w = compact ? 25 : 43;
    const h = compact ? 15 : 23;
    ctx.save();
    ctx.translate(cx, y);
    const scale = 1 + pulse * 0.18;
    ctx.scale(scale, scale);
    ctx.strokeStyle = pal.mid;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2 + 4, h / 2);
    ctx.lineTo(w / 2 - 4, h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.stroke();
    ctx.fillStyle = pal.lo;
    ctx.fillRect(-w / 2 + 3, h / 2 - 3, w - 6, 2);
    const coins = compact ? 2 : 3;
    for (let i = 0; i < coins; i++) puck(-w / 2 + 8 + i * 7, -h / 2 + 4 + (i % 2) * 2, pal, 0.65 + i * 0.15);
    tx(Math.round(value), compact ? 8 : 6, compact ? -5 : -7, compact ? 8 : 13, pal.hot, { bold: true, mono: true, align: 'center' });
    ctx.restore();
  }

  function calcValue() {
    const hit = String(view?.privateCalc ?? '').match(/\d+(?:\.\d+)?/);
    return hit ? clamp(Number(hit[0]), 0, 100) : null;
  }

  function drawCalcInstrument(x, y, pal) {
    const value = calcValue();
    const activeCalc = value != null || !!view?.declarations?.calc;
    ctx.save();
    ctx.globalAlpha *= activeCalc ? 1 : 0.42;
    ctx.strokeStyle = pal.lo;
    ctx.strokeRect(x + 0.5, y + 0.5, 75, 16);
    // 私有视窗：两片快门只在本席管内张合，不再写“仅你可见”。
    const shutter = activeCalc ? 1.5 + Math.sin(time / 430) * 0.55 : 0.6;
    ctx.strokeStyle = activeCalc ? pal.hot : pal.lo;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 8);
    ctx.quadraticCurveTo(x + 10, y + 3, x + 15, y + 8);
    ctx.quadraticCurveTo(x + 10, y + 13, x + 5, y + 8);
    ctx.stroke();
    ctx.fillStyle = pal.hot;
    ctx.fillRect(Math.round(x + 9), Math.round(y + 8 - shutter / 2), 2, Math.max(1, Math.round(shutter)));
    // 五档算盘珠随读数错位，数值变化被表现为机械动作。
    ctx.strokeStyle = pal.lo;
    ctx.beginPath();
    ctx.moveTo(x + 20, y + 8.5);
    ctx.lineTo(x + 49, y + 8.5);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const bit = value == null ? 0 : (Math.round(value / 5) >> i) & 1;
      const travel = bit ? 4 : -4;
      const breathe = activeCalc ? Math.sin(time / 520 + i * 0.8) * 0.5 : 0;
      ctx.fillStyle = i % 2 ? pal.mid : pal.hot;
      ctx.fillRect(Math.round(x + 34 + travel + breathe + i * 1.4), y + 6, 3, 5);
    }
    if (value != null) tx(Math.round(value), x + 71, y + 3, 9, pal.hot, { bold: true, mono: true, align: 'right' });
    ctx.restore();
  }

  function drawRoundCounter(pal, tube) {
    const y = tube.h - 16;
    tx('局', 6, y - 1, 9, pal.mid, { bold: true });
    // 桌面机械计数器：三枚滚轮中末轮缓慢咬合，替代“计数器在桌”。
    ctx.strokeStyle = pal.lo;
    ctx.strokeRect(23.5, y - 1.5, 31, 12);
    const digits = String(view?.round ?? 1).padStart(3, '0').slice(-3);
    [...digits].forEach((digit, i) => {
      ctx.strokeRect(26.5 + i * 9, y + 0.5, 7, 8);
      tx(digit, 30 + i * 9, y + 1, 6.5, i === 2 ? pal.hot : pal.mid, { mono: true, align: 'center' });
    });
  }

  function drawBidReadout(sel, pal, tube, enabled) {
    const y = 68;
    ctx.save();
    ctx.globalAlpha = enabled ? 1 : 0.42;
    ctx.strokeStyle = pal.lo;
    ctx.beginPath();
    ctx.moveTo(tube.w / 2 - 29, y + 17.5);
    ctx.lineTo(tube.w / 2 + 29, y + 17.5);
    ctx.stroke();
    tx(sel.count, tube.w / 2 - 20, y, 16, pal.hot, { bold: true, mono: true, align: 'center' });
    tx('个', tube.w / 2 - 5, y + 7, 8, pal.mid, { bold: true, align: 'center' });
    drawDie(tube.w / 2 + 7, y, 18, sel.face, pal);
    ctx.restore();
  }

  function drawCalcTally(x, y, count, pal) {
    ctx.strokeStyle = pal.lo;
    ctx.beginPath();
    ctx.moveTo(x, y + 3.5);
    ctx.lineTo(x + 35, y + 3.5);
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < Math.min(5, count) ? pal.mid : pal.lo;
      const shift = i < count ? 3 : -2;
      ctx.fillRect(x + 5 + i * 6 + shift, y + 1, 2, 5);
    }
  }

  function tubeFrame(tube) {
    ctx.fillStyle = CH.rail;
    ctx.fillRect(tube.x - 4, tube.y - 4, tube.w + 8, tube.h + 8);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(tube.x - 4, tube.y - 4, tube.w + 8, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(tube.x - 2, tube.y - 2, tube.w + 4, tube.h + 4);
    ctx.fillStyle = '#000';
    pillow(ctx, tube.x - 1, tube.y - 1, tube.w + 2, tube.h + 2, 14, 3);
    ctx.fill();
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
    ctx.fillStyle = pal.glass;
    ctx.fillRect(tube.x - 3, tube.y - 3, tube.w + 6, tube.h + 6);
    ctx.save();
    pillow(ctx, tube.x + 4, tube.y + 4, tube.w - 8, tube.h - 8, 11, 2);
    ctx.clip();
    ctx.drawImage(tube.pc, tube.x, tube.y, tube.w, tube.h);
    if (level >= 0.7) {
      ctx.save();
      ctx.translate(tube.x, tube.y);
      drawContent(pal, { ...tube, x: 0, y: 0 });
      ctx.restore();
    }
    if (quality > 1) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#000';
      for (let y = tube.y + (index % 2); y < tube.y + tube.h; y += 2) ctx.fillRect(tube.x, y, tube.w, 1);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    const shade = ctx.createRadialGradient(tube.x + tube.w / 2, tube.y + tube.h / 2, 4, tube.x + tube.w / 2, tube.y + tube.h / 2, tube.w * 0.62);
    shade.addColorStop(0, 'rgba(255,255,255,.028)');
    shade.addColorStop(1, 'rgba(0,0,0,.08)');
    ctx.fillStyle = shade;
    ctx.fillRect(tube.x, tube.y, tube.w, tube.h);
    const edge = ctx.createLinearGradient(0, tube.y, 0, tube.y + tube.h);
    edge.addColorStop(0, 'rgba(255,255,255,.20)');
    edge.addColorStop(0.35, 'rgba(255,255,255,.035)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = edge;
    pillow(ctx, tube.x + 1.5, tube.y + 1.5, tube.w - 3, tube.h - 3, 12, 2.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawWave(pal) {
    const y0 = 40;
    wave.ph += (0.09 + wave.chaos * 0.3 + (thinking ? 0.12 : 0)) * fr;
    wave.voice *= 0.86 ** fr;
    wave.chaos *= 0.985 ** fr;
    const amp = (5 + wave.voice * 7 + wave.chaos * 12 + (thinking ? 3 : 0)) * (1 - wave.flat);
    ctx.strokeStyle = pal.hot;
    ctx.beginPath();
    for (let x = 10; x <= 177; x += 2) {
      const k = (x - 10) / 167;
      const y = Math.sin(k * 9 + wave.ph) * Math.sin(k * 23 - wave.ph * 1.7) * amp;
      if (x === 10) ctx.moveTo(x, y0 + y);
      else ctx.lineTo(x, y0 + y);
    }
    ctx.stroke();
    ctx.fillStyle = pal.hot;
    ctx.fillRect(176, y0 - 1, 2, 2);
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
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function wrapTerminal(text, maxWidth = 137, size = 8) {
    ctx.save();
    ctx.font = `600 ${size}px "SFMono-Regular","PingFang SC",Menlo,ui-monospace,monospace`;
    const lines = [''];
    for (const ch of [...text]) {
      if (ch === '\n') {
        lines.push('');
        continue;
      }
      const i = lines.length - 1;
      const next = lines[i] + ch;
      if (lines[i] && ctx.measureText(next).width > maxWidth) lines.push(ch);
      else lines[i] = next;
    }
    ctx.restore();
    return lines;
  }

  function terminalPage() {
    const all = wrapTerminal(speech.shown);
    if (speech.n < speech.full.length) {
      return { lines: all.slice(-2), start: Math.max(0, all.length - 2), typing: true };
    }
    const pages = Math.max(1, Math.ceil(all.length / 2));
    const page = pages > 1 ? Math.floor(Math.max(0, time - speech.doneAt - 800) / 2400) % pages : 0;
    return { lines: all.slice(page * 2, page * 2 + 2), start: page * 2, typing: false };
  }

  function drawUpper(pal, tube) {
    const opponentLabel = [...(view?.opponentName ?? '它')].length > 12
      ? `${[...(view?.opponentName ?? '它')].slice(0, 12).join('')}…`
      : view?.opponentName ?? '它';
    tx(opponentLabel, 6, 5, 10, pal.mid, { bold: true });
    drawCalcTally(6, 19, view?.aiCalcCount ?? 0, pal);
    drawChipDock(tube.w - 52, 18, displayStacks.up, pal, potPop);
    ctx.fillStyle = view?.connected === false ? pal.lo : pal.hot;
    ctx.fillRect(tube.w - 30, 8, 3, 3);
    tx(thinking ? '在动' : '在看', tube.w - 24, 6, 8, thinking ? pal.hot : pal.mid, { mono: true });
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
        wave.voice = 1;
        if (speech.n % 3 === 0) handlers.sfx?.type?.();
      }
    }
    ctx.strokeStyle = pal.lo;
    ctx.strokeRect(5.5, 86.5, 29, 11);
    tx('AI生成', 8, 89, 7, pal.mid, { mono: true });
    const page = terminalPage();
    page.lines.forEach((line, i) => tx(`${page.start + i === 0 ? '> ' : '  '}${line}${page.typing && i === page.lines.length - 1 && ((time / 450) | 0) % 2 ? '▌' : ''}`,
      38, 85 + i * 9, 8, pal.hot, { mono: true }));
    stepTubeParticles('a');
  }

  function drawCenter(pal, tube) {
    const bid = reveal?.rv.bid ?? view?.currentBid;
    const bidder = bid?.player === 'A' ? '你' : [...(view?.opponentName ?? '它')].slice(0, 10).join('');
    tx(verdict ? '· 判 定 ·' : reveal ? '· 点 清 ·' : bid ? `· ${bidder} 报 ·` : '· 待 报 ·',
      tube.w / 2, 6, 8, pal.lo, { mono: true, align: 'center' });
    if (bid && !reveal) {
      const scale = 1 + bidPop * 0.18;
      ctx.save();
      ctx.translate(tube.w / 2, 29);
      ctx.scale(scale, scale);
      tx(bid.count, -24, -14, 30, pal.hot, { bold: true, align: 'center' });
      tx('个', 0, -1, 11, pal.mid, { bold: true, align: 'center' });
      tx(bid.face, 24, -14, 30, pal.hot, { bold: true, align: 'center' });
      ctx.restore();
    }
    if (verdict) {
      const blink = 0.86 + 0.14 * Math.sin(time / 120);
      tx(verdict.relation, tube.w / 2, 24, 14, pal.hot, { bold: true, mono: true, align: 'center' });
      ctx.globalAlpha = blink;
      ctx.fillStyle = pal.hot;
      ctx.fillRect(10, 44, tube.w - 20, 14);
      ctx.globalAlpha = 1;
      tx(verdict.title, tube.w / 2, 46, 10.5, pal.glass, { bold: true, align: 'center' });
    }
    drawHopper(tube.w - 16, 14, displayPot, pal, potPop, true);
    stepTubeParticles('b');
  }

  function addButton(id, x, y, w, h, label, enabled = true, style = 'dark', font = 10, extra = {}) {
    buttons.push({ id, x, y, w, h, label, enabled, style, font, ...extra });
  }

  function drawLower(pal, tube) {
    drawCalcInstrument(6, 5, pal);
    drawChipDock(tube.w - 52, 5, displayStacks.down, pal, potPop);

    const faces = reveal?.lower ?? view?.myDice;
    const count = reveal?.lower.length ?? view?.myDiceCount ?? 0;
    for (let i = 0; i < count; i++) {
      const face = faces?.[i] ?? 1;
      const hit = !!(reveal && reveal.countIndex > reveal.upper.length + i && (face === reveal.rv.bid.face || (!reveal.rv.zhai && face === 1)));
      drawDie(10 + i * 36, 28, 30, face, pal, hit, !faces);
    }
    if (!faces && view?.legal.peek) {
      tx('触摸骰仓看骰', tube.w / 2, 61, 7, pal.mid, { mono: true, align: 'center' });
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

  function drawLedBar() {
    const ledX = (i) => (i < 5 ? LED.x + 4 + i * 13 : LED.x + 76 + (i - 5) * 13);
    ctx.fillStyle = CH.rail;
    ctx.fillRect(LED.x - 2, LED.y - 2, LED.w + 4, LED.h + 4);
    ctx.fillStyle = '#080a0e';
    ctx.fillRect(LED.x, LED.y, LED.w, LED.h);
    ctx.strokeStyle = '#343a44';
    ctx.strokeRect(LED.x + 0.5, LED.y + 0.5, LED.w - 1, LED.h - 1);
    ctx.fillStyle = '#20252d';
    ctx.fillRect(LED.x + 70, LED.y + 1, 1, LED.h - 2);
    ctx.fillRect(LED.x + 143, LED.y + 1, 1, LED.h - 2);
    const fuse = view?.fuse ?? 0;
    const stepPulse = phase === 'boot' ? 0 : Math.max(0, 1 - (time - ledHitAt) / 520);
    for (let i = 0; i < 10; i++) {
      const x = ledX(i);
      const deep = i >= 5;
      const on = phase === 'boot' ? ((time / 70) | 0) % 10 === i : i < fuse;
      ctx.fillStyle = on ? (deep ? CH.red : CH.amber) : deep ? '#2a0e0c' : '#241a08';
      ctx.fillRect(Math.round(x), LED.y + 9, 10, 4);
      if (i === fuse - 1 && stepPulse > 0) {
        ctx.globalAlpha = stepPulse;
        ctx.strokeStyle = deep ? CH.red : CH.amber;
        const ex = (1 - stepPulse) * 3;
        ctx.strokeRect(Math.round(x - ex), LED.y + 9 - ex * 0.35, 10 + ex * 2, 4 + ex * 0.7);
        ctx.globalAlpha = 1;
      }
      if (on) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(x), LED.y + 9, 10, 1);
        ctx.globalAlpha = 1;
      }
    }
    if (phase !== 'boot' && fuse > 0 && time - lastSpark > 440) {
      lastSpark = time;
      const x = ledX(Math.min(9, fuse - 1)) + 5;
      shellBurst(x, LED.y + 9, fuse > 5 ? 2 : 1, fuse > 5 ? CH.red : CH.amber);
    }
    tx('阶梯', LED.x + 4, LED.y + 2, 5.5, '#858e9b', { mono: true });
    tx(fuse > 5 ? `深水×${view?.potMult ?? 2}` : '深水', LED.x + 76, LED.y + 2, 5.5, fuse > 5 ? '#e87855' : '#8a665f', { mono: true });
    tx('判定', LED.x + 149, LED.y + 2, 5.5, judLed ? '#e87855' : '#858e9b', { mono: true });
    const judPulse = judLed ? Math.max(0.35, Math.max(0, 1 - (time - judHitAt) / 600)) : 0;
    if (judPulse) {
      ctx.globalAlpha = 0.24 * judPulse;
      ctx.fillStyle = CH.red;
      ctx.fillRect(LED.x + LED.w - 17, LED.y + 7, 14, 8);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = judLed ? (((time / 180) | 0) % 2 ? CH.red : '#7a1d16') : '#241012';
    ctx.fillRect(LED.x + LED.w - 14, LED.y + 9, 8, 5);
  }

  function bevel(button) {
    if (button.face) {
      const pushed = press?.id === button.id && time - press.at < 160 ? 1 : 0;
      const selected = !!button.selected;
      const x = Math.round(button.x);
      const y = Math.round(button.y + (selected ? 2 : pushed));
      if (!button.enabled && !selected) {
        ctx.fillStyle = '#080a0e';
        ctx.fillRect(x, y + 1, button.w, button.h - 1);
        ctx.strokeStyle = '#242a33';
        ctx.strokeRect(x + 0.5, y + 1.5, button.w - 1, button.h - 2);
      } else {
        if (!selected) {
          ctx.fillStyle = '#050608';
          ctx.fillRect(x + 1, y + 2, button.w, button.h);
        }
        ctx.fillStyle = selected ? '#1b160d' : '#1a1e25';
        ctx.fillRect(x, y, button.w, button.h - 1);
        ctx.strokeStyle = selected ? '#a9762e' : '#3c444f';
        ctx.strokeRect(x + 0.5, y + 0.5, button.w - 1, button.h - 2);
        ctx.globalAlpha = selected ? 0.28 : 0.45;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + 1, y + 1, button.w - 2, 1);
        ctx.globalAlpha = 1;
      }
      const px = x + 8;
      const py = y + 4;
      ctx.fillStyle = button.enabled ? (selected ? PH.c.hot : PH.c.mid) : selected ? '#9d7337' : '#3e4650';
      for (const pip of PIPS[button.face]) {
        ctx.fillRect(px + (pip % 3) * 4, py + Math.floor(pip / 3) * 4, 2, 2);
      }
      return;
    }
    const pushed = press?.id === button.id && time - press.at < 160 ? 1 : 0;
    const denied = deny?.id === button.id && time - deny.at < 300 ? Math.round(Math.sin((time - deny.at) / 18) * 2) : 0;
    const x = button.x + denied;
    const y = button.y + pushed;
    const fill = button.style === 'light' ? CH.key : button.style === 'red' ? CH.keyRed : '#14171d';
    const color = button.enabled ? (button.style === 'light' ? '#10141c' : button.style === 'red' ? '#ffe9e4' : '#c9cdd6') : '#454d5a';
    ctx.globalAlpha = button.enabled ? 1 : 0.38;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(x) + 1, Math.round(y) + 2, button.w, button.h);
    ctx.fillStyle = fill;
    ctx.fillRect(Math.round(x), Math.round(y), button.w, button.h - 1 + pushed);
    ctx.globalAlpha *= 0.38;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(x), Math.round(y), button.w, 1);
    ctx.globalAlpha = button.enabled ? 1 : 0.38;
    if (button.label) tx(button.label, x + button.w / 2, y + (button.h - button.font) / 2 - 1, button.font, color, { bold: true, align: 'center' });
    ctx.globalAlpha = 1;
  }

  function drawCountGauge(message = '') {
    const x = 47;
    const y = COUNT_KEY_Y;
    ctx.fillStyle = '#080a0e';
    ctx.fillRect(x, y, 101, 22);
    ctx.strokeStyle = '#343a44';
    ctx.strokeRect(x + 0.5, y + 0.5, 100, 21);
    if (message) {
      tx(message, x + 50.5, y + 7, 6.5, '#89919d', { mono: true, align: 'center' });
      return;
    }
    tx('数量', x + 50.5, y + 8, 7, '#747d89', { mono: true, align: 'center' });
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
      const labels = ['你记错了', '你在演', '慢着'];
      labels.forEach((label, i) => addButton(`poke:${label}`, 9 + i * 59, COUNT_KEY_Y, 55, 22, label, !!canAct, 'dark', 6.5));
    } else if (moreMenu && view?.modActions?.length) {
      const items = [
        ...view.modActions.slice(0, 3).map((mod) => ({ id: `mod:${mod.type}`, label: mod.label, enabled: !!canAct })),
        { id: 'poke', label: '戳', enabled: !!canAct },
      ];
      items.forEach((item, i) => addButton(item.id, 8 + i * 45, COUNT_KEY_Y, 42, 22, item.label, item.enabled, 'dark', 6.5));
    } else {
      const denyMessage = deny && time - deny.at < 900 ? deny.message : '';
      addButton('countDown', 8, COUNT_KEY_Y, 35, 22, '−', !!(bidAdjust && view?.legal.countDown), 'dark', 14);
      drawCountGauge(denyMessage);
      addButton('countUp', 152, COUNT_KEY_Y, 35, 22, '＋', !!(bidAdjust && view?.legal.countUp), 'dark', 14);
    }

    if (phase === 'seq') {
      ctx.strokeStyle = '#454d5a';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(8.5, KEY_Y + 0.5, 178, 29);
      ctx.setLineDash([]);
      tx('演出中 · 触摸加速', W / 2, KEY_Y + 13, 8, '#606873', { mono: true, align: 'center' });
    } else {
      addButton('bid', 8, KEY_Y, 86, 30, '报', !!(canAct && view?.legal.bid), 'light', 15);
      addButton('open', 100, KEY_Y, 87, 30, '开', !!(canAct && view?.legal.open), 'red', 15);
    }
    const hasMods = !!view?.modActions?.length;
    const declarations = [
      ['blind', '盲', !!view?.legal.blind],
      ['zhai', '斋', !!view?.legal.zhai],
      ['raise', '抬', !!view?.legal.raise],
      ['calc', '算', !!view?.legal.calc],
      [hasMods ? 'more' : 'poke', hasMods ? '扩' : '戳', true],
    ];
    declarations.forEach(([id, label, enabled], i) => addButton(id, 8 + i * 37, KEY_Y + 34, 33, 20, label, !!(canAct && enabled), 'dark', 10));
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
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
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
            burstTube('b', TUBES.b.w - 16, p.from === 'up' ? 10 : 20, 6, [PH.b.hot, pal.mid], 1.5);
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
        tx(float.text, tube.x + tube.w / 2, tube.y + (float.key === 'c' ? 25 : 55) - easeOut(k) * 12, 16, pal.hot, { bold: true, align: 'center', alpha });
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const k = (time - r.born) / 350;
      if (k >= 1) ripples.splice(i, 1);
      else {
        const s = easeOut(k) * 8;
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.strokeStyle = PH.b.mid;
        ctx.strokeRect(Math.round(r.x - s), Math.round(r.y - s), Math.round(s * 2), Math.round(s * 2));
        ctx.globalAlpha = 1;
      }
    }
  }

  function draw() {
    ctx = main2d;
    buttons.length = 0;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = CH.chassis;
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 3) {
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = ((x / 3) | 0) % 2 ? '#fff' : '#000';
      ctx.fillRect(x, 0, 1, H);
    }
    ctx.globalAlpha = 1;

    if (phase === 'boot') {
      for (const [key, index] of [['a', 0], ['b', 1], ['c', 2]]) drawTube(key, index, () => {});
      drawLedBar();
      tx('开！', W / 2, H / 2 - 26, 28, '#fff', { bold: true, align: 'center' });
      tx('三 管 机 · 正 在 通 电', W / 2, H / 2 + 8, 7, '#8c949f', { mono: true, align: 'center' });
      tx('触 摸 跳 过', W / 2, H / 2 + 24, 6, '#535a65', { mono: true, align: 'center' });
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
      ctx.fillStyle = '#fff';
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
void main(){vec2 vb=(v-.5)*1.045+.5;vb.y=(vb.y-.5)/max(power,.001)+.5;vec2 c=vb*2.-1.;c*=1.+.030*dot(c,c);vec2 uv=c*.5+.5;vec2 db=max(max(-uv,uv-1.),vec2(0.));float edge=1.-smoothstep(.0,.010,max(db.x,db.y));uv=clamp(uv,0.,1.);uv.x+=(hash(vec2(floor(uv.y*48.),floor(t*24.)))-.5)*glitch*.09;vec2 st=vec2(uv.x,1.-uv.y);vec2 tp=1./res;vec2 sn=(floor(st*res)+.5)*tp;vec2 dir=st-.5;float ca=.0016+glitch*.005;vec3 col;col.r=texture2D(tex,sn+dir*ca).r;col.g=texture2D(tex,sn).g;col.b=texture2D(tex,sn-dir*ca).b;if(q>1.5){vec3 bl=vec3(0.);bl+=texture2D(tex,st+vec2(1.6,0.)*tp).rgb;bl+=texture2D(tex,st+vec2(-1.6,0.)*tp).rgb;bl+=texture2D(tex,st+vec2(0.,1.6)*tp).rgb;bl+=texture2D(tex,st+vec2(0.,-1.6)*tp).rgb;bl*=.25;col+=max(bl-.45,0.)*.70;}col*=.965+.035*sin(st.y*res.y*3.14159);col*=.99+.01*sin(gl_FragCoord.x*2.094);col*=1.+.015*sin(uv.y*7.-t*1.3);float vg=1.-smoothstep(.42,1.35,length(c));col*=mix(.80,1.10,vg);col+=vec3(1.)*(1.-smoothstep(.0,.05,abs(uv.y-.5)))*(1.-power)*1.4;col+=(hash(st*res+mod(t*60.,971.))-.5)*.014;vec3 bez=vec3(.050,.053,.061)*(1.08-.38*v.y)+col*.10;col=mix(bez,col,edge);float gla=exp(-pow(v.x*.78+v.y*.45-.60-look*.10,2.)*70.);col+=vec3(.85,.92,1.)*gla*.035;gl_FragColor=vec4(col,1.);}`;
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

  function denyButton(id, message = '现在不能用') {
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
    } else if (id === 'calc') {
      pokeMenu = false;
      moreMenu = false;
      handlers.calc?.();
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
        tx('显示已降级', W / 2, H / 2 - 10, 11, CH.key, { bold: true, align: 'center' });
        tx('规则与操作仍可继续', W / 2, H / 2 + 10, 7, '#7b838f', { mono: true, align: 'center' });
        announce(`显示已降级：${error?.message ?? '未知错误'}`);
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
    showShowdown,
    clearShowdown,
    isActive: () => active,
    destroy() {
      disposed = true;
      viewport?.removeEventListener('pointerdown', pointerDown);
      viewport?.removeEventListener('pointermove', pointerMove);
      viewport?.removeEventListener('pointerup', pointerUp);
      reducedMq.removeEventListener?.('change', onReduced);
      fallbackCanvas?.remove();
    },
  };
}
