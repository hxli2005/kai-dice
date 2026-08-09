// 三层指标分离（施工单 A3，凭 Q52 对原方案的修正）。
//
// 原方案想直接量"分化"，Q52 指出分化可能来自"听不听话"而非性格——所以先分层，再看哪层动了：
//
//   合规层｜非法动作率／格式失败率／拒绝率。"某个模型不肯骗人"本身就是内容，不是噪声。
//   棋力层｜胜率／开牌命中／掐中。强弱是强弱，跟"是不是另一个人"没关系。
//   风味层｜虚报率／抬价深度／算频／蒙报／宣言使用／bait 频率。**只有这一层的分化支撑"模型即对手"。**
//
// 台词质量不在这里评——按排期须等接地批次 G2（否则评的是被主客体颠倒污染的台词）。
// 本模块只负责**留样**：lines 原样存着，等 G2 完了人来打分。

import { computeStats, diceByRoundOf } from '../ui/report.js';

const div = (a, b) => (b ? a / b : null);
const r2 = (v) => (v == null ? null : +v.toFixed(3));

// 一个席位在一场里的引擎侧真相（事件流复算，不问模型）
export function seatStats(match, seat) {
  return computeStats(match.events, seat, diceByRoundOf(match.events, seat));
}

const emptyAcc = () => ({
  label: null,
  model: null,
  // 合规层
  calls: 0,
  ok: 0,
  illegal: 0,
  noJson: 0,
  badJson: 0,
  empty: 0,
  refusal: 0,
  timeout: 0,
  error: 0,
  silentFallback: 0,
  engineRejects: 0,
  // 棋力层
  matches: 0,
  finished: 0,
  wins: 0,
  rounds: 0,
  challenges: 0,
  challengeHits: 0,
  calzas: 0,
  calzaHits: 0,
  netChips: 0,
  // 风味层
  seenBids: 0,
  bluffs: 0,
  blindBids: 0,
  bids: 0,
  depthSum: 0,
  depthN: 0,
  calcs: 0,
  declares: 0,
  says: 0,
  baits: 0,
  sayLenSum: 0,
  lines: [], // 台词留样（G2 之后再评）
  // 成本与后端（A4／A2 验尺）
  inTokens: 0,
  outTokens: 0,
  cacheRead: 0,
  costUsd: 0,
  costFromApi: 0,
  latencySum: 0,
  latencyN: 0,
  providers: {},
});

// 把一场里某个席位的账记进累加器
function accumulate(acc, match, seat, { keepLines = 6 } = {}) {
  const st = seatStats(match, seat);
  const logs = (match.logs?.[seat] ?? []).filter((l) => !l.auto);
  acc.matches += 1;
  if (match.over) {
    acc.finished += 1;
    if (match.winner === seat) acc.wins += 1;
  }
  acc.rounds += st.rounds;
  acc.challenges += st.myChallenges;
  acc.challengeHits += st.myChallengeHits;
  acc.calzas += st.myCalzas;
  acc.calzaHits += st.myCalzaHits;
  acc.seenBids += st.seenBids;
  acc.bluffs += st.myBluffs;
  acc.blindBids += st.blindBids;
  acc.bids += st.myBids;
  if (st.avgDepth) {
    acc.depthSum += st.avgDepth * st.ladderDepths.length;
    acc.depthN += st.ladderDepths.length;
  }
  acc.calcs += st.myCalcs;
  acc.declares += st.myBlinds + st.myRaises;
  acc.engineRejects += match.rejects?.[seat] ?? 0;
  const end = match.events.at(-1);
  if (end?.type === 'matchEnd') acc.netChips += (end.chips?.[seat] ?? 100) - 100;

  for (const l of logs) {
    acc.calls += 1;
    const o = l.outcome ?? (l.silentFallback ? 'error' : 'ok');
    if (o === 'ok') acc.ok += 1;
    else if (o === 'illegal') acc.illegal += 1;
    else if (o === 'no-json') acc.noJson += 1;
    else if (o === 'bad-json') acc.badJson += 1;
    else if (o === 'empty') acc.empty += 1;
    else if (o === 'refusal') acc.refusal += 1;
    else if (o === 'timeout') acc.timeout += 1;
    else if (o === 'error' || o === 'silent') acc.error += 1;
    if (l.silentFallback) acc.silentFallback += 1;
    if (l.say) {
      acc.says += 1;
      acc.sayLenSum += l.say.length;
      if (l.speechMode === 'bait') acc.baits += 1;
      if (acc.lines.length < keepLines) acc.lines.push({ round: l.round, say: l.say, belief: l.belief ?? '' });
    }
    const m = l.meta ?? {};
    acc.inTokens += m.inTokens ?? 0;
    acc.outTokens += m.outTokens ?? 0;
    acc.cacheRead += m.cacheRead ?? 0;
    if (typeof m.cost === 'number') {
      acc.costUsd += m.cost;
      acc.costFromApi += 1;
    }
    if (m.ms != null) {
      acc.latencySum += m.ms;
      acc.latencyN += 1;
    }
    if (m.provider) acc.providers[m.provider] = (acc.providers[m.provider] ?? 0) + 1;
  }
}

