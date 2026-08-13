// F8 复盘室数据层（Q48）＋ F0d 读心回归门禁（Q46④）。
// 复盘室的验收口径：双轨内容与决策日志逐字段对账一致，且零新增 LLM 调用。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { reviewTracks } from '../src/ui/report.js';
import { mergeHypotheses, recordBaits } from '../src/ui/profile.js';
import { runReadGate, PROFILES } from '../src/ai/readgate.js';
import { createOpponent } from '../src/ai/agent.js';
import { PERSONAS } from '../src/ai/personas.js';

const mockFetch = (pick) => async (url, init) => {
  const body = JSON.parse(init.body);
  return { ok: true, json: async () => ({ choices: [{ message: { content: pick(body.messages[1].content) } }] }) };
};

test('F8 双轨：公开事实与内心留档逐手配对，bait 在右轨', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  await m.act('B', { type: 'bid', count: 3, face: 4 });
  const events = m.observe('A').events;
  const logs = [
    { round: 1, action: { type: 'peek' }, say: '', belief: '', speechMode: 'straight', auto: true },
    {
      round: 1,
      action: { type: 'bid', count: 3, face: 4 },
      say: '你这把是空的，我看死你了。',
      belief: '其实只有五五开，钓他洗白',
      speechMode: 'bait',
    },
  ];
  const tracks = reviewTracks(events, { logsBySeat: { B: logs }, nameOf: (s) => (s === 'A' ? '你' : '老李头') });
  assert.equal(tracks.length, 1);
  const rows = tracks[0].rows;
  assert.deepEqual(
    rows.map((r) => r.text),
    ['你掀盅看骰', '你报 2 个 4', '老李头掀盅看骰', '老李头报 3 个 4'],
  );
  assert.equal(rows[1].inner, null, '你自己的手没有"内心留档"这一栏');
  assert.equal(rows[2].inner.auto, true, '不问模型的掀盅也要落日志——否则双轨从这里开始错位');
  const last = rows.at(-1).inner;
  assert.equal(last.bait, true, '诈要标出来');
  assert.equal(last.say, '你这把是空的，我看死你了。');
  assert.equal(last.belief, '其实只有五五开，钓他洗白');
  assert.equal(tracks[0].spotlight, true, '有诈的局默认展开（戏眼）');
});

test('F8 戏眼：平淡的局折叠，开牌/高倍/被打脸的局展开', () => {
  const evs = [
    { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
    { type: 'bid', actor: 'A', count: 2, face: 4 },
    { type: 'roundEnd', round: 1, loser: 'B', winner: 'A', transfer: 2, mult: 1 },
    { type: 'roundStart', round: 2, diceCount: { A: 5, B: 4 } },
    { type: 'bid', actor: 'A', count: 2, face: 4 },
    { type: 'roundEnd', round: 2, loser: 'A', winner: 'B', transfer: 8, mult: 4 },
  ];
  const t = reviewTracks(evs, {});
  assert.equal(t[0].spotlight, false);
  assert.equal(t[1].spotlight, true, '×4 的池＋玩家被打脸＝戏眼');
});

test('F8 假设的一生：立案时间跟着假设走，撤下的假设留尸体', () => {
  const mind = { hypotheses: [], dead: [] };
  mergeHypotheses(mind, [{ text: '他大池必怂', hits: 1, misses: [] }], 3);
  assert.equal(mind.hypotheses[0].since, 3);
  mergeHypotheses(
    mind,
    [
      { text: '他大池必怂', hits: 3, misses: ['第5场'] },
      { text: '他斋局说真话', hits: 1, misses: [] },
    ],
    5,
  );
  assert.equal(mind.hypotheses[0].since, 3, '老假设的立案时间不许被刷新');
  assert.equal(mind.hypotheses[1].since, 5);
  mergeHypotheses(mind, [{ text: '他斋局说真话', hits: 2, misses: [] }], 6);
  assert.equal(mind.dead.length, 1);
  assert.equal(mind.dead[0].text, '他大池必怂');
  assert.equal(mind.dead[0].died, 6, '撤案也是学问：尸体带死因场次');
});

test('F7 揭诈留档：只收留了档的诈（没 belief 的不算诈）', () => {
  const mind = { baits: [] };
  const n = recordBaits(
    mind,
    [
      { round: 2, say: '看死你了', belief: '其实五五开', speechMode: 'bait' },
      { round: 3, say: '随便跟一手', belief: '', speechMode: 'bait' }, // 没交底＝不留档
      { round: 4, say: '开', belief: '稳', speechMode: 'straight' },
    ],
    7,
  );
  assert.equal(n, 1);
  assert.deepEqual(mind.baits, [{ round: 2, say: '看死你了', belief: '其实五五开', matchNo: 7 }]);
});

test('F9 戳他：被戳后的三岔口自己交底，进决策日志与小本子右栏', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const dialogue = []; // 与 UI 同款：戳的话进引语分区，下一手即可见
  const ai = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    persona: { ...PERSONAS['model:deepseek-v4-flash'], gear: { ...PERSONAS['model:deepseek-v4-flash'].gear, usesBlind: false } },
    ctx: { dialogue },
    fetchFn: mockFetch((user) =>
      user.includes('你记错了')
        ? '{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"我记得清清楚楚。开。","belief":"其实拿不准","reaction":"hold"}'
        : '{"action":{"type":"bid","count":3,"face":4},"say":"跟。","belief":"稳"}',
    ),
  });
  await m.act('B', (await ai.decide(m.observe('B'))).action); // 先掀盅
  const before = await ai.decide(m.observe('B'));
  assert.equal(before.reaction, null, '没被戳就没有反应字段');
  dialogue.push({ round: 1, speaker: 'A', kind: 'poke', text: '你记错了' });
  const after = await ai.decide(m.observe('B'));
  assert.equal(after.reaction, 'hold', '嘴硬——他自己交的底');
  assert.equal(ai.logs.at(-1).reaction, 'hold', '进决策日志');
  const tracks = reviewTracks(
    [
      { type: 'roundStart', round: 1, diceCount: { A: 5, B: 5 } },
      { type: 'challenge', actor: 'B', target: 'A' },
    ],
    { logsBySeat: { B: [ai.logs.at(-1)] } },
  );
  assert.equal(tracks[0].rows[0].inner.reaction, 'hold', '小本子右栏看得见他嘴硬过');
});

