import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, persona, templateVerdict, condBrief, bigPotBrief } from '../src/ui/report.js';

// 手工构造一局：A 报了一真一假，被 B 开掉
const events = [
  { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
  { type: 'bid', player: 'A', count: 2, face: 4, elapsedMs: 3000 },
  { type: 'bid', player: 'B', count: 3, face: 4, elapsedMs: 1000 },
  { type: 'bid', player: 'A', count: 5, face: 6, elapsedMs: 9000 },
  {
    type: 'reveal',
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

// F0：三人桌一场——A 开过李（B）也开过飞（C），并被 C 开过一次；A 第 2 局末出局，桌子继续打第 3 局
const trio = [
  { type: 'roundStart', round: 1, diceCount: { A: 1, B: 5, C: 5 } },
  { type: 'bid', player: 'A', count: 2, face: 4 },
  { type: 'bid', player: 'B', count: 8, face: 4 },
  { type: 'calc', player: 'A' },
  {
    type: 'reveal', bid: { player: 'B', count: 8, face: 4 }, challenger: 'A',
    dice: { A: [6], B: [3, 3, 5, 5, 2], C: [2, 2, 2, 6, 6] }, zhai: false, stands: false, actual: 0, loser: 'B',
  },
  { type: 'roundEnd', round: 1, loser: 'B', winner: 'A', transfer: 8, mult: 4, chips: {}, diceCount: { A: 1, B: 4, C: 5 } },
  { type: 'roundStart', round: 2, diceCount: { A: 1, B: 4, C: 5 } },
  { type: 'bid', player: 'A', count: 2, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 2, face: 6 }, challenger: 'C',
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
