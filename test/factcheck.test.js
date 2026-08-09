// 事实转写禁令（Q46／Q47，施工单 F0b/F0c）：用户实测三 bug 固化为回归用例。
// 教义：可以骗玩家它怎么想，不能骗玩家发生过什么。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { buildLedger, checkFacts, toNum } from '../src/ai/factcheck.js';
import { createOpponent, parseDecision } from '../src/ai/agent.js';
import { PERSONAS } from '../src/ai/personas.js';
import { computeStats, persona, condBrief } from '../src/ui/report.js';

const mockFetch = (content) => async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

// 一局：A 报 10 个 6 → B 报 9 个 6 → A 报 8 个 6（阶梯其实是下不去的，这里用引擎真实序列）
async function ladderMatch() {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  await m.act('B', { type: 'bid', count: 3, face: 4 });
  await m.act('A', { type: 'bid', count: 9, face: 6 });
  return m;
}

test('F0b 台账：报价史从事件流复算，掉骰数按引擎口径', async () => {
  const m = await ladderMatch();
  const led = buildLedger(m.observe('B'));
  assert.deepEqual(led.seq, ['2个4', '3个4', '9个6']);
  assert.equal(led.round, 1);
  assert.deepEqual(led.lost, { A: 0, B: 0 });
  assert.equal(toNum('两'), 2);
  assert.equal(toNum('十'), 10);
  assert.equal(toNum('十二'), 12);
});

test('F0b bug①：报价序列不许被转写（"两次九个六"当场掐掉）', async () => {
  const m = await ladderMatch();
  const led = buildLedger(m.observe('B'));
  assert.deepEqual(checkFacts('你九个六都喊上了', led), [], '真发生过的价可以引');
  assert.match(checkFacts('你两次九个六，当我瞎', led)[0], /bid-count/);
  assert.deepEqual(checkFacts('你从三个四直接跳到九个六', led), [], '顺序对的不拦');
  assert.match(checkFacts('你先报九个六再报三个四', led)[0], /bid-order/);
  assert.match(checkFacts('你那口七个五呢', led)[0], /bid-not-in-history/, '没发生过的价＝编');
});

test('F0b bug②：骰数不许混记（"掉两颗骰"是故障不是心理战）', async () => {
  const m = await ladderMatch();
  const led = buildLedger(m.observe('B'));
  assert.deepEqual(checkFacts('这局你掉一颗骰', led), []);
  assert.match(checkFacts('这一局你掉了两颗骰', led)[0], /dice-loss/);
  assert.deepEqual(checkFacts('第 1 局的账', led), []);
  assert.match(checkFacts('第 9 局你就露怯了', led)[0], /round/, '还没打到的局不许引用');
});

test('F0b 自由表演区：手牌与内心随便吹，一个字不管（Q47）', async () => {
  const m = await ladderMatch();
  const led = buildLedger(m.observe('B'));
  for (const line of [
    '我手里有三个六，你自己掂量',
    '我这把是四个二，开我啊',
    '你这停顿就是心虚，我看死你了',
    '你一定在诈，这话我敢打包票',
  ])
    assert.deepEqual(checkFacts(line, led), [], `牌手层被误杀：${line}`);
});

test('F8 对账前提：决策日志与 AI 的动作严格 1:1（自动掀盅也落账）', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const ai = createOpponent({ persona: PERSONAS.laolitou }); // 无通道＝沉默 bot
  let decisions = 0;
  for (let i = 0; i < 3; i++) {
    const ob = m.observe('B');
    if (ob.over || ob.turn !== 'B') break;
    const d = await ai.decide(ob);
    decisions++;
    if (d.action.type === 'challenge') break;
    await m.act('B', d.action);
  }
  assert.ok(decisions >= 2, '至少走过"先掀盅、再落子"两拍');
  assert.equal(ai.logs.length, decisions, '每次决策一条日志——自动掀盅那拍不许漏');
  assert.equal(ai.logs[0].auto, true, '自动掀盅标 auto——它不代表通道状态');
});

