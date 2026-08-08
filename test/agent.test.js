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
