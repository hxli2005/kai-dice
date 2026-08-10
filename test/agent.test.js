import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { chat } from '../src/ai/llm.js';
import { buildPrompts, parseDecision, createOpponent } from '../src/ai/agent.js';
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
  assert.ok(!user.includes('只算骰面，不算人'), 'Q86：解释是非程序性的，只留数据');
  assert.match(system, /没拨算盘你手上就没有准数/, '这条是规则，留在规则区');
  // 对手侧：拨算盘是公开动作，必须进局面叙事
  const { user: userA } = buildPrompts(m.observe('A'), '');
  assert.match(userA, /对方当众拨了算盘/);
  // 本局限一次
  assert.ok(!ob.legal.some((a) => a.type === 'calc'), '算过就没得再算');
  await assert.rejects(() => m.act('B', { type: 'calc' }), /illegal calc/);
});

// Q89：官方名册上每个型号的工具全开（算盘可拨、盲闸可扳）——不再拿工具差异捏对手。
// 「不给算盘」这个**机制**仍然在（gear.calc='never'），只是名册上没人用它。
test('工具：名册上全员有算盘；calc=never 的座位仍然拿不到候选（机制未删）', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  for (const per of Object.values(PERSONAS))
    assert.match(buildPrompts(ob, '', per).user, /当众拨算盘（\{"type":"calc"\}）/, `${per.name} 应有算盘`);
  const noAbacus = { ...PERSONAS['model:deepseek-v4-flash'], gear: { calc: 'never', usesBlind: true } };
  const without = buildPrompts(ob, '', noAbacus).user;
  assert.ok(!without.includes('当众拨算盘（{"type":"calc"}）'), 'calc=never 仍然不给候选');
  for (const u of [buildPrompts(ob, '', PERSONAS['model:deepseek-v4-flash']).user, without])
    for (const gone of ['你习惯算', '你只在关键手才算', '你从不碰算盘'])
      assert.ok(!u.includes(gone), `Q86：算频染色「${gone}」是行为剧本，应已删`);
});

test('Q49 场合律：没算过却把"三成"说满，照样出口——嘴是他自己的（机制不变：他手上仍没有准数）', async () => {
  const m = await createMatch({ seed: 9 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const bragger = createOpponent({
    channel: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' },
    persona: { ...PERSONAS['model:deepseek-v4-flash'], gear: { ...PERSONAS['model:deepseek-v4-flash'].gear, usesBlind: true } },
    fetchFn: mockFetch(() => ({
      choices: [{ message: { content: '{"action":{"type":"challenge"},"say":"三成。开。","note":"我看他虚","belief":"其实没底"}' } }],
    })),
  });
  const d = await bragger.decide(m.observe('B'));
  assert.equal(d.say, '三成。开。', 'Q49：台词侧不再拦截');
  assert.equal(d.note, '我看他虚');
  assert.equal(d.belief, '其实没底', '留档照留——它是素材，不是判据');
  // 机制没松：他没拨算盘，提示词里给的仍然只是粗档手感
  const { user } = buildPrompts(m.observe('B'), '', PERSONAS['model:deepseek-v4-flash']);
  assert.match(user, /你没拨算盘，只有手感/);
  assert.ok(!/此话为真的概率 \d+%/.test(user));
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
  // Q86：回灌的是**数据**（自己刚做过什么），后面那句"必须接得上、不许自相矛盾"是要求，已删。
  // 嘴手是否一致交给渲染层（UI 本就单独显示报价），不写成对模型的请求。
  assert.ok(!user.includes('要么兑现'), '回灌只留数据，不留要求');
  const { system } = buildPrompts(ob, '');
  assert.ok(!system.includes('say 必须贴着'), 'Q86：嘴手一致条款已删');
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

// 提示词二准入（Q86，用户裁决 2026-08-10）：**只准装规则与操作 ＋ 数据**。
// 名字标签也删了——`narrate()` 对自己一律返回"你"，模型不需要知道自己叫什么。
// 于是化身、模型席、擂台席拿到的 system 完全逐字相同，无任何分支。
test('提示词二准入：全席 system 完全逐字相同，且只有规则/操作/输出格式', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  const model = { id: 'model:test-model', name: 'test-model', bare: true, gear: { calc: 'often', usesBlind: true } };
  const sysModel = buildPrompts(ob, '', model).system;
  const sysAvatar = buildPrompts(ob, '', PERSONAS['model:deepseek-v4-flash']).system;

  // 连替换名字这一步都不用了——本来就该一字不差
  assert.equal(sysAvatar, sysModel, '全席 system 必须完全相同');

  // 留下的只有三样：规则、动作/输出格式、（三人桌时）无队伍声明
  assert.match(sysModel, /至少有 N 个 X 点/, '规则');
  assert.match(sysModel, /引擎不校验报价真假/, '规则：报价无需为真');
  assert.match(sysModel, /没拨算盘你手上就没有准数/, '规则：Q45');
  assert.match(sysModel, /不合法的动作会被引擎打回/, '操作');
  assert.match(sysModel, /严格输出一行 JSON/, '输出格式');

  // 删干净的东西——任何一条回来都是偷塞人格（Q85/Q86）
  for (const gone of [
    '名字是',        // 身份标签
    '你自己的判断',  // 元人设："做你自己"
    '没有派给你的性格',
    '台词一两句',    // 风格约束（长度交给 max_tokens）
    '不作人身攻击',  // 内容底线（Q85 全删，出口侧也无过滤）
    '不提思考秒数',  // 说话纪律（管线已把毫秒转成现象语言）
    '读人只读',      // 教它怎么读人
    '信息边界',      // 三锁
    '真迹不可改',
    '铁律',
    'say 必须贴着',  // 嘴手一致（交给渲染层）
    '毛病', '记仇十年', '往死里嘲讽', '酒馆老板', '账房',
  ])
    assert.ok(!sysModel.includes(gone), `system 里不该还有「${gone}」`);
});