test('F0b 出口校验接进决策链：说错事实的那句被掐掉并留痕', async () => {
  const m = await ladderMatch();
  const ai = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    persona: PERSONAS.laolitou,
    fetchFn: mockFetch(
      '{"action":{"type":"challenge"},"say":"你两次九个六，开。","belief":"其实五五开","speechMode":"bait","note":"n"}',
    ),
  });
  const d = await ai.decide(m.observe('B'));
  assert.equal(d.action.type, 'challenge');
  assert.equal(d.say, '', '事实说错＝不许出口');
  assert.match(d.dropped, /say:bid-count/);
  // 留档不受影响：对外可以不说，对内必须交底（Q47）
  assert.equal(d.belief, '其实五五开');
  assert.equal(d.speechMode, 'bait');
});

test('F0b 留档字段：belief/speechMode 进 schema 与决策日志', async () => {
  const m = await ladderMatch();
  const ob = m.observe('B');
  const good = parseDecision(
    '{"action":{"type":"challenge"},"say":"看死你了","belief":"其实只是五五开，钓他洗白","speechMode":"bait"}',
    ob,
  );
  assert.equal(good.speechMode, 'bait');
  assert.match(good.belief, /五五开/);
  const plain = parseDecision('{"action":{"type":"challenge"},"say":"开"}', ob);
  assert.equal(plain.speechMode, 'straight');
  assert.equal(plain.belief, '');
});

// ---------- F0c 蒙报类目 ----------

const blindEvents = [
  { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
  // 故意不看骰，直接极限报价（用户实测：旧口径把他判成"虚报率 0% 老实人"）
  { type: 'bid', player: 'A', count: 9, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 9, face: 6 }, challenger: 'B',
    dice: { A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] }, zhai: false, stands: false, actual: 4, loser: 'A',
  },
  { type: 'roundEnd', round: 1, loser: 'A', winner: 'B', transfer: 2, mult: 1, chips: {}, diceCount: { A: 4, B: 5 } },
  { type: 'roundStart', round: 2, diceCount: { A: 4, B: 5 } },
  { type: 'bid', player: 'A', count: 8, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 8, face: 6 }, challenger: 'B',
    dice: { A: [1, 2, 3, 4], B: [1, 2, 3, 4, 5] }, zhai: false, stands: false, actual: 3, loser: 'A',
  },
  { type: 'roundEnd', round: 2, loser: 'A', winner: 'B', transfer: 2, mult: 1, chips: {}, diceCount: { A: 3, B: 5 } },
  { type: 'roundStart', round: 3, diceCount: { A: 3, B: 5 } },
  { type: 'bid', player: 'A', count: 7, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 7, face: 6 }, challenger: 'B',
    dice: { A: [1, 2, 3], B: [1, 2, 3, 4, 5] }, zhai: false, stands: false, actual: 2, loser: 'A',
  },
  { type: 'roundEnd', round: 3, loser: 'A', winner: 'B', transfer: 2, mult: 1, chips: {}, diceCount: { A: 2, B: 5 } },
];

test('F0c bug③：故意不看骰的极限报价不再被写成"老实人"', () => {
  const st = computeStats(blindEvents, 'A', {});
  assert.equal(st.myBids, 3);
  assert.equal(st.blindBids, 3, '三口全是蒙报');
  assert.equal(st.seenBids, 0);
  assert.equal(st.blindBluffs, 3, '零信息下也 <50%——明知没底还往上抬');
  assert.equal(st.blindBidRate, 1);
  assert.ok(st.blindWildest.p < 0.05, `蒙报极限度：${st.blindWildest.p}`);
  assert.equal(persona(st), '蒙眼虎', '不许再叫老实人');
  assert.match(condBrief(st), /没看骰就报的/);
});

test('F0c：看过骰之后的报价才进虚报率，且宣言盲与事实未看分开跟踪', () => {
  const mixed = [
    { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
    { type: 'bid', player: 'A', count: 3, face: 6 }, // 蒙报
    { type: 'peek', player: 'A' },
    { type: 'bid', player: 'A', count: 6, face: 6 }, // 看过之后再报
  ];
  const st = computeStats(mixed, 'A', { 1: [6, 6, 6, 6, 6] });
  assert.equal(st.blindBids, 1);
  assert.equal(st.seenBids, 1);
  assert.equal(st.myBluffs, 0, '手里五个 6，看过之后报 6 个 6 不算虚报');
  assert.equal(st.bluffRate, 0);
  assert.equal(st.myBlinds, 0, '没宣言过盲——蒙报不等于盲侠');
});
