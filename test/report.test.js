import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, persona, templateVerdict } from '../src/ui/report.js';

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
  assert.match(v, /第1局你想了9秒/);
});
