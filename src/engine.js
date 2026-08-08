// 规则引擎（DESIGN §2、§2.5、§4）。N 人桌：轮转报数、开只开上家、淘汰至一人独存。
// 架构宪法：引擎只暴露玩家接口 observe()/act()，对面是人是 AI 不知也不问。
// 他人骰面不存在于 observe 返回的 schema 中——公平由 schema 强制。

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

export const PLAYERS = ['A', 'B']; // 默认二人桌

export const DEFAULTS = {
  startDice: 5, // 附:待定参数表
  startChips: 100, // §2.2 初始筹码；可为负，不触发终局
};

// 承诺哈希（§4.1）异步生成，故工厂为 async；act() 同为 async。
export async function createMatch({ seed, config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const players = cfg.players ?? ['A', 'B'];
  const rng = mulberry32(seed ?? 1);
  const nonceGen = () =>
    Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join('');

  // 私有状态（闭包内，永不整体外泄）
  const diceCount = {};
  const chips = {};
  for (const p of players) {
    diceCount[p] = cfg.startDice;
    // startChips 可为 {A,B,...}（跨场账本续上回）或数字（全桌同额）
    chips[p] = typeof cfg.startChips === 'object' ? cfg.startChips[p] : cfg.startChips;
  }
  const events = []; // 公开事件流，全桌同构可见
  const eliminatedOrder = []; // 出局顺序（场终名次用）
  let round = 0;
  let over = false;
  let dice = null; // {p: [...]} 仅活人
  let nonces = null;
  let turn = null;
  let firstBidder = null;
  let bids = []; // [{player, count, face}]
  let peeked = null;
  let blind = null;
  let zhai = false;
  let raises = null; // Q22「抬」：{p: bool}，每人每局限一次，全桌对等生效

  const alive = (p) => diceCount[p] > 0;
  const aliveList = () => players.filter(alive);
  // 轮转序中 p 的下一个活人
  const nextAlive = (p) => {
    const i = players.indexOf(p);
    for (let k = 1; k <= players.length; k++) {
      const q = players[(i + k) % players.length];
      if (alive(q)) return q;
    }
    return p;
  };
  const totalDice = () => players.reduce((s, p) => s + diceCount[p], 0);
  const currentBid = () => (bids.length ? bids.at(-1) : null);
  const emit = (e) => events.push({ i: events.length, ...e });
  // §2.2/Q22 赔率乘法叠加：每名盲者 ×2、每记「抬」×2、斋 ×1.5、深水线（第 6 档起）×2
  const potMult = () =>
    aliveList().reduce((m, p) => m * (blind[p] ? 2 : 1) * (raises[p] ? 2 : 1), 1) *
    (zhai ? 1.5 : 1) *
    (bids.length >= 6 ? 2 : 1);

  async function startRound(first) {
    round += 1;
    dice = {};
    nonces = {};
    peeked = {};
    blind = {};
    const commits = {};
    raises = {};
    for (const p of aliveList()) {
      dice[p] = Array.from({ length: diceCount[p] }, () => 1 + Math.floor(rng() * 6));
      nonces[p] = nonceGen();
      commits[p] = await commitmentOf(dice[p], nonces[p]);
      peeked[p] = false;
      blind[p] = false;
      raises[p] = false;
    }
    turn = first;
    firstBidder = first;
    bids = [];
    zhai = false;
    emit({ type: 'roundStart', round, first, diceCount: { ...diceCount }, commits });
  }

  function legalActions(p) {
    if (over || !alive(p)) return [];
    const acts = [];
    if (!peeked[p] && !blind[p]) acts.push({ type: 'peek' });
    if (p !== turn) return acts;
    // §2.3 宣言窗口（Q22 放宽）：盲=只要尚未看骰（已报过数也行——追认既成的裸报）；
    // 斋=仅首报者首报前；抬=轮到你、本局没抬过（空手抬是合法演技）；可叠加
    if (!peeked[p] && !blind[p]) acts.push({ type: 'declare', declaration: 'blind' });
    if (p === firstBidder && bids.length === 0 && !zhai)
      acts.push({ type: 'declare', declaration: 'zhai' });
    if (!raises[p]) acts.push({ type: 'declare', declaration: 'raise' });
    if (allLegalBids(currentBid(), zhai, totalDice()).length > 0) acts.push({ type: 'bid' });
    // §2.5：开只能开上家——轮转报数下当前报价者必为你的上家，challenge 天然指向上家
    if (bids.length > 0) acts.push({ type: 'challenge' });
    return acts;
  }

  async function settle(challenger) {
    const bid = currentBid();
    const all = aliveList().flatMap((p) => dice[p]);
    const stands = bidStands(bid, all, zhai);
    const loser = stands ? challenger : bid.player;
    const winner = stands ? bid.player : challenger; // 开牌局的胜者收池
    emit({
      type: 'reveal',
      dice: Object.fromEntries(aliveList().map((p) => [p, [...dice[p]]])),
      nonces: { ...nonces },
      bid: { ...bid },
      challenger,
      actual: countBid(bid, all, zhai),
      zhai,
      stands,
      loser,
    });
    // 注池（§2.2/§2.5）：全桌各底注 1、每次报数全桌各追 1；胜者收池——第三方的注跟池走
    const units = 1 + bids.length;
    const mult = potMult(); // 赔率四舍五入前累乘（盲/抬/斋/深水）
    const pay = Math.round(units * mult);
    const transfers = {};
    let pot = 0;
    for (const p of aliveList())
      if (p !== winner) {
        transfers[p] = -pay;
        chips[p] -= pay;
        pot += pay;
      }
    transfers[winner] = pot;
    chips[winner] += pot;
    diceCount[loser] -= 1;
    if (diceCount[loser] === 0) eliminatedOrder.push(loser);
    emit({
      type: 'roundEnd',
      round,
      loser,
      winner,
      transfer: pay,
      transfers,
      mult,
      chips: { ...chips },
      diceCount: { ...diceCount },
    });
    if (aliveList().length <= 1) {
      over = true;
      const champion = aliveList()[0] ?? winner;
      emit({
        type: 'matchEnd',
        winner: champion,
        standings: [champion, ...[...eliminatedOrder].reverse()],
        rounds: round,
        chips: { ...chips },
      });
    } else {
      // §2.1 输家先报（并握斋权）；输家出局则其下家先报
      await startRound(alive(loser) ? loser : nextAlive(loser));
    }
  }

  // meta.elapsedMs 由宿主提供（决定性回放：引擎不读时钟）；用时是阅读材料（§2.4）
  async function act(p, action, meta = {}) {
    if (!players.includes(p)) throw new Error(`unknown player ${p}`);
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
        else if (action.declaration === 'raise') raises[p] = true;
        else zhai = true;
        emit({ type: 'declare', declaration: action.declaration, ...base });
        return;
      case 'bid': {
        if (!legal.some((a) => a.type === 'bid')) throw new Error('illegal bid');
        const bid = { count: action.count, face: action.face };
        if (!isLegalBid(bid, currentBid(), zhai, totalDice())) throw new Error('bid off ladder');
        bids.push({ player: p, ...bid });
        turn = nextAlive(p);
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

  // 玩家接口（§4.1）：自己的骰子 ＋ 公开事件流，别无其他。
  // diceCount.opp = 场上未知骰总数（他人合计）——概率计算的正确输入，2 人时即对方骰数。
  function observe(p) {
    if (!players.includes(p)) throw new Error(`unknown player ${p}`);
    return structuredClone({
      you: p,
      round,
      over,
      turn,
      zhai,
      blind: { ...blind },
      raises: { ...raises },
      potMult: potMult(),
      players: players.map((q) => ({
        id: q,
        diceCount: diceCount[q],
        chips: chips[q],
        alive: alive(q),
        blind: blind?.[q] ?? false,
      })),
      yourDice: peeked?.[p] ? dice[p] : null,
      diceCount: { you: diceCount[p], opp: totalDice() - diceCount[p] },
      chips: { you: chips[p], opp: players.length === 2 ? chips[nextAlive(p)] : null },
      currentBid: currentBid(),
      potUnits: 1 + bids.length,
      legal: legalActions(p),
      events,
    });
  }

  await startRound(players[0]); // §2.1 首局玩家位先报
  return { observe, act, players };
}
