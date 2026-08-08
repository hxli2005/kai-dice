import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { chat } from '../src/ai/llm.js';
import { buildPrompts, parseDecision, createOpponent, hasFakePrecision } from '../src/ai/agent.js';
import { PERSONAS } from '../src/ai/personas.js';

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
  // Q45：预注入的精确概率已退役——没拨算盘就只有粗档手感
  assert.match(user, /2 个 4」。你没拨算盘，只有手感：这话(基本稳|五五开|悬|纯扯)/);
  assert.match(user, /爱虚张/);
});

test('Q45 算盘：拨过才给准数，且"算"进得了叙事（何时算＝新 tell）', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  await m.act('B', { type: 'calc' });
  const ob = m.observe('B');
  const { user, system } = buildPrompts(ob, '');
  assert.match(user, /你这局拨过算盘：按你的骰子算，此话为真的概率 \d+%/);
  assert.match(user, /只算骰面，不算人/);
  assert.match(system, /没当众拨过算盘，就不许说出任何精确概率/);
  // 对手侧：拨算盘是公开动作，必须进局面叙事
  const { user: userA } = buildPrompts(m.observe('A'), '');
  assert.match(userA, /对方当众拨了算盘/);
  // 本局限一次
  assert.ok(!ob.legal.some((a) => a.type === 'calc'), '算过就没得再算');
  await assert.rejects(() => m.act('B', { type: 'calc' }), /illegal calc/);
});

test('Q45 算频：老李头常算给候选、阿飞从不碰算盘（身份锚点）', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  const often = buildPrompts(ob, '', PERSONAS.laolitou).user;
  assert.match(often, /当众拨算盘（\{"type":"calc"\}）/);
  assert.match(often, /你习惯算/);
  const never = buildPrompts(ob, '', PERSONAS.afei).user;
  assert.ok(!never.includes('当众拨算盘（{"type":"calc"}）'), '阿飞不给算的候选');
  assert.match(never, /你从不碰算盘/);
});

test('Q45 引用校验：没算过就报准数＝编，当场掐掉；档案里给过的数照引不误', async () => {
  const m = await createMatch({ seed: 9 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  // 未算却报出准数 → say/note 被掐掉
  const liar = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    persona: { ...PERSONAS.laolitou, gear: { ...PERSONAS.laolitou.gear, usesBlind: true } },
    fetchFn: mockFetch(() => ({
      choices: [{ message: { content: '{"action":{"type":"challenge"},"say":"三成。开。","note":"只有 12% 真"}' } }],
    })),
  });
  const d = await liar.decide(m.observe('B'));
  assert.equal(d.action.type, 'challenge');
  assert.equal(d.say, '');
  assert.equal(d.note, '');
  assert.match(d.dropped ?? '', /say/);
  // 档案里发给他的数字（虚报率 43%）不算编——引用校验只掐凭空长出来的数
  assert.equal(hasFakePrecision('你虚报率 43%，还敢报', '上一场客人虚报率43%，开牌2次'), false);
  assert.equal(hasFakePrecision('这话 87% 真', '上一场客人虚报率43%'), true);
  assert.equal(hasFakePrecision('这话很悬，我不接', ''), false, '粗话免检');
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
    persona: { ...(({ id: 'laolitou' }) ), name: '测', identity: '测。', tone: 'mild', style: '', flaws: '', gear: { calc: 'often', usesBlind: true }, strategy: {} },
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
  const bare = { id: 'model:test-model', name: 'test-model', bare: true, gear: { calc: 'often', usesBlind: true } };
  const { system } = buildPrompts(ob, '', bare);
  assert.match(system, /以本名上桌/);
  assert.match(system, /test-model/);
  assert.match(system, /禁止编造数字/); // 红线不脱
  assert.match(system, /规则提要/);
  assert.match(system, /严格输出一行 JSON/);
  assert.ok(!system.includes('毛病')); // 无性格缺陷剧本
});
