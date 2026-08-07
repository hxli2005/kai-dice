// 规则引擎（DESIGN §2、§4）。
// 架构宪法：引擎只暴露玩家接口 observe()/act()，对面是人是 AI 不知也不问。
// 对方骰面不存在于 observe 返回的 schema 中——公平由 schema 强制。

import { isLegalBid, bidStands, countBid, allLegalBids } from './rules.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function commitmentOf(dice, nonce) {
  return sha256Hex(`${dice.join(',')}|${nonce}`);
}

export const PLAYERS = ['A', 'B'];
const opp = (p) => (p === 'A' ? 'B' : 'A');

export const DEFAULTS = {
  startDice: 5, // 附:待定参数表
  startChips: 100, // §2.2 初始筹码；可为负，不触发终局
};

// 承诺哈希（§4.1）异步生成，故工厂为 async；act() 同为 async。
export async function createMatch({ seed, config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const rng = mulberry32(seed ?? 1);
  const rollDice = (n) => Array.from({ length: n }, () => 1 + Math.floor(rng() * 6));
  const nonceGen = () =>
    Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join('');

  // 私有状态（闭包内，永不整体外泄）
  const diceCount = { A: cfg.startDice, B: cfg.startDice };
  // startChips 可为 {A,B}（跨场账本续上回）或数字（双方同额）
  const chips =
    typeof cfg.startChips === 'object'
      ? { A: cfg.startChips.A, B: cfg.startChips.B }
      : { A: cfg.startChips, B: cfg.startChips };
  const events = []; // 公开事件流，双方同构可见
  let round = 0;
  let over = false;
  let dice = null; // {A: [...], B: [...]}
  let nonces = null;
  let turn = null;
  let firstBidder = null;
  let bids = []; // [{player, count, face}]
  let peeked = null; // {A: bool, B: bool}
  let blind = null;
  let zhai = false;

  const emit = (e) => events.push({ i: events.length, ...e });

  async function startRound(first) {
    round += 1;
    dice = { A: rollDice(diceCount.A), B: rollDice(diceCount.B) };
    nonces = { A: nonceGen(), B: nonceGen() };
    turn = first;
    firstBidder = first;
    bids = [];
    peeked = { A: false, B: false };
    blind = { A: false, B: false };
    zhai = false;
    emit({
      type: 'roundStart',
      round,
      first,
      diceCount: { ...diceCount },
      commits: {
        A: await commitmentOf(dice.A, nonces.A),
        B: await commitmentOf(dice.B, nonces.B),
      },
    });
  }

  function totalDice() {
    return diceCount.A + diceCount.B;
  }

  function currentBid() {
    return bids.length ? bids[bids.length - 1] : null;
  }

  function legalActions(p) {
    if (over) return [];
    const acts = [];
    if (!peeked[p] && !blind[p]) acts.push({ type: 'peek' });
    if (p !== turn) return acts;
    const myBids = bids.some((b) => b.player === p);
    // §2.3 宣言窗口：盲=未看骰且未报过数；斋=仅首报者首报前；可叠加
    if (!peeked[p] && !blind[p] && !myBids) acts.push({ type: 'declare', declaration: 'blind' });
    if (p === firstBidder && bids.length === 0 && !zhai)
      acts.push({ type: 'declare', declaration: 'zhai' });
    if (allLegalBids(currentBid(), zhai, totalDice()).length > 0) acts.push({ type: 'bid' });
    if (bids.length > 0) acts.push({ type: 'challenge' });
    return acts;
  }

  async function settle(challenger) {
    const bid = currentBid();
    const all = [...dice.A, ...dice.B];
    const stands = bidStands(bid, all, zhai);
    const loser = stands ? challenger : bid.player;
    const winner = opp(loser);
    emit({
      type: 'reveal',
      dice: { A: [...dice.A], B: [...dice.B] },
      nonces: { ...nonces },
      bid: { ...bid },
      actual: countBid(bid, all, zhai),
      zhai,
      stands,
      loser,
    });
    // 注池（§2.2）：单方投入 = 1 底注 + 每次报数追 1；净转移 = 单方投入 × 赔率
    const units = 1 + bids.length;
    // §2.2 赔率：盲 ×2（双盲 ×4）与斋 ×1.5 乘法叠加，转移额四舍五入
    const mult = 2 ** (blind.A ? 1 : 0) * 2 ** (blind.B ? 1 : 0) * (zhai ? 1.5 : 1);
    const transfer = Math.round(units * mult);
    chips[loser] -= transfer;
    chips[winner] += transfer;
    diceCount[loser] -= 1;
    emit({
      type: 'roundEnd',
      round,
      loser,
      transfer,
      mult,
      chips: { ...chips },
      diceCount: { ...diceCount },
    });
    if (diceCount[loser] === 0) {
      over = true;
      emit({ type: 'matchEnd', winner, rounds: round, chips: { ...chips } });
    } else {
      await startRound(loser); // §2.1 输家先报（并握斋权）
    }
  }

  // meta.elapsedMs 由宿主提供（决定性回放：引擎不读时钟）；用时是阅读材料（§2.4）
  async function act(p, action, meta = {}) {
    if (!PLAYERS.includes(p)) throw new Error(`unknown player ${p}`);
    const legal = legalActions(p);
    const base = { player: p, elapsedMs: meta.elapsedMs ?? null, timeout: meta.timeout ?? false };
    switch (action.type) {
      case 'peek':
        if (!legal.some((a) => a.type === 'peek')) throw new Error('illegal peek');
        peeked[p] = true;
        emit({ type: 'peek', ...base });
        return;
      case 'declare':
        if (!legal.some((a) => a.type === 'declare' && a.declaration === action.declaration))
          throw new Error(`illegal declare ${action.declaration}`);
        if (action.declaration === 'blind') blind[p] = true;
        else zhai = true;
        emit({ type: 'declare', declaration: action.declaration, ...base });
        return;
      case 'bid': {
        if (!legal.some((a) => a.type === 'bid')) throw new Error('illegal bid');
        const bid = { count: action.count, face: action.face };
        if (!isLegalBid(bid, currentBid(), zhai, totalDice())) throw new Error('bid off ladder');
        bids.push({ player: p, ...bid });
        turn = opp(p);
        emit({ type: 'bid', ...bid, ...base });
        return;
      }
      case 'challenge':
        if (!legal.some((a) => a.type === 'challenge')) throw new Error('illegal challenge');
        emit({ type: 'challenge', ...base });
        await settle(p);
        return;
      default:
        throw new Error(`unknown action ${action.type}`);
    }
  }

  // 玩家接口（§4.1）：自己的骰子 ＋ 公开事件流，别无其他
  function observe(p) {
    if (!PLAYERS.includes(p)) throw new Error(`unknown player ${p}`);
    return structuredClone({
      you: p,
      round,
      over,
      turn,
      zhai,
      blind: { ...blind },
      yourDice: peeked[p] ? dice[p] : null,
      diceCount: { you: diceCount[p], opp: diceCount[opp(p)] },
      chips: { you: chips[p], opp: chips[opp(p)] },
      currentBid: currentBid(),
      potUnits: 1 + bids.length,
      legal: legalActions(p),
      events,
    });
  }

  await startRound('A'); // §2.1 首局玩家位先报
  return { observe, act };
}
