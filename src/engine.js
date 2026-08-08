// 规则引擎（DESIGN §2、§2.5、§4）。N 人桌：轮转报数、开只开上家、淘汰至一人独存。
// 架构宪法：引擎只暴露玩家接口 observe()/act()，对面是人是 AI 不知也不问。
// 他人骰面不存在于 observe 返回的 schema 中——公平由 schema 强制。
//
// 词条运行时（§8 实验桌，Q32/Q37/Q39）：词条＝纯数据 AST（窗口谓词 × 效果原子），
// 引擎按原子解释执行，运行期零 LLM 裁判。官方词条与玩家许愿共用同一语法（原子库见 src/mods/catalog.js）。

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
  const mods = cfg.mods ?? []; // 词条（明牌规则卡）：已过静态校验的 AST
  const modActs = mods.flatMap((m) => m.actions.map((a) => ({ mod: m, a })));
  const rng = mulberry32(seed ?? 1);
  const nonceGen = () =>
    Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join('');

  // 私有状态（闭包内，永不整体外泄）
  const diceCount = {};
  const chips = {};
  const usedMatch = {}; // 词条限次（每场）
  for (const p of players) {
    diceCount[p] = cfg.startDice;
    // startChips 可为 {A,B,...}（跨场账本续上回）或数字（全桌同额）
    chips[p] = typeof cfg.startChips === 'object' ? cfg.startChips[p] : cfg.startChips;
    usedMatch[p] = {};
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
  // Q45「算」：拨算盘是公开动作（何时算＝tell），结果私有（客户端各算各的，引擎不发数）。
  // 每人每局一次——算盘一旦摆上桌，这一局都在桌上；也天然挡住"算→算→算"的空转。
  let calced = null;
  let shown = {}; // 词条「亮」：{p: [faces]} 本局公开亮出的自骰（公开事实，仍算手里的骰）
  let usedRound = {}; // 词条限次（每局）
  let modPotFactor = 1; // 词条 potMult 原子的本局倍率

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
  // §2.2/Q22 赔率乘法叠加：每名盲者 ×2、每记「抬」×2、斋 ×1.5、深水线（第 6 档起）×2、词条倍率
  const potMult = () =>
    aliveList().reduce((m, p) => m * (blind[p] ? 2 : 1) * (raises[p] ? 2 : 1), 1) *
    (zhai ? 1.5 : 1) *
    (bids.length >= 6 ? 2 : 1) *
    modPotFactor;

  async function startRound(first) {
    round += 1;
    dice = {};
    nonces = {};
    peeked = {};
    blind = {};
    const commits = {};
    raises = {};
    calced = {};
    shown = {};
    usedRound = {};
    modPotFactor = 1;
    for (const p of aliveList()) {
      dice[p] = Array.from({ length: diceCount[p] }, () => 1 + Math.floor(rng() * 6));
      nonces[p] = nonceGen();
      commits[p] = await commitmentOf(dice[p], nonces[p]);
      peeked[p] = false;
      blind[p] = false;
      raises[p] = false;
      calced[p] = false;
      shown[p] = [];
      usedRound[p] = {};
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
    // Q45「算」：轮到你时可拨一次算盘（本局限一次，算完行动权仍在你）
    if (!calced[p]) acts.push({ type: 'calc' });
    if (allLegalBids(currentBid(), zhai, totalDice()).length > 0) acts.push({ type: 'bid' });
    // §2.5：开只能开上家——轮转报数下当前报价者必为你的上家。
    // 「让报」词条可把报价推回报价者本人，故须挡"开自己的价"（基础局中此条件恒真）。
    if (bids.length > 0 && currentBid().player !== p) acts.push({ type: 'challenge' });
    // 词条动作：窗口谓词逐条评估（全部只在自己回合，schema 校验强制 turn=true）
    for (const { a } of modActs) {
      const w = a.window ?? {};
      const cb = currentBid();
      if (w.needBid && !cb) continue;
      if (w.noBid && cb) continue;
      if (w.notOwnBid && cb?.player === p) continue;
      if (w.requiresPeeked && !peeked[p]) continue;
      if (w.oncePer === 'round' && (usedRound[p]?.[a.type] ?? 0) >= 1) continue;
      if (w.oncePer === 'match' && (usedMatch[p]?.[a.type] ?? 0) >= 1) continue;
      if (w.minBids != null && bids.length < w.minBids) continue;
      if (w.maxBids != null && bids.length > w.maxBids) continue;
      // 防死局：推回去的人必须还抬得动
      if (w.needRaisableByBidder && !(cb && allLegalBids(cb, zhai, totalDice()).length > 0)) continue;
      acts.push({ type: a.type });
    }
    return acts;
  }

  // 结算共用件：胜者收池（其余活人各付 units×mult），返回转移明细
  function payout(winner) {
    const pay = Math.round((1 + bids.length) * potMult());
    const transfers = {};
    let pot = 0;
    for (const q of aliveList())
      if (q !== winner) {
        transfers[q] = -pay;
        chips[q] -= pay;
        pot += pay;
      }
    transfers[winner] = pot;
    chips[winner] += pot;
    return { pay, transfers };
  }

  // 终局判定共用件：一人独存则场终，否则开下一局
  async function finishRound(nextFirst, fallbackWinner) {
    if (aliveList().length <= 1) {
      over = true;
      const champion = aliveList()[0] ?? fallbackWinner;
      emit({
        type: 'matchEnd',
        winner: champion,
        standings: [champion, ...[...eliminatedOrder].reverse()],
        rounds: round,
        chips: { ...chips },
      });
    } else {
      await startRound(nextFirst);
    }
  }

  const revealSnapshot = () => ({
    dice: Object.fromEntries(aliveList().map((p) => [p, [...dice[p]]])),
    nonces: { ...nonces },
  });

  async function settle(challenger) {
    const bid = currentBid();
    const all = aliveList().flatMap((p) => dice[p]);
    const stands = bidStands(bid, all, zhai);
    const loser = stands ? challenger : bid.player;
    const winner = stands ? bid.player : challenger; // 开牌局的胜者收池
    emit({
      type: 'reveal',
      ...revealSnapshot(),
      bid: { ...bid },
      challenger,
      actual: countBid(bid, all, zhai),
      zhai,
      stands,
      loser,
    });
    // 注池（§2.2/§2.5）：全桌各底注 1、每次报数全桌各追 1；胜者收池——第三方的注跟池走
    const mult = potMult(); // 赔率四舍五入前累乘（盲/抬/斋/深水/词条）
    const { pay, transfers } = payout(winner);
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
    // §2.1 输家先报（并握斋权）；输家出局则其下家先报
    await finishRound(alive(loser) ? loser : nextAlive(loser), winner);
  }

  // 词条「掐」（Q37 Perudo Calza）：宣布报价恰好为真并开牌。
  // 掐对＝掐者赢回一颗骰（唯一回骰通道，上限=起始骰数）并收池；掐错＝掐者掉一颗骰、报价者收池。
  // 被掐的报价者永不掉骰。下一局：掐对→报价者先报；掐错→掐者（输家）先报。
  async function settleCalza(caller) {
    const bid = currentBid();
    const all = aliveList().flatMap((p) => dice[p]);
    const actual = countBid(bid, all, zhai);
    const exact = actual === bid.count;
    const winner = exact ? caller : bid.player;
    const loser = exact ? null : caller;
    emit({
      type: 'reveal',
      ...revealSnapshot(),
      bid: { ...bid },
      challenger: caller,
      calza: true,
      exact,
      actual,
      zhai,
      stands: bidStands(bid, all, zhai),
      loser,
    });
    const mult = potMult();
    const { pay, transfers } = payout(winner);
    if (exact) {
      diceCount[caller] = Math.min(cfg.startDice, diceCount[caller] + 1);
    } else {
      diceCount[caller] -= 1;
      if (diceCount[caller] === 0) eliminatedOrder.push(caller);
    }
    emit({
      type: 'roundEnd',
      round,
      calza: true,
      exact,
      caller,
      loser,
      winner,
      transfer: pay,
      transfers,
      mult,
      chips: { ...chips },
      diceCount: { ...diceCount },
    });
    await finishRound(exact ? bid.player : alive(caller) ? caller : nextAlive(caller), winner);
  }

  // 词条效果原子（引擎侧预实现，Q38"原子预审预实现"）；参数已在 legal 检查后到达
  async function applyMod(p, { mod, a }, action, base) {
    // 参数先验后计数：revealOwnDie 需要 face 且必须真在手里
    if (a.effect.some((e) => e.op === 'revealOwnDie')) {
      if (!Number.isInteger(action.face) || !dice[p].includes(action.face))
        throw new Error('no such die');
    }
    usedRound[p][a.type] = (usedRound[p][a.type] ?? 0) + 1;
    usedMatch[p][a.type] = (usedMatch[p][a.type] ?? 0) + 1;
    for (const ef of a.effect) {
      switch (ef.op) {
        case 'revealOwnDie':
          shown[p].push(action.face);
          emit({ type: 'modAction', mod: mod.id, action: a.type, op: ef.op, face: action.face, ...base });
          break;
        case 'potMult':
          modPotFactor *= ef.x ?? 2;
          emit({ type: 'modAction', mod: mod.id, action: a.type, op: ef.op, x: ef.x ?? 2, ...base });
          break;
        case 'returnBid':
          turn = currentBid().player;
          emit({ type: 'modAction', mod: mod.id, action: a.type, op: ef.op, to: turn, ...base });
          break;
        case 'calzaResolve':
          emit({ type: 'modAction', mod: mod.id, action: a.type, op: ef.op, ...base });
          await settleCalza(p);
          break;
        default:
          throw new Error(`unknown op ${ef.op}`);
      }
    }
    // keepTurn（声明式动作）：行动权保留；returnBid/calzaResolve 已自行处理 turn/round
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
      case 'calc':
        // 只落一条公开事实"他算了"，不落结果——精确数字由各自客户端用自己的骰算（§B.1 双发）
        if (!legal.some((a) => a.type === 'calc')) throw new Error('illegal calc');
        calced[p] = true;
        emit({ type: 'calc', ...base });
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
      default: {
        const ma = modActs.find((x) => x.a.type === action.type);
        if (!ma || !legal.some((x) => x.type === action.type))
          throw new Error(`illegal ${action.type}`);
        await applyMod(p, ma, action, base);
        return;
      }
    }
  }

  // 玩家接口（§4.1）：自己的骰子 ＋ 公开事件流，别无其他。
  // diceCount.opp = 场上未知骰总数（他人合计）——概率计算的正确输入，2 人时即对方骰数。
  // shown = 全桌公开亮出的明骰（公开事实，双方同见）；mods = 本桌词条规则卡（明牌）。
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
      calced: { ...calced }, // 谁拨过算盘＝公开事实（Q45）；算出来的数各自私有
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
      shown,
      mods: mods.map((m) => ({
        id: m.id,
        name: m.name,
        card: m.card,
        actions: m.actions.map((a) => ({
          type: a.type,
          label: a.label,
          params: a.params ?? null,
          keepTurn: !!a.keepTurn,
          terminal: !!a.terminal,
          ops: a.effect.map((e) => e.op),
        })),
      })),
      legal: legalActions(p),
      events,
    });
  }

  await startRound(players[0]); // §2.1 首局玩家位先报
  return { observe, act, players };
}
