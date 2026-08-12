import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, persona, templateVerdict, condBrief, bigPotBrief } from '../src/ui/report.js';

// 手工构造一局：A 报了一真一假，被 B 开掉
const events = [
  { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
  { type: 'peek', actor: 'A' }, // F0c：看过骰才进虚报率的账
  { type: 'bid', actor: 'A', count: 2, face: 4, elapsedMs: 3000 },
  { type: 'bid', actor: 'B', count: 3, face: 4, elapsedMs: 1000 },
  { type: 'bid', actor: 'A', count: 5, face: 6, elapsedMs: 9000 },
  {
    type: 'reveal',
    actor: 'B', // G2：谁开的写在事件上，不再从 stands/loser 回推
    target: 'A',
    bid: { player: 'A', count: 5, face: 6 },
    dice: { A: [4, 4, 1, 2, 6], B: [3, 3, 5, 5, 2] },
    zhai: false,
    stands: false,
    actual: 2,
    loser: 'A',
  },
  { type: 'roundEnd', round: 1, loser: 'A', transfer: 4, chips: { A: 96, B: 104 }, diceCount: { A: 4, B: 5 } },
];

test('computeStats：虚报口径、被开、用时指纹', () => {
  const st = computeStats(events, 'A', { 1: [4, 4, 1, 2, 6] });
  assert.equal(st.myBids, 2);
  // 2个4：自见 4,4,癞子1 → 已然为真，非虚报；5个6：自见 6+癞子=2，需对方补 3 → P≈0.21 虚报
  assert.equal(st.myBluffs, 1);
  assert.equal(st.bluffRate, 0.5);
  assert.equal(st.timesChallenged, 1);
  assert.equal(st.myChallenges, 0);
  assert.deepEqual(st.slowest, { round: 1, bid: { count: 5, face: 6 }, ms: 9000 });
  assert.equal(st.avgDepth, 3);
});

test('persona 与模板判词：可生成且引用真实局面', () => {
  const st = computeStats(events, 'A', { 1: [4, 4, 1, 2, 6] });
  assert.equal(typeof persona(st), 'string');
  const v = templateVerdict(st, false);
  // Q15：极端犹豫只说现象（锚定局号与报价），秒数不入判词
  assert.match(v, /第1局你停了半天才报5个6/);
  assert.ok(!/\d秒/.test(v));
});

// ---------- G7：一张"没站住"的账拆成两笔 ----------
// 手里 [2,3,4,5,2] 一个 6 都没有（也没癞子）：3 个 6 还有 0.21 的活路（悬＝可能只是估错），
// 8 个／10 个 6 是 0.000（明知——他自己看过骰）。判词只许对后者说狠话。
const g7 = [
  { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
  { type: 'peek', actor: 'A' },
  { type: 'bid', actor: 'A', count: 3, face: 6 },
  { type: 'bid', actor: 'B', count: 4, face: 6 },
  { type: 'bid', actor: 'A', count: 8, face: 6 },
  { type: 'bid', actor: 'B', count: 9, face: 6 },
  { type: 'bid', actor: 'A', count: 10, face: 6 },
  {
    type: 'reveal', actor: 'B', target: 'A', bid: { player: 'A', count: 10, face: 6 },
    dice: { A: [2, 3, 4, 5, 2], B: [1, 2, 3, 4, 5] }, zhai: false, stands: false, actual: 1, loser: 'A',
  },
  { type: 'roundEnd', round: 1, loser: 'A', winner: 'B', transfer: 6, mult: 1, chips: {}, diceCount: { A: 4, B: 5 } },
];

test('G7：虚报拆成「明知」与「看走眼」两笔，总数不变', () => {
  const st = computeStats(g7, 'A', { 1: [2, 3, 4, 5, 2] });
  assert.equal(st.myBluffs, 3, '三口都没站住');
  assert.equal(st.myKnowingBluffs, 2, '其中两口是自见概率不足 15% 的明知');
  assert.equal(st.myThinBluffs, 1, '3 个 6 还有两成活路，算看走眼');
  assert.equal(st.myKnowingBluffs + st.myThinBluffs, st.myBluffs, '两笔账合起来就是原来的虚报数');
  assert.equal(st.knowingWildest.bid.count, 8, '明知里最离谱的那口留了痕（10 个 6 与 8 个 6 同为 0，取先到的）');
});

test('G7 文案：明知才配"想让我信"，估悬只说他算不准', () => {
  const knowing = computeStats(g7, 'A', { 1: [2, 3, 4, 5, 2] });
  const v = templateVerdict(knowing, false);
  assert.match(v, /你自己看过骰/, '明知的那口要点名');
  assert.doesNotMatch(v, /句是空的/, '旧口径把所有没站住的价都说成"空的"');
  assert.match(condBrief(knowing), /明知站不住/);

  // 同样超过一半没站住，但全是悬价：不许说成骗
  const thin = { ...knowing, myKnowingBluffs: 0, myThinBluffs: 3, knowingWildest: null, bluffRate: 0.6 };
  const tv = templateVerdict(thin, false);
  assert.match(tv, /你是真算不准/);
  assert.doesNotMatch(tv, /想让我信/);
  assert.match(condBrief(thin), /更像估不准，不像有意骗/);
});

// F0：三人桌一场——A 开过李（B）也开过飞（C），并被 C 开过一次；A 第 2 局末出局，桌子继续打第 3 局
const trio = [
  { type: 'roundStart', round: 1, diceCount: { A: 1, B: 5, C: 5 } },
  { type: 'peek', actor: 'A' },
  { type: 'bid', actor: 'A', count: 2, face: 4 },
  { type: 'bid', actor: 'B', count: 8, face: 4 },
  { type: 'calc', actor: 'A' },
  {
    type: 'reveal', bid: { player: 'B', count: 8, face: 4 }, actor: 'A', target: 'B',
    dice: { A: [6], B: [3, 3, 5, 5, 2], C: [2, 2, 2, 6, 6] }, zhai: false, stands: false, actual: 0, loser: 'B',
  },
  { type: 'roundEnd', round: 1, loser: 'B', winner: 'A', transfer: 8, mult: 4, chips: {}, diceCount: { A: 1, B: 4, C: 5 } },
  { type: 'roundStart', round: 2, diceCount: { A: 1, B: 4, C: 5 } },
  { type: 'bid', actor: 'A', count: 2, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 2, face: 6 }, actor: 'C', target: 'A',
    dice: { A: [6], B: [3, 3, 5, 5], C: [2, 2, 2, 3, 3] }, zhai: false, stands: false, actual: 1, loser: 'A',
  },
  { type: 'roundEnd', round: 2, loser: 'A', winner: 'C', transfer: 2, mult: 1, chips: {}, diceCount: { A: 0, B: 4, C: 5 } },
  { type: 'roundStart', round: 3, diceCount: { A: 0, B: 4, C: 5 } },
];

test('F0 归属拆分：谁开的谁被开算在谁头上，参战局数与全桌局数分开', () => {
  const st = computeStats(trio, 'A', { 1: [6], 2: [6] });
  assert.equal(st.rounds, 3, '全桌打了 3 局');
  assert.equal(st.roundsAlive, 2, '客人只参战 2 局（第 3 局已出局）');
  assert.equal(st.vs.B.iOpened, 1);
  assert.equal(st.vs.B.iOpenedHit, 1);
  assert.equal(st.vs.B.theyOpenedMe, 0, '李没开过他——这笔账不许记到李头上');
  assert.equal(st.vs.C.theyOpenedMe, 1);
  assert.equal(st.myChallenges, 1);
  assert.equal(st.timesChallenged, 1);
});

test('F5 记忆加权：≥×4 的池入重点素材', () => {
  const st = computeStats(trio, 'A', { 1: [6], 2: [6] });
  assert.equal(st.bigPots.length, 1);
  assert.match(bigPotBrief(st), /第 1 局那个 ×4 的池：他收走了 8/);
});

test('F6 算盘依赖度：算完照没照着数走', () => {
  const st = computeStats(trio, 'A', { 1: [6], 2: [6] });
  assert.equal(st.myCalcs, 1);
  assert.equal(st.calcDecisions, 1);
  assert.equal(st.calcFollows, 1, '算完开掉一口 P 很低的价＝照着数走');
  assert.equal(st.calcFollowRate, 1);
  const dep = condBrief({ ...st, myCalcs: 4, calcFollowRate: 1 });
  assert.match(dep, /在跟算盘打牌/);
  const bluff = condBrief({ ...st, myCalcs: 4, calcFollowRate: 0.25 });
  assert.match(bluff, /算给人看的/);
});

test('模板判词：条件倾向（心理侧）排最前', () => {
  const st = {
    bluffRate: 0.3, myBids: 6, myChallenges: 2, myChallengeHits: 2, hitRate: 1, rounds: 5,
    slowest: { round: 2, bid: { count: 4, face: 3 }, ms: 12000 },
    conditional: { afterLossBluffRate: 0.7, afterLossBids: 3, bigPotOpenRate: null, smallPotOpenRate: null, postChalFirstP: null, baseFirstP: null },
  };
  const v = templateVerdict(st, false);
  assert.match(v, /^一输你就浮/);
});