// 累加器 → 三层报表。每个比率都带自己的分母（A5：**结论必须带样本数**）。
export function finalize(acc) {
  const responded = acc.calls - acc.timeout - acc.error;
  return {
    label: acc.label,
    model: acc.model,
    samples: { matches: acc.matches, finished: acc.finished, calls: acc.calls, hands: responded, bids: acc.bids },
    // ① 合规层——"听不听话"。分化在这层，说明测的是驯服度不是性格。
    compliance: {
      illegalRate: r2(div(acc.illegal, responded)),
      formatFailRate: r2(div(acc.noJson + acc.badJson + acc.empty, responded)),
      refusalRate: r2(div(acc.refusal, responded)),
      silentFallbackRate: r2(div(acc.silentFallback, acc.calls)),
      timeouts: acc.timeout,
      errors: acc.error,
      engineRejects: acc.engineRejects, // 非零＝我们的校验漏了，不是模型的锅
      n: responded,
    },
    // ② 棋力层——强弱。强不等于"另一个人"。
    skill: {
      winRate: r2(div(acc.wins, acc.finished)),
      wins: acc.wins,
      challengeHitRate: r2(div(acc.challengeHits, acc.challenges)),
      challenges: acc.challenges,
      calzaHitRate: r2(div(acc.calzaHits, acc.calzas)),
      calzas: acc.calzas,
      netChips: acc.netChips,
      n: acc.finished,
    },
    // ③ 风味层——**只有这层的分化支撑"模型即对手"**。
    flavor: {
      bluffRate: r2(div(acc.bluffs, acc.seenBids)), // 分母＝看过骰之后报的口（F0c 口径）
      blindBidRate: r2(div(acc.blindBids, acc.bids)), // 骰都不看就报
      avgDepth: r2(div(acc.depthSum, acc.depthN)), // 抬价深度
      calcPerRound: r2(div(acc.calcs, acc.rounds)), // 算频（原生 tell：算不算是他自己的事）
      declarePerRound: r2(div(acc.declares, acc.rounds)), // 宣言使用率（盲＋抬）
      baitRate: r2(div(acc.baits, acc.says)), // 自认有意误导的比例
      avgSayLen: r2(div(acc.sayLenSum, acc.says)),
      lines: acc.lines, // 留样：台词质量评估等 G2
      n: { seenBids: acc.seenBids, bids: acc.bids, rounds: acc.rounds, says: acc.says },
    },
    // 成本与后端（A4 实收账目／A2 路由锁的验尺）
    cost: {
      inTokens: acc.inTokens,
      outTokens: acc.outTokens,
      cacheRead: acc.cacheRead,
      usd: +acc.costUsd.toFixed(4),
      usdFromApi: acc.costFromApi > 0, // false＝这数是估的，不是账单
      avgLatencyMs: acc.latencyN ? Math.round(acc.latencySum / acc.latencyN) : null,
    },
    providers: acc.providers,
  };
}

// 一批对局 → 每个模型一份三层报表。
export function summarize(matches, { keepLines = 6 } = {}) {
  const accs = new Map();
  const get = (label) => {
    if (!accs.has(label)) accs.set(label, { ...emptyAcc(), label, providers: {}, lines: [] });
    return accs.get(label);
  };
  for (const m of matches)
    for (const seat of ['A', 'B']) accumulate(get(m.seats[seat]), m, seat, { keepLines });
  return [...accs.values()].map(finalize);
}

// A2 路由锁的验收：回执里出现过第二个后端＝这批数据里混着后端差异，作废重跑。
// 锁不住不可怕，**以为锁住了**才可怕。
export function routingIntegrity(rows) {
  const dirty = rows
    .filter((r) => Object.keys(r.providers).length > 1)
    .map((r) => ({ label: r.label, providers: r.providers }));
  const blind = rows.filter((r) => Object.keys(r.providers).length === 0).map((r) => r.label);
  return {
    ok: dirty.length === 0,
    dirty,
    blind, // 回包里没有 provider 字段（非 OpenRouter 通道）：不是脏，是**没法验**
    note: dirty.length
      ? `路由锁没锁住：${dirty.map((d) => `${d.label}→${Object.keys(d.providers).join('/')}`).join('；')}——这批方差里混着后端差异，作废重跑`
      : blind.length
        ? `无法核验路由（回包不带 provider）：${blind.join('、')}`
        : '路由锁核验通过：每个模型全程只有一个后端接单',
  };
}

// 风味分化的判据（Q51 证据闸门）：**只看风味层**。
// 机器只能报"分没分开"，"分开得算不算一个人"由人看（红队条款：这里不下结论）。
export const FLAVOR_AXES = ['bluffRate', 'blindBidRate', 'avgDepth', 'calcPerRound', 'declarePerRound', 'baitRate'];

export function flavorSpread(rows, { minSamples = 20 } = {}) {
  const axes = {};
  for (const key of FLAVOR_AXES) {
    const vals = rows
      .filter((r) => (key === 'bluffRate' ? r.flavor.n.seenBids : r.flavor.n.rounds) >= minSamples)
      .map((r) => ({ label: r.label, v: r.flavor[key] }))
      .filter((x) => x.v != null);
    if (vals.length < 2) {
      axes[key] = { enough: false, n: vals.length };
      continue;
    }
    const lo = vals.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = vals.reduce((a, b) => (b.v > a.v ? b : a));
    axes[key] = { enough: true, n: vals.length, min: lo, max: hi, spread: r2(hi.v - lo.v) };
  }
  return axes;
}
