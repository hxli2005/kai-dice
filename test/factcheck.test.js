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

// 以下三条是校验器本身的单元测试。Q49 之后它的岗位从"拦他的嘴"改为
// "守系统栏位＋当观测尺子"——判据没变，用处变了。
test('校验器：报价序列的三种歪法都认得出', async () => {
  const m = await ladderMatch();
  const led = buildLedger(m.observe('B'));
  assert.deepEqual(checkFacts('你九个六都喊上了', led), [], '真发生过的价可以引');
  assert.match(checkFacts('你两次九个六，当我瞎', led)[0], /bid-count/);
  assert.deepEqual(checkFacts('你从三个四直接跳到九个六', led), [], '顺序对的不拦');
  assert.match(checkFacts('你先报九个六再报三个四', led)[0], /bid-order/);
  assert.match(checkFacts('你那口七个五呢', led)[0], /bid-not-in-history/, '没发生过的价＝编');
});

test('校验器：骰数与局号的越界都认得出', async () => {
  const m = await ladderMatch();
  const led = buildLedger(m.observe('B'));
  assert.deepEqual(checkFacts('这局你掉一颗骰', led), []);
  assert.match(checkFacts('这一局你掉了两颗骰', led)[0], /dice-loss/);
  assert.deepEqual(checkFacts('第 1 局的账', led), []);
  assert.match(checkFacts('第 9 局你就露怯了', led)[0], /round/, '还没打到的局不许引用');
});

test('校验器：手牌与内心永远不在它的管辖内（Q47/Q49）', async () => {
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
  // 自动掀盅只发生在扳不动盲闸的座位上——名册全员可扳，所以这里显式造一个
  const base = PERSONAS['model:deepseek-v4-flash'];
  const seat = { ...base, gear: { ...base.gear, usesBlind: false } };
  const ai = createOpponent({ persona: seat }); // 无通道＝沉默 bot
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

test('Q49 场合律：他把旧账记歪照样出口（台词侧解链），留档照留', async () => {
  const m = await ladderMatch();
  const ai = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    persona: { ...PERSONAS['model:deepseek-v4-flash'], gear: { ...PERSONAS['model:deepseek-v4-flash'].gear, usesBlind: false } }, // 自动掀盅要一个不扳盲闸的座位
    fetchFn: mockFetch(
      '{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"你两次九个六，开。","belief":"其实五五开","speechMode":"bait","note":"n"}',
    ),
  });
  const d = await ai.decide(m.observe('B'));
  assert.equal(d.action.type, 'challenge');
  assert.equal(d.say, '你两次九个六，开。', '记歪是他的活性，不是故障——不再拦');
  assert.equal(d.dropped, undefined, '不再有"被掐掉"这回事');
  // 留档降为素材而非判据，但一个字不少（小本子与揭诈要用）
  assert.equal(d.belief, '其实五五开');
  assert.equal(d.speechMode, 'bait');
  // 而校验器本身留着：它现在只给系统栏位与观测用（下一条测试就是它的岗位）
  assert.match(checkFacts(d.say, buildLedger(m.observe('B')))[0], /bid-count/);
});

test('Q49 系统场合零容忍：报告数据面的数字由引擎盖章，与台账逐条对得上', async () => {
  // 台词可以记歪，报告卡不行。数据面全部由 computeStats 从事件流复算——
  // 用户报的 bug①（10-9-8 被转写）与 bug②（掉一骰说成两颗）在这一层永远不许再现。
  const m = await ladderMatch();
  await m.act('B', { type: 'challenge' }); // 摊牌，产生一局结算
  const events = m.observe('A').events;
  const led = buildLedger(m.observe('A'));
  const st = computeStats(events, 'A', {});
  // 报价史：条数与内容与台账一致（A 报了 2 口）
  assert.equal(led.seq.length, 3);
  assert.equal(st.myBids, 2);
  // 掉骰：一局一颗，账面 diceCount 自证
  const re = events.findLast((e) => e.type === 'roundEnd');
  const lost = Object.values(re.diceCount).reduce((a, b) => a + b, 0);
  assert.equal(lost, 9, '十颗骰掉一颗');
  // 报告卡的数据面文本（引擎组装，不经模型）过一遍校验器：零违规
  const dataText =
    `${st.rounds} 局；虚报率 ${Math.round(st.bluffRate * 100)}%；` +
    `开牌 ${st.myChallenges} 次命中 ${st.myChallengeHits} 次；被开 ${st.timesChallenged} 次；` +
    `蒙报 ${st.blindBids} 口`;
  assert.deepEqual(checkFacts(dataText, led), [], `数据面不许出现台账里没有的数：${dataText}`);
});

test('F0b 留档字段：belief/speechMode 进 schema 与决策日志', async () => {
  const m = await ladderMatch();
  const ob = m.observe('B');
  const good = parseDecision(
    '{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"看死你了","belief":"其实只是五五开，钓他洗白","speechMode":"bait"}',
    ob,
  );
  assert.equal(good.speechMode, 'bait');
  assert.match(good.belief, /五五开/);
  const plain = parseDecision('{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"开"}', ob);
  assert.equal(plain.speechMode, 'straight');
  assert.equal(plain.belief, '');
});

// ---------- F0c 蒙报类目 ----------

const blindEvents = [
  { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
  // 故意不看骰，直接极限报价（用户实测：旧口径把他判成"虚报率 0% 老实人"）
  { type: 'bid', actor: 'A', count: 9, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 9, face: 6 }, actor: 'B', target: 'A',
    dice: { A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] }, zhai: false, stands: false, actual: 4, loser: 'A',
  },
  { type: 'roundEnd', round: 1, loser: 'A', winner: 'B', transfer: 2, mult: 1, chips: {}, diceCount: { A: 4, B: 5 } },
  { type: 'roundStart', round: 2, diceCount: { A: 4, B: 5 } },
  { type: 'bid', actor: 'A', count: 8, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 8, face: 6 }, actor: 'B', target: 'A',
    dice: { A: [1, 2, 3, 4], B: [1, 2, 3, 4, 5] }, zhai: false, stands: false, actual: 3, loser: 'A',
  },
  { type: 'roundEnd', round: 2, loser: 'A', winner: 'B', transfer: 2, mult: 1, chips: {}, diceCount: { A: 3, B: 5 } },
  { type: 'roundStart', round: 3, diceCount: { A: 3, B: 5 } },
  { type: 'bid', actor: 'A', count: 7, face: 6 },
  {
    type: 'reveal', bid: { player: 'A', count: 7, face: 6 }, actor: 'B', target: 'A',
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
    { type: 'bid', actor: 'A', count: 3, face: 6 }, // 蒙报
    { type: 'peek', actor: 'A' },
    { type: 'bid', actor: 'A', count: 6, face: 6 }, // 看过之后再报
  ];
  const st = computeStats(mixed, 'A', { 1: [6, 6, 6, 6, 6] });
  assert.equal(st.blindBids, 1);
  assert.equal(st.seenBids, 1);
  assert.equal(st.myBluffs, 0, '手里五个 6，看过之后报 6 个 6 不算虚报');
  assert.equal(st.bluffRate, 0);
  assert.equal(st.myBlinds, 0, '没宣言过盲——蒙报不等于盲侠');
});
