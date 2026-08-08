import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { chat } from '../src/ai/llm.js';
import { buildPrompts, parseDecision, createOpponent } from '../src/ai/agent.js';

const mockFetch = (handler) => async (url, init) => {
  const body = JSON.parse(init.body);
  return { ok: true, json: async () => handler(url, init.headers, body) };
};

test('llm.chat：OpenAI 与 Anthropic 两种格式的请求与解析', async () => {
  const seen = [];
  const openai = mockFetch((url, headers, body) => {
    seen.push({ url, auth: headers.authorization, model: body.model });
    return { choices: [{ message: { content: 'hi' } }] };
  });
  const t1 = await chat(
    { baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' },
    { system: 's', user: 'u' },
    openai,
  );
  assert.equal(t1, 'hi');
  assert.deepEqual(seen[0], { url: 'https://x.test/v1/chat/completions', auth: 'Bearer k', model: 'm' });

  const anthropic = mockFetch((url, headers, body) => {
    seen.push({ url, key: headers['x-api-key'], sys: body.system });
    return { content: [{ text: 'yo' }] };
  });
  const t2 = await chat(
    { baseUrl: 'https://a.test', apiKey: 'k2', model: 'm2', format: 'anthropic' },
    { system: 's', user: 'u' },
    anthropic,
  );
  assert.equal(t2, 'yo');
  assert.deepEqual(seen[1], { url: 'https://a.test/v1/messages', key: 'k2', sys: 's' });
});

test('buildPrompts：注入真实骰面、概率与本局叙事', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 }, { elapsedMs: 9200 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  const { user } = buildPrompts(ob, '爱虚张');
  assert.match(user, new RegExp(`\\[${ob.yourDice.join(', ')}\\]`));
  // Q15 证据分级：极端犹豫只给现象学标注，秒数不进提示词
  assert.match(user, /对方报 2 个 4（这手前停了很久）/);
  assert.ok(!/用时|\d秒/.test(user));
  assert.match(user, /2 个 4」。按你的骰子算，此话为真的概率 \d+%/);
  assert.match(user, /爱虚张/);
});

test('parseDecision：合法动作通过，非法与坏输出拒绝', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  const good = parseDecision('{"action":{"type":"bid","count":2,"face":5},"say":"跟。","note":"n"}', ob);
  assert.deepEqual(good.action, { type: 'bid', count: 2, face: 5 });
  assert.ok(parseDecision('前缀 {"action":{"type":"challenge"},"say":"开"} 后缀', ob));
  assert.equal(parseDecision('{"action":{"type":"bid","count":2,"face":3}}', ob), null); // 阶梯外
  assert.equal(parseDecision('{"action":{"type":"declare","declaration":"zhai"}}', ob), null); // 非首报者
  assert.equal(parseDecision('胡言乱语', ob), null);
});

test('createOpponent：LLM 垃圾输出与无通道时降级沉默模式，日志可审计', async () => {
  const m = await createMatch({ seed: 9 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const garbage = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    fetchFn: mockFetch(() => ({ choices: [{ message: { content: '???' } }] })),
  });
  let d = await garbage.decide(m.observe('B')); // 未看骰 → 先 peek
  assert.deepEqual(d.action, { type: 'peek' });
  await m.act('B', d.action);
  d = await garbage.decide(m.observe('B'));
  assert.ok(['bid', 'challenge'].includes(d.action.type));
  assert.equal(garbage.logs.at(-1).silentFallback, true);
  assert.equal(garbage.logs.at(-1).raw, '???');

  const noChannel = createOpponent({});
  const d2 = await noChannel.decide(m.observe('B'));
  assert.ok(['bid', 'challenge'].includes(d2.action.type));
  assert.equal(noChannel.logs.at(-1).silentFallback, true);
});

test('自我记忆回灌：同局自己的宣言/台词/心思进下一手提示词，跨调用嘴手不断裂', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'declare', declaration: 'zhai' });
  const ob = m.observe('A');
  const { user } = buildPrompts(ob, '', undefined, {
    ownLog: [{ action: { type: 'declare', declaration: 'zhai' }, say: '斋。两个6等着。', note: '装强，钓他开' }],
  });
  assert.match(user, /你自己这局刚做过：宣言了「斋」/);
  assert.match(user, /嘴上说的是「斋。两个6等着。」/);
  assert.match(user, /当时心思：装强，钓他开/);
  assert.match(user, /要么兑现，要么是你有意在诈/);
  // 输出契约里有嘴手绑定铁律
  const { system } = buildPrompts(ob, '');
  assert.match(system, /say 必须贴着你此刻的 action 说/);
});

test('createOpponent：决策日志自动回灌——第二手调用的提示词含第一手的台词', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const prompts = [];
  const ai = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    fetchFn: mockFetch((url, h, body) => {
      prompts.push(body.messages[1].content);
      return { choices: [{ message: { content: '{"action":{"type":"declare","declaration":"raise"},"say":"抬了，跑不了","note":"先把池做大"}' } }] };
    }),
    persona: { ...(({ id: 'laolitou' }) ), name: '测', identity: '测。', tone: 'mild', style: '', flaws: '', gear: { probInject: 'full', usesBlind: true }, strategy: {} },
  });
  await m.act('B', { type: 'peek' });
  const d1 = await ai.decide(m.observe('B'));
  assert.equal(d1.action.type, 'declare');
  await m.act('B', d1.action);
  await ai.decide(m.observe('B')); // 同局第二手
  assert.ok(!prompts[0].includes('你自己这局刚做过'), '首手无自我记忆');
  assert.match(prompts[1], /你自己这局刚做过：宣言了「抬」，嘴上说的是「抬了，跑不了」（当时心思：先把池做大）/);
});

test('Q28 素颜客席：无人设剧本、保留事实红线与规矩', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  const bare = { id: 'model:test-model', name: 'test-model', bare: true, gear: { probInject: 'full', usesBlind: true } };
  const { system } = buildPrompts(ob, '', bare);
  assert.match(system, /以本名上桌/);
  assert.match(system, /test-model/);
  assert.match(system, /禁止编造数字/); // 红线不脱
  assert.match(system, /规则提要/);
  assert.match(system, /严格输出一行 JSON/);
  assert.ok(!system.includes('毛病')); // 无性格缺陷剧本
});
