// 《开！》对局表现层 · 2026-10「数字雨」皮肤（黑客帝国式代码瀑布＋终端面板）。
// 规则事实只从 observe() 的快照进入；本模块不拥有、不推断、也不修改任何引擎状态。
// 模块名沿用「三管机」时代的 tubes.js：对外接口（toTubeView / createTubeStage）不变。

import { allLegalBids } from '../rules.js';
import { isEnglish } from './i18n.js';
import { createRain, createMosaic, GLYPHS } from './rain.js';

const L = (zh, en) => (isEnglish() ? en : zh);

const PIPS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};
export const SETTLEMENT_HOLD_MS = 3000;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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

export function createTubeStage(host, handlers = {}) {
  const $ = (id) => document.getElementById(id);
  const viewport = host.closest('.tube-viewport');
  const a11y = $('tubeA11y');
  const speechEl = $('tubeSpeech');
  const el = {
    tagline: $('mxTagline'),
    oppName: $('mxOppName'),
    oppState: $('mxOppState'),
    oppAcct: $('mxOppAcct'),
    oppDice: $('mxOppDice'),
    aiTag: $('mxAiTag'),
    bidLbl: $('mxBidLbl'),
    bid: $('mxBid'),
    bidX: $('mxBidX'),
    rel: $('mxRel'),
    hud: $('mxHud'),
    myName: $('mxMyName'),
    round: $('mxRound'),
    myAcct: $('mxMyAcct'),
    myDice: $('mxMyDice'),
    peek: $('tubePeekBtn'),
    count: $('mxCount'),
    more: $('mxMoreBtn'),
    extra: $('mxExtra'),
    bidBtn: $('tubeBidBtn'),
    openBtn: $('tubeOpenBtn'),
    blind: $('tubeBlindBtn'),
    zhai: $('tubeZhaiBtn'),
    raise: $('tubeRaiseBtn'),
    faces: [1, 2, 3, 4, 5, 6].map((f) => $(`tubeFace${f}Btn`)),
  };
  const rain = createRain(host);
  const mosaics = {
    count: createMosaic($('mxBidCount'), { cell: 7 }),
    face: createMosaic($('mxBidFace'), { cell: 7 }),
    word: createMosaic($('mxVerdictWord'), { cell: 6, under: 0.5 }),
  };
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => Object.values(mosaics).forEach((m) => m.layout()))
    : null;
  for (const id of ['mxBidCount', 'mxBidFace', 'mxVerdictWord']) ro?.observe($(id));

  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedMq.matches;
  const onReduced = (e) => (reduced = e.matches);
  reducedMq.addEventListener?.('change', onReduced);

  let active = false;
  let disposed = false;
  let view = null;
  let lastView = null;
  let phase = 'idle';
  let timeScale = 1;
  let thinking = false;
  let reveal = null;
  let verdict = null;
  let extraOpen = false;
  let speech = { full: '', shown: '', n: 0, acc: 0, doneAt: 0 };
  let followSpeech = true;
  const shown = { pot: 0, up: 0, down: 0 };
  const target = { pot: 0, up: 0, down: 0 };
  let last = performance.now();
  let raf = 0;

  // ---------- 静态文案（随语言） ----------
  function label() {
    el.tagline.textContent = L('KAI · 数字雨对局', 'KAI · DIGITAL RAIN');
    el.myName.textContent = L('> 你', '> YOU');
    el.aiTag.textContent = L('AI生成', 'AI TEXT');
    el.peek.textContent = L('[ 解码我的骰子 ]', '[ DECODE MY DICE ]');
    el.blind.innerHTML = `<i></i>${L('盲', 'BLIND')}`;
    el.zhai.innerHTML = `<i></i>${L('斋', 'NO-WILD')}`;
    el.raise.innerHTML = `<i></i>${L('抬', 'RAISE')}`;
    el.bidBtn.querySelector('b').textContent = L('报', 'BID');
    el.openBtn.querySelector('b').textContent = L('开', 'CALL');
    el.faces.forEach((b, i) => (b.innerHTML = pipHtml(i + 1)));
  }

  function pipHtml(face) {
    const on = PIPS[face] ?? [];
    return `<span class="mx-pip${face === 1 ? ' is-wild' : ''}">${Array.from({ length: 9 }, (_, i) => `<i${on.includes(i) ? '' : ' class="x"'}></i>`).join('')}</span>`;
  }
  const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

  function setActive(next) {
    active = !!next;
    viewport?.classList.toggle('hidden', !active);
    document.getElementById('app')?.classList.toggle('tube-mode', active);
    if (active) {
      label();
      rain.start();
      viewport.classList.remove('mx-boot');
      void viewport.offsetWidth;
      viewport.classList.add('mx-boot');
      rain.surge(3, 1200);
      Object.values(mosaics).forEach((m) => m.layout());
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(loop);
    } else {
      rain.stop();
      cancelAnimationFrame(raf);
    }
  }

  // ---------- 台词：真流式接点保持不变 ----------
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
    viewport?.classList.toggle('mx-thinking', thinking);
    if (thinking) {
      rain.surge(1.6, 700);
      announce(isEnglish() ? 'AI is thinking.' : '对手正在思考。');
    }
    paintOpp();
    paintBid();
  }

  function say(text, seat = 'B') {
    if (!text || seat !== 'B') return;
    speech = { full: text, shown: '', n: 0, acc: 0, doneAt: 0 };
    followSpeech = true;
    syncSpeech();
    announce(`${view?.opponentName ?? L('它', 'AI')}: ${text}`);
  }

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

  // ---------- 画面：对手区 ----------
  function paintOpp() {
    if (!view) return;
    const name = view.opponentName ?? L('它', 'AI');
    el.oppName.textContent = `> ${[...name].length > 22 ? `${[...name].slice(0, 22).join('')}…` : name}`;
    el.oppState.textContent = thinking ? L('在想', 'THINKING') : L('在看', 'WATCHING');
    el.oppState.classList.toggle('is-off', view.connected === false);
    const count = reveal ? reveal.upper.length : view.oppDiceCount ?? 0;
    syncDiceRow(el.oppDice, count, (i) => {
      if (reveal) return i < reveal.upperN ? { face: reveal.upper[i], hit: isHit(i) } : null;
      return i < (view.oppShown?.length ?? 0) ? { face: view.oppShown[i] } : null;
    });
  }

  function paintMine() {
    if (!view) return;
    const faces = reveal?.lower ?? view.myDice;
    const count = reveal?.lower.length ?? view.myDiceCount ?? 0;
    const offset = reveal ? reveal.upper.length : 0;
    syncDiceRow(el.myDice, count, (i) => (faces ? { face: faces[i], hit: reveal ? isHit(offset + i) : false } : null));
    el.peek.classList.toggle('hidden', !!faces || !view.legal.peek || !!reveal);
    el.round.textContent = isEnglish() ? `R${String(view.round).padStart(2, '0')}` : `第 ${view.round} 局`;
  }

  function isHit(index) {
    if (!reveal || reveal.countIndex <= index) return false;
    const all = [...reveal.upper, ...reveal.lower];
    const face = all[index];
    return face === reveal.rv.bid.face || (!reveal.rv.zhai && face === 1);
  }

  // 每颗骰子是一格：盖着＝滚动的代码字，揭开＝发光点阵；解码瞬间短暂闪白。
  function syncDiceRow(row, count, faceOf) {
    while (row.children.length > count) row.lastElementChild.remove();
    while (row.children.length < count) {
      const d = document.createElement('span');
      d.className = 'mx-die is-covered';
      d.innerHTML = '<em></em>';
      row.appendChild(d);
    }
    [...row.children].forEach((d, i) => {
      const info = faceOf(i);
      const key = info ? `f${info.face}` : 'c';
      if (d.dataset.key !== key) {
        const wasCovered = d.dataset.key === 'c' || !d.dataset.key;
        d.dataset.key = key;
        d.classList.toggle('is-covered', !info);
        d.innerHTML = info ? pipHtml(info.face) : '<em></em>';
        if (info && wasCovered) {
          d.classList.remove('is-decoding');
          void d.offsetWidth;
          d.classList.add('is-decoding');
        }
      }
      d.classList.toggle('is-hit', !!info?.hit);
    });
  }

  // ---------- 画面：报价＝码字 ----------
  function paintBid() {
    if (!view && !reveal) return;
    const bid = reveal?.rv.bid ?? view?.currentBid;
    const who = bid?.player === 'A' ? L('你', 'YOU') : [...(view?.opponentName ?? L('它', 'AI'))].slice(0, 14).join('');
    el.bidLbl.textContent = verdict
      ? L('· 判 定 ·', '· RULING ·')
      : reveal
        ? (reveal.rv.calza ? L('· 掐 · 点 清 ·', '· SPOT ON · COUNT ·') : L('· 开 · 点 清 ·', '· CALL · COUNT ·'))
        : thinking
          ? L('· 对手在想 ·', '· AI THINKING ·')
          : bid
            ? (isEnglish() ? `· ${who} BIDS ·` : `· ${who} 报 ·`)
            : L('· 待 报 ·', '· AWAITING BID ·');
    el.bid.classList.toggle('is-verdict', !!verdict);
    el.bid.classList.toggle('is-empty', !bid);
    if (verdict) {
      mosaics.word.set(verdict.word);
      el.rel.textContent = verdict.relation;
    } else if (reveal) {
      mosaics.count.set(String(reveal.countN));
      mosaics.face.set(String(bid.count));
      el.bidX.textContent = reveal.rv.calza ? '=?' : '/';
      el.rel.textContent = isEnglish() ? `bid: ${bid.count} × ${bid.face}` : `验：${bid.count} 个 ${bid.face}`;
    } else if (bid) {
      mosaics.count.set(String(bid.count));
      mosaics.face.set(String(bid.face));
      el.bidX.textContent = L('个', '×');
      el.rel.textContent = '';
    } else {
      mosaics.count.set('');
      mosaics.face.set('');
      el.bidX.textContent = '_';
      el.rel.textContent = '';
    }
    if (!verdict) mosaics.word.set('');
  }

  function paintHud() {
    if (!view) return;
    const fuse = view.fuse ?? 0;
    const cells = Array.from({ length: 10 }, (_, i) => `<i class="${i >= 5 ? 'deep' : ''}${i < fuse ? ' on' : ''}"></i>`).join('');
    const mult = view.potMult ?? 1;
    el.hud.innerHTML = `<span>${L('池', 'POT')}<b data-k="pot">${pad(shown.pot)}</b></span><span>×<b>${Number.isInteger(mult) ? mult : mult.toFixed(1)}</b></span><span class="mx-ladder" title="${L('阶梯／深水', 'LADDER / DEEP')}">${cells}</span>`;
    el.hud.classList.toggle('is-deep', fuse > 5);
  }

  const pad = (n) => {
    const v = Math.round(n);
    return `${v < 0 ? '-' : ''}${String(Math.abs(v)).padStart(3, '0')}`;
  };

  function paintAccts() {
    el.oppAcct.textContent = `${L('账', 'BAL')} ${pad(shown.up)}`;
    el.myAcct.textContent = `${L('账', 'BAL')} ${pad(shown.down)}`;
    // 显示值扣掉了托管在池里的那一注；欠账要按真实账本判，开局押进底注不算欠
    const stake = reveal ? 0 : view?.stakePerSeat ?? 0;
    el.oppAcct.classList.toggle('is-debt', shown.up + stake < 0);
    el.myAcct.classList.toggle('is-debt', shown.down + stake < 0);
    const potEl = el.hud.querySelector('[data-k="pot"]');
    if (potEl) potEl.textContent = pad(shown.pot);
  }

  // ---------- 画面：控制区 ----------
  function paintControls() {
    if (!view) return;
    const canAct = view.myTurn && phase !== 'seq' && phase !== 'settle';
    const sel = view.selectedBid;
    el.faces.forEach((b, i) => b.classList.toggle('is-sel', sel?.face === i + 1));
    el.count.innerHTML = sel
      ? `<small>${L('数量', 'COUNT')}</small><b>${String(sel.count).padStart(2, '0')}</b><small>${L('个', '×')} ${sel.face}</small>`
      : `<small>${L('数量', 'COUNT')}</small><b>--</b>`;
    el.bidBtn.querySelector('small').textContent = sel ? (isEnglish() ? `${sel.count} × ${sel.face}` : `${sel.count} 个 ${sel.face}`) : '';
    const cur = view.currentBid;
    el.openBtn.querySelector('small').textContent = cur ? (isEnglish() ? `vs ${cur.count} × ${cur.face}` : `验 ${cur.count} 个 ${cur.face}`) : '';
    el.blind.classList.toggle('is-on', !!view.declarations?.blind);
    el.zhai.classList.toggle('is-on', !!view.declarations?.zhai);
    el.raise.classList.toggle('is-on', !!view.declarations?.raise);
    const hasMods = !!view.modActions?.length;
    el.more.textContent = hasMods ? L('扩', 'MORE') : L('戳', 'POKE');
    el.more.disabled = !canAct;
    if (!canAct && extraOpen) toggleExtra(false);
    viewport?.classList.toggle('mx-seq', phase === 'seq' || phase === 'settle');
  }

  function toggleExtra(next = !extraOpen) {
    extraOpen = next;
    el.more.setAttribute('aria-expanded', String(extraOpen));
    el.extra.classList.toggle('hidden', !extraOpen);
    if (!extraOpen) return;
    const pokes = isEnglish() ? ['Wrong', 'Bluffing', 'Hold on'] : ['你记错了', '你在演', '慢着'];
    const mods = (view?.modActions ?? []).slice(0, 3);
    el.extra.innerHTML = [
      ...mods.map((m) => `<button class="mx-key mx-chip" type="button" data-mod="${m.type}">${m.label}</button>`),
      ...pokes.map((p) => `<button class="mx-key mx-chip" type="button" data-poke="${p}">「${p}」</button>`),
    ].join('');
  }
  el.more.addEventListener('click', () => toggleExtra());
  el.extra.addEventListener('click', (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    toggleExtra(false);
    if (b.dataset.mod) handlers.mod?.(b.dataset.mod);
    else if (b.dataset.poke) handlers.poke?.(b.dataset.poke);
  });

  function update(next) {
    if (!next) return;
    lastView = view;
    view = next;
    const effectivePot = (value) => value?.potEffective ?? (value?.pot ?? 0) * (value?.potMult ?? 1);
    const stackOf = (value, side) => (value?.chips?.[side === 'up' ? 'upper' : 'lower'] ?? 0) - (value?.stakePerSeat ?? 0);
    const newRound = lastView?.round !== next.round;
    target.pot = effectivePot(next);
    target.up = stackOf(next, 'up');
    target.down = stackOf(next, 'down');
    if (lastView == null || newRound) {
      Object.assign(shown, target);
      if (newRound) {
        verdict = null;
        reveal = null;
      }
    }
    const oldBid = lastView?.currentBid;
    const newBid = next.currentBid;
    const bidChanged = !!(newBid && (!oldBid || oldBid.count !== newBid.count || oldBid.face !== newBid.face || oldBid.player !== newBid.player));
    if (bidChanged) {
      rain.surge(1.8, 500);
      handlers.sfx?.tick?.();
    }
    if (!newRound && (next.stakePerSeat ?? 0) > (lastView?.stakePerSeat ?? 0)) el.hud.classList.add('is-pulse');
    paintOpp();
    paintMine();
    paintBid();
    paintHud();
    paintAccts();
    paintControls();
    setTimeout(() => el.hud.classList.remove('is-pulse'), 420);
    const label = newBid
      ? (isEnglish()
          ? `${newBid.player === 'A' ? 'You' : next.opponentName} bids ${newBid.count} × ${newBid.face}`
          : `${newBid.player === 'A' ? '你' : next.opponentName}报 ${newBid.count} 个 ${newBid.face}`)
      : (isEnglish() ? `Round ${next.round}` : `第 ${next.round} 局`);
    announce(label);
  }

  function scaledWait(ms) {
    if (reduced) ms = Math.min(150, ms * 0.35);
    return new Promise((resolve) => {
      let acc = 0;
      let prev = performance.now();
      const tick = () => {
        const n = performance.now();
        acc += (n - prev) * timeScale;
        prev = n;
        if (acc >= ms || disposed) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function glitch(ms = 420) {
    if (reduced || !viewport) return;
    viewport.classList.remove('mx-glitch');
    void viewport.offsetWidth;
    viewport.classList.add('mx-glitch');
    setTimeout(() => viewport.classList.remove('mx-glitch'), ms);
  }

  function floatText(text, side) {
    const acct = side === 'up' ? el.oppAcct : el.myAcct;
    const f = document.createElement('span');
    f.className = 'mx-float';
    f.textContent = text;
    acct.closest('.mx-ph').appendChild(f);
    setTimeout(() => f.remove(), 1600);
  }

  async function showShowdown({ rv, re, by, sayText = '', names = {} }) {
    if (!active) return false;
    phase = 'seq';
    timeScale = 1;
    toggleExtra(false);
    reveal = {
      rv,
      re,
      by,
      names,
      upper: rv.dice.B ?? [],
      lower: rv.dice.A ?? [],
      upperN: 0,
      countN: 0,
      countIndex: 0,
    };
    if (sayText) say(sayText, by);
    paintControls();
    paintBid();
    await scaledWait(200);
    glitch();
    rain.surge(2.4, 1400);
    handlers.sfx?.slam?.();
    for (let i = 0; i < reveal.upper.length; i++) {
      reveal.upperN = i + 1;
      paintOpp();
      handlers.sfx?.land?.();
      await scaledWait(170);
    }
    const all = [...reveal.upper, ...reveal.lower];
    const hit = (face) => face === rv.bid.face || (!rv.zhai && face === 1);
    for (let i = 0; i < all.length; i++) {
      reveal.countIndex = i + 1;
      if (hit(all[i])) {
        reveal.countN++;
        paintOpp();
        paintMine();
        paintBid();
        handlers.sfx?.tick?.();
        await scaledWait(160);
      }
    }
    paintOpp();
    paintMine();
    const success = rv.calza ? !!rv.exact : !!rv.stands;
    const actual = reveal.countN;
    const winnerTag = re.winner === 'A' ? L('你', 'you') : L('它', 'the AI');
    const loserTag = re.loser === 'A' ? L('你', 'you') : L('它', 'the AI');
    const title = rv.calza
      ? (rv.exact ? L('掐中', 'EXACT') : L('掐空', 'MISS'))
      : success ? L('成立', 'TRUE') : L('不成立', 'FALSE');
    verdict = {
      title,
      word: title,
      relation: `${actual} ${rv.calza ? (rv.exact ? '=' : '≠') : success ? '≥' : '<'} ${rv.bid.count} · ${isEnglish() ? `${loserTag} lose a die` : `${loserTag}掉一颗骰`}`,
    };
    announce(isEnglish()
      ? `${title}: actual ${actual}; ${rv.calza ? `calza ${rv.bid.count}` : `bid ${rv.bid.count}`}. ${loserTag} lose; ${winnerTag} take the ${Math.round(shown.pot)} pot.`
      : `${title}：实中 ${actual}，${rv.calza ? `掐 ${rv.bid.count}` : `报价 ${rv.bid.count}`}；${loserTag}输，托管池 ${Math.round(shown.pot)} 全部归${winnerTag}`);
    viewport?.classList.toggle('mx-win', re.winner === 'A');
    viewport?.classList.toggle('mx-lose', re.winner !== 'A');
    paintBid();
    glitch(600);
    rain.surge(2.6, 1000);
    handlers.sfx?.verdict?.();
    await scaledWait(520);
    const winnerSide = re.winner === 'A' ? 'down' : 'up';
    const startPot = Math.max(0, shown.pot);
    if (startPot) {
      target[winnerSide] = shown[winnerSide] + startPot;
      target.pot = 0;
      floatText(`+${Math.round(startPot)}`, winnerSide);
      handlers.sfx?.chips?.();
      await scaledWait(reduced ? 120 : 620);
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
    phase = 'idle';
    timeScale = 1;
    viewport?.classList.remove('mx-win', 'mx-lose');
    paintOpp();
    paintMine();
    paintBid();
    paintControls();
  }

  // ---------- 帧循环：打字机、码字、数字滚动 ----------
  function loop(now) {
    if (disposed || !active) return;
    const dt = Math.min(50, now - last);
    last = now;
    const fr = (dt * timeScale) / 16.7;
    if (speech.full && speech.n < speech.full.length) {
      speech.acc += fr;
      if (speech.acc > 2.2) {
        speech.acc = 0;
        speech.n++;
        speech.shown = speech.full.slice(0, speech.n);
        if (speech.n >= speech.full.length) speech.doneAt = now;
        syncSpeech();
        if (speech.n % 3 === 0) handlers.sfx?.type?.();
      }
    }
    let moved = false;
    for (const k of ['pot', 'up', 'down']) {
      const d = target[k] - shown[k];
      if (Math.abs(d) > 0.01) {
        shown[k] += d * Math.min(1, 0.12 * fr);
        if (Math.abs(target[k] - shown[k]) < 0.5) shown[k] = target[k];
        moved = true;
      }
    }
    if (moved) paintAccts();
    for (const m of Object.values(mosaics)) m.draw(dt);
    // 盖着的骰子：代码字滚动（降帧，免得抢戏）
    if (((now / 110) | 0) !== ((last - dt) / 110 | 0)) {
      for (const em of viewport.querySelectorAll('.mx-die.is-covered em')) em.textContent = glyph();
    }
    raf = requestAnimationFrame(loop);
  }

  const pointerDown = (event) => {
    if (!active) return;
    if (phase === 'seq' && !event.target.closest('button')) timeScale = 3.2;
  };
  viewport?.addEventListener('pointerdown', pointerDown);

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
      rain.stop();
      ro?.disconnect();
      cancelAnimationFrame(raf);
      viewport?.removeEventListener('pointerdown', pointerDown);
      reducedMq.removeEventListener?.('change', onReduced);
      speechEl?.removeEventListener('scroll', onSpeechScroll);
      speechEl?.removeEventListener('pointerdown', stopSpeechPointer);
    },
  };
}