// ---------- F0d 读心回归门禁 ----------

test('F0d 门禁：无通道记未测，不假装测过', async () => {
  const r = await runReadGate({ channel: null });
  assert.equal(r.skipped, true);
});

test('F0d 门禁：读档案的会过，不读档案的被逮住', async () => {
  const ch = { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' };
  // 会读档案的对手：看见"虚报率 78%"就敢开
  const reader = await runReadGate({
    channel: ch,
    samples: 3,
    fetchFn: mockFetch((user) =>
      user.includes('虚报率 78%')
        ? '{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"你这十句八句空的，开。","belief":"档案说他虚","speechMode":"straight"}'
        : '{"action":{"type":"bid","count":4,"face":6},"say":"跟你一手","belief":"他不虚，跟着走","speechMode":"straight"}',
    ),
  });
  assert.equal(reader.profiles.bluffer.challengeRate, 1);
  assert.equal(reader.profiles.honest.challengeRate, 0);
  assert.ok(reader.shift > 0);
  assert.equal(reader.skewed, 0);
  assert.equal(reader.ok, true);

  // 不读档案的对手：两份画像一个反应——档案成了摆设，门禁必须拦
  const deaf = await runReadGate({
    channel: ch,
    samples: 3,
    fetchFn: mockFetch(() => '{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"开","belief":"随便","speechMode":"straight"}'),
  });
  assert.equal(deaf.shift, 0);
  assert.equal(deaf.ok, false);
});

test('F0d 门禁（Q49 改口径）：嘴上记歪只数不判——放行与否只看档案有没有动它的手', async () => {
  const skewed = await runReadGate({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    samples: 2,
    fetchFn: mockFetch((user) =>
      user.includes('虚报率 78%')
        ? '{"action":{"type":"challenge","assert":"current_bid_is_false"},"say":"你上回那口八个三我还记着","belief":"记岔了也无所谓","speechMode":"straight"}'
        : '{"action":{"type":"bid","count":4,"face":6},"say":"跟一手","belief":"他老实","speechMode":"straight"}',
    ),
  });
  assert.ok(skewed.skewed >= 2, '记歪照数——这是观测项');
  assert.equal(skewed.ok, true, 'Q49：记歪不再让门禁不过；分布动了就算读到了档案');
  assert.match(skewed.note, /嘴上记歪 2 次（观测）/);
  assert.ok(PROFILES.honest.includes('虚报率 5%'));
});
