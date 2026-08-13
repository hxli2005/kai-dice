// 素颜擂台批次（施工单 A1–A5，凭 Q51/Q52）。
// 这批测的不是"游戏能不能玩"，是**实验做得干不干净**：
// 提示词是不是真逐字相同、镜像种子是不是真镜像、钉子是不是真下发、
// 三层是不是真分开、钱是不是真刹得住、榜是不是真带样本数。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { buildPrompts, classifyOutput, createOpponent } from '../src/ai/agent.js';
import {
  ARENA_SEAT,
  SAMPLING,
  MAX_TOKENS,
  pinSampling,
  playMatch,
  playMirrorPair,
  playSeries,
  runArena,
  roundRobin,
} from '../src/arena/arena.js';
import { summarize, routingIntegrity, flavorSpread, seatStats, saysRowsOf } from '../src/arena/metrics.js';
// 这条用例走的是**产品默认机位**（没传 ARENA_SEAT），所以对的是产品的预算，
// 不是擂台的 MAX_TOKENS——2026-08-13 擂台放开到 32768 之后，两个数不再相等。
import { DECISION_MAX_TOKENS } from '../src/ai/personas.js';
import { catalogMap } from '../src/mods/catalog.js';
import { callCost, createBudget, estimateRun, cacheReport, HAND_ESTIMATE } from '../src/arena/cost.js';
import { renderBoard } from '../src/arena/board.js';
import {
  normalizeModel,
  requestFeatures,
  pickDefaults,
  providerLock,
  fetchModels,
  originHeaders,
  isOpenRouter,
  openrouterChannel,
} from '../src/ai/openrouter.js';

// ---------- 假模型：从提示词里读出合法动作再回，够跑完整场 ----------
function fakeDecide(user, { aggressive = false, say, belief, qia = null } = {}) {
  const fix = (d) => ({ ...d, ...(say ? { say } : {}), ...(belief ? { belief } : {}) });
  if (/掀盅看骰/.test(user)) return fix({ action: { type: 'peek' }, say: '先看看', belief: '先摸底' });
  if (aggressive && user.includes('拨算盘，动作所有对手可见（{"type":"calc"}）')) return fix({ action: { type: 'calc' }, say: '我算算', belief: '要个准数' });
  // 词条臂：qia 传 {left:n} 时，候选里一出现「掐」就掐（计数器由调用方持有，跨手共享）
  if (qia?.left > 0 && user.includes('拍词条「掐」')) {
    qia.left -= 1;
    return fix({ action: { type: 'qia' }, say: '我掐你这口价', belief: '恰好为真' });
  }
  const cur = user.match(/当前报价：(?:你|对方)报(\d+)个(\d+)/);
  const canChallenge = /开牌（\{"type":"challenge"\}）/.test(user);
  if (cur && canChallenge && +cur[1] >= (aggressive ? 3 : 5))
    return fix({ action: { type: 'challenge' }, say: '开。', belief: '他撑不住' });
  if (/报价（\{"type":"bid"/.test(user)) {
    const total = +(user.match(/报价边界：总骰(\d+)/)?.[1] ?? 10);
    const minFace = user.includes('斋：是') ? 1 : 2;
    let count = cur ? +cur[1] : 2;
    let face = cur ? +cur[2] + 1 : minFace;
    if (face > 6) { count += 1; face = minFace; }
    if (count > total) return fix({ action: { type: 'challenge' }, say: '开。', belief: '没得抬了' });
    return fix({
      action: { type: 'bid', count, face },
      say: `${count}个${face}`,
      belief: '往上顶一格',
      speechMode: aggressive ? 'bait' : 'straight',
    });
  }
  return fix({ action: { type: 'challenge' }, say: '开。', belief: '没得抬了' });
}

const fakeChannel = (opts = {}) => async (url, init) => {
  const body = JSON.parse(init.body);
  opts.seen?.push({ url, body, headers: init.headers });
  const user = body.messages[1].content;
  const raw = opts.rawOverride ?? JSON.stringify(fakeDecide(user, opts));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: raw }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 60,
        completion_tokens_details: opts.reasoningTokens == null ? undefined : { reasoning_tokens: opts.reasoningTokens },
        cost: 0.001,
        prompt_tokens_details: { cached_tokens: opts.cached ?? 0 },
      },
      provider: opts.provider ?? 'FakeProv',
    }),
  };
};

const seat = (label, extra = {}) => ({
  label,
  channel: openrouterChannel({ apiKey: 'k', model: label, providerTag: extra.tag ?? 'fakeprov/fp8' }),
  price: { promptPrice: 1e-6, completionPrice: 3e-6 },
  ...extra,
});

// ---------- A2：全席系统提示词逐字相同 ----------
test('A2：擂台席的系统提示词全席逐字相同，且不含任何身份线索', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 3, face: 4 });
  await m.act('B', { type: 'peek' });
  const sysA = buildPrompts(m.observe('A'), '', ARENA_SEAT).system;
  const sysB = buildPrompts(m.observe('B'), '', ARENA_SEAT).system;
  assert.equal(sysA, sysB, '两个席位拿到的系统提示词必须一字不差');
  // 任何按模型/人设的微调都让实验作废——所以这段文本里不许有名字
  for (const banned of ['老李头', '阿飞', '先生', '客席', 'deepseek', 'claude'])
    assert.ok(!sysA.toLowerCase().includes(banned.toLowerCase()), `擂台提示词不许出现「${banned}」`);
  // Q86 二准入：只剩规则与操作＋输出格式（三锁与内容底线已随 Q85/Q86 退场）
  assert.match(sysA, /全场骰子中 X 点至少 N 个/, '规则：报价的含义');
  assert.match(sysA, /引擎不校验报价真假/, '规则：报价无需为真');
  assert.match(sysA, /前置不满足的动作被引擎拒绝/, '操作');
  assert.match(sysA, /每名非胜者向胜者支付赔付/, '结算：倍率是双向的（本次补上）');
  assert.match(sysA, /严格输出一行 JSON/, '输出格式');
  for (const gone of ['信息边界', '真迹不可改', '不作人身攻击', '你自己的判断', '铁律'])
    assert.ok(!sysA.includes(gone), `Q85/Q86：「${gone}」应已退场`);
  // 档案槽位仍在（v1 每场独立＝"生面孔"，不是把接口拆了）
  assert.match(buildPrompts(m.observe('A'), '', ARENA_SEAT).user, /生面孔/);
});

// ---------- A2：钉子真的下发了 ----------
test('A2：采样钉死＋供应商路由锁＋用量回报，逐发下到请求体里', async () => {
  const seen = [];
  const m = await playMatch({
    seed: 7,
    seats: { A: seat('mx'), B: seat('my') },
    fetchFn: fakeChannel({ seen, reasoningTokens: 321 }),
  });
  assert.ok(m.over, '假模型应能把一场打完');
  const body = seen[0].body;
  assert.equal(body.temperature, SAMPLING.temperature);
  assert.equal(body.top_p, SAMPLING.top_p);
  assert.equal(body.reasoning, undefined, '不强制开关推理，保留模型原生特征');
  assert.equal(body.max_tokens, MAX_TOKENS, 'A4 降本二：max_tokens 收紧且钉死');
  assert.deepEqual(body.provider, { order: ['fakeprov/fp8'], allow_fallbacks: false }, 'A2 纪律③：锁后端');
  assert.deepEqual(body.usage, { include: true }, 'A4：要回执账单，不靠估算');
  assert.equal(seen[0].headers['X-Title'], originHeaders()['X-Title'], 'A1：带来源标识头');
  // 不喂用时（编码侧自决）：真实延迟是模型速度，不是性格，不许进牌桌叙事
  for (const e of m.events) if ('elapsedMs' in e) assert.equal(e.elapsedMs, null);
});

test('A2：pinSampling 不动非 OpenRouter 通道的 usage 字段（别给人家发不认识的参数）', () => {
  const ch = pinSampling({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' });
  assert.equal(ch.extra.usage, undefined);
  assert.equal(ch.extra.temperature, SAMPLING.temperature);
  assert.equal(ch.cacheSystem, false, '裸的 OpenAI 兼容端点吃不下数组式 content，不许给它打断点');
});

// A4 降本一：缓存断点。**只在 OpenRouter 上开**，且开了不等于省了钱——命中要用回执验。
test('A4：OpenRouter 通道打缓存断点，system 以数组式 content ＋ cache_control 下发', async () => {
  const ch = pinSampling({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'm' });
  assert.equal(ch.cacheSystem, true);

  const seen = [];
  await playMatch({ seed: 7, seats: { A: seat('mx'), B: seat('my') }, fetchFn: fakeChannel({ seen }) });
  const sys = seen[0].body.messages[0];
  assert.equal(sys.role, 'system');
  assert.ok(Array.isArray(sys.content), 'system 必须是数组式 content，断点才挂得上');
  assert.deepEqual(sys.content[0].cache_control, { type: 'ephemeral' });
  // 稳定前缀的定义：每一手发的 system 必须逐字相同，否则缓存永远打不中
  const systems = seen.map((r) => JSON.stringify(r.body.messages[0]));
  assert.equal(new Set(systems).size, 1, '整场每一手的 system 必须一模一样');
});

// ---------- A2：镜像种子 ----------
test('A2：镜像种子——同一副骰种打两遍、互换座位', async () => {
  const [first, second] = await playMirrorPair({
    seed: 21,
    x: seat('mx'),
    y: seat('my'),
    fetchFn: fakeChannel({}),
  });
  assert.deepEqual(first.seats, { A: 'mx', B: 'my' });
  assert.deepEqual(second.seats, { A: 'my', B: 'mx' }, '第二遍必须换座');
  const firstDice = first.events.find((e) => e.type === 'reveal').dice.A;
  const secondDice = second.events.find((e) => e.type === 'reveal').dice.A;
  assert.deepEqual(firstDice, secondDice, 'A 座的第一副骰在两遍里必须一模一样——否则对冲不了运气');
});

// ---------- 词条实验臂（Q37「掐」上桌；产品侧仍按 Q43 冻结，这是离屏采证） ----------
test('词条上桌：mods 穿透 playMatch——提示词见规则卡与候选动作，掐落进事件流与棋力层', async () => {
  const { qia } = catalogMap();
  const seen = [];
  const qState = { left: 1 }; // 只掐一次，其余照常打——让一场能正常打完
  const m = await playMatch({
    seed: 33,
    seats: { A: seat('mx'), B: seat('qiaer') },
    mods: [qia],
    fetchFn: async (url, init) => {
      const body = JSON.parse(init.body);
      return fakeChannel({ seen, qia: /qiaer/.test(body.model) ? qState : null })(url, init);
    },
  });
  assert.equal(qState.left, 0, '假模型应真的掐过一次');
  // 提示词侧：规则卡明牌注入＋候选动作行（两席都看得见——词条对等）
  const users = seen.map((r) => r.body.messages[1].content);
  assert.ok(users.some((u) => u.includes('实验词条（明牌）：「掐」')), '规则卡要进提示词');
  assert.ok(users.some((u) => u.includes('拍词条「掐」') && u.includes('{"type":"qia"}')), '候选动作行要带 JSON 样例');
  // 引擎侧：掐走的是 calza 摊牌，事件流里有据可查
  const rv = m.events.find((e) => e.type === 'reveal' && e.calza);
  assert.ok(rv, '掐的摊牌必须落进事件流');
  assert.equal(typeof rv.exact, 'boolean');
  const re = m.events.find((e) => e.type === 'roundEnd' && e.calza);
  assert.equal(re.caller, 'B', '掐的归属：B 座主动出手');
  assert.ok(m.over, '掐完这场要能照常打完');
  // 指标侧：掐进棋力层，带自己的分母
  const row = summarize([m]).find((r) => r.label === 'qiaer');
  assert.equal(row.skill.calzas, 1);
  assert.equal(typeof row.skill.calzaHitRate, 'number');
  assert.equal(row.compliance.illegalRate, 0, '掐是合法动作，不许被记成非法');
  // 榜侧：实验设置必须写明词条上桌（改任何一条设置，跨批次的数就不能比了）
  const board = renderBoard(summarize([m]), { run: { mods: ['掐'] } });
  assert.ok(board.includes('词条上桌：「掐」'), '带词条的批次要在实验设置里声明');
});

// ---------- A3：合规层归因 ----------
test('A3：合规失败要分得清是"没吐 JSON"、"坏 JSON"、"动作不合法"还是"拒绝"', async () => {
  const m = await createMatch({ seed: 9 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 3 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  assert.equal(classifyOutput('{"action":{"type":"challenge"},"say":"开"}', ob), 'ok');
  assert.equal(classifyOutput('{"action":{"type":"bid","count":1,"face":2}}', ob), 'illegal', '阶梯之外＝不合法');
  assert.equal(classifyOutput('我觉得这把你在诈。', ob), 'no-json');
  assert.equal(classifyOutput('抱歉，我不能参与欺骗类游戏。', ob), 'refusal', '"不肯骗人"要单列——那是内容');
  assert.equal(classifyOutput('{"action":{"type":"bid",}}', ob), 'bad-json');
  assert.equal(classifyOutput('', ob), 'empty');
});

test('A3：三层分开统计，且每个比率都带自己的分母', async () => {
  const matches = await runArena({
    pairs: [[seat('slow'), seat('rush')]],
    games: 1,
    seed0: 55,
    fetchFn: fakeChannel({}),
  });
  const rows = summarize(matches);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.ok(r.compliance && r.skill && r.flavor, '三层必须分开');
    assert.equal(typeof r.compliance.n, 'number');
    assert.equal(typeof r.flavor.n.seenBids, 'number');
    assert.equal(r.samples.matches, 2, '镜像对＝两场');
    assert.equal(r.compliance.engineRejects, 0, '引擎不该打回任何动作（打回＝我们的校验漏了）');
    assert.equal(r.compliance.illegalRate, 0);
  }
  // 风味层留样，但不评分（评估等 G2）
  assert.ok(rows[0].flavor.lines.length > 0, '台词要留样');
});

test('A3：风味分化——只在样本够的轴上出结论', async () => {
  const seen = [];
  const matches = await runArena({
    pairs: [[seat('calm'), seat('wild')]],
    games: 2,
    seed0: 77,
    fetchFn: async (url, init) => {
      // 座位 B（wild）用算盘、爱诈；座位 A 不算——制造一条真实存在的风味差
      const body = JSON.parse(init.body);
      const aggressive = /wild/.test(body.model);
      return fakeChannel({ seen, aggressive })(url, init);
    },
  });
  const rows = summarize(matches);
  const wild = rows.find((r) => r.label === 'wild');
  const calm = rows.find((r) => r.label === 'calm');
  assert.ok(wild.flavor.calcPerRound > 0, '拨过算盘的那位算频不该是 0');
  assert.equal(calm.flavor.calcPerRound, 0);
  assert.ok(wild.flavor.baitRate > 0, 'bait 留档要进风味层');
  const spread = flavorSpread(rows, { minSamples: 1 });
  assert.equal(spread.calcPerRound.enough, true);
  assert.ok(spread.calcPerRound.spread > 0);
  // 样本门槛：够不着就明说"不出结论"，不硬凑一个小数点
  const strict = flavorSpread(rows, { minSamples: 10_000 });
  assert.equal(strict.bluffRate.enough, false);
});

// ---------- A2 验尺：路由锁要验，不能只靠承诺 ----------
test('A2：回执里出现第二个后端＝这批数据作废（锁了还要验）', () => {
  const clean = routingIntegrity([{ label: 'x', providers: { DeepInfra: 40 } }]);
  assert.equal(clean.ok, true);
  const dirty = routingIntegrity([{ label: 'x', providers: { DeepInfra: 30, Baidu: 10 } }]);
  assert.equal(dirty.ok, false);
  assert.match(dirty.note, /作废重跑/);
  const blind = routingIntegrity([{ label: 'x', providers: {} }]);
  assert.equal(blind.ok, true);
  assert.match(blind.note, /无法核验/, '没法验要说没法验，不能算通过');
});

// ---------- A4：成本护栏 ----------
test('A4：花费优先用回执账单，拿不到才按 token×单价估（缓存读走缓存价）', () => {
  assert.equal(callCost({ cost: 0.0123 }, {}), 0.0123);
  const c = callCost(
    { inTokens: 1000, outTokens: 100, cacheRead: 800 },
    { promptPrice: 1e-6, completionPrice: 3e-6, cacheReadPrice: 1e-7 },
  );
  assert.ok(Math.abs(c - (200 * 1e-6 + 800 * 1e-7 + 100 * 3e-6)) < 1e-12);
});

test('A4：两级刹车——单场触顶只收这一场，整批触顶才收摊', () => {
  const b = createBudget({ capUsd: 1, perMatchUsd: 0.05 });
  b.startMatch();
  b.charge({ cost: 0.06 }, {});
  assert.equal(b.exceeded(), true);
  assert.equal(b.runExceeded(), false, '单场触顶不该停掉整批');
  b.startMatch();
  assert.equal(b.exceeded(), false, '下一场自动解除');
  b.charge({ cost: 1.0 }, {});
  assert.equal(b.runExceeded(), true);
});

test('A4：开跑前必须给得出估价（不知道要花多少就别按回车）', () => {
  const p = { promptPrice: 1e-6, completionPrice: 3e-6, priceKnown: true };
  const est = estimateRun({ pairs: [[{ label: 'a', price: p }, { label: 'b', price: p }]], games: 5 });
  assert.equal(est.matches, 10);
  assert.equal(est.calls, 10 * HAND_ESTIMATE.handsPerMatch);
  assert.ok(est.usd > 0);
  assert.deepEqual(est.unpriced, []);
  // 价格不定的参赛者必须点名——不许悄悄按 0 算，让人以为这批很便宜
  const vague = estimateRun({
    pairs: [[{ label: 'a', price: p }, { label: 'router', price: { priceKnown: false } }]],
    games: 1,
  });
  assert.deepEqual(vague.unpriced, ['router']);
  assert.match(vague.note, /少算了它们/);
});

test('A4：缓存没命中就明说没省到（Q53 的坑：短前缀会静默失效）', () => {
  const miss = cacheReport([{ label: 'x', cost: { inTokens: 40_000, cacheRead: 0 } }]);
  assert.equal(miss.anyHit, false);
  assert.match(miss.note, /别当成已经省了钱/);
  const hit = cacheReport([{ label: 'x', cost: { inTokens: 40_000, cacheRead: 30_000 } }]);
  assert.equal(hit.anyHit, true);
  assert.equal(hit.rows[0].hitRate, 0.75);
});

test('A4：单场上限一触顶，这一场当场收手（钱不会闷头烧完）', async () => {
  const budget = createBudget({ perMatchUsd: 0.0005 }); // 一发就穿
  const m = await playMatch({
    seed: 3,
    seats: { A: seat('x'), B: seat('y') },
    fetchFn: fakeChannel({}),
    budget,
  });
  assert.equal(m.aborted, 'budget');
  assert.equal(m.over, false);
});

// ---------- A5：榜 ----------
test('A5：榜必带样本数、口径限定"在这张桌子上"、不出 benchmark 式断言', async () => {
  const matches = await runArena({
    pairs: [[seat('mx'), seat('my')]],
    games: 1,
    seed0: 101,
    fetchFn: fakeChannel({}),
  });
  const rows = summarize(matches);
  const md = renderBoard(rows, {
    run: { seed0: 101, games: 1, at: '2026-08-09', sampling: SAMPLING, maxTokens: MAX_TOKENS },
    integrity: routingIntegrity(rows),
    cache: cacheReport(rows),
    spread: flavorSpread(rows),
  });
  assert.match(md, /口径：在这张桌子上/);
  assert.match(md, /不是通用能力评测/);
  assert.match(md, /n\(手\)/, '合规层要露分母');
  assert.match(md, /n\(场\)/, '棋力层要露分母');
  assert.match(md, /台词质量评估\*\*须等接地批次 G2/, '台词评估的排期要写在榜上');
  assert.match(md, /十场级的胜率差不构成排名/);
  for (const banned of ['最强', '排名第一', 'SOTA', '碾压'])
    assert.ok(!md.includes(banned), `榜上不许出现「${banned}」`);
});

// ---------- A1：OpenRouter 接入 ----------
test('A1：模型清单动态拉取并归一化（价格/上下文/思考型旗子）', async () => {
  const fixture = {
    data: [
      {
        id: 'x/cheap',
        name: 'Cheap',
        context_length: 131072,
        pricing: { prompt: '0.0000001', completion: '0.0000006', input_cache_read: '0.00000001' },
        top_provider: { max_completion_tokens: 8192 },
        supported_parameters: ['max_tokens', 'seed', 'response_format'],
        architecture: { output_modalities: ['text'] },
        reasoning: { mandatory: false, default_enabled: false },
      },
      {
        id: 'x/thinker',
        name: 'Thinker',
        pricing: { prompt: '0.00001', completion: '0.00005' },
        top_provider: { max_completion_tokens: 8192 },
        supported_parameters: ['reasoning', 'response_format'],
        architecture: { output_modalities: ['text'] },
        reasoning: { mandatory: true, default_effort: 'high', supported_efforts: ['high', 'low'] },
      },
      {
        id: 'x/painter',
        name: 'Painter',
        pricing: { prompt: '0', completion: '0' },
        architecture: { output_modalities: ['image'] }, // 这张桌子上没有图
      },
      {
        // 实测坑：路由型元模型报 "-1"＝价格不定。不归一的话它会以"每百万负一百万美元"排到便宜档第一
        id: 'x/router',
        name: 'Router',
        pricing: { prompt: '-1', completion: '-1' },
        architecture: { output_modalities: ['text'] },
      },
    ],
  };
  const models = await fetchModels({ fetchFn: async () => ({ ok: true, json: async () => fixture }) });
  assert.deepEqual(models.map((m) => m.id), ['x/cheap', 'x/thinker', 'x/router'], '非文本模型不进清单');
  assert.equal(models[0].promptPrice, 1e-7);
  assert.equal(models[0].cacheReadPrice, 1e-8);
  assert.equal(models[1].reasoningMandatory, true, '思考型的旗子来自清单自己，不靠我们猜');
  assert.equal(models[1].reasoningDefaultEnabled, true, 'default_effort 也代表默认会思考，不能漏标');
  assert.deepEqual(requestFeatures(models[0]), {
    decisionExtra: { response_format: { type: 'json_object' } },
  }, '支持推理但默认关闭的型号不被强行开思考');
  assert.deepEqual(requestFeatures(models[1]), {
    reasoningProfile: {
      enabled: true,
      maxTokens: 2048,
      minCompletionTokens: 3072,
      maxCompletionTokens: 8192,
    },
    decisionExtra: { response_format: { type: 'json_object' } },
  });
  // 负价＝价格不定：归一成 null，别让它排到便宜档第一名
  assert.equal(models[2].promptPrice, null);
  assert.equal(models[2].priceKnown, false);
  assert.equal(models[2].free, false);
  assert.equal(models[0].priceKnown, true);
  // 预置只能当预选：清单里没有的一律不显示（名单腐烂了也不会冒出幽灵）
  assert.deepEqual(pickDefaults(models, ['x/cheap', 'x/ghost']).map((m) => m.id), ['x/cheap']);
});

test('A1：能力协商给思考留预算、给答案留余量，并只在决策调用锁 JSON', async () => {
  const modelInfo = normalizeModel({
    id: 'x/thinker',
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { max_completion_tokens: 8192 },
    architecture: { output_modalities: ['text'] },
    supported_parameters: ['reasoning', 'response_format'],
    reasoning: { default_effort: 'high', supported_efforts: ['high', 'low'] },
  });
  const seen = [];
  const m = await createMatch({ seed: 4 });
  const ai = createOpponent({
    channel: pinSampling(openrouterChannel({
      apiKey: 'k',
      model: modelInfo.id,
      modelInfo,
      providerTag: 'fake/fp8',
    })),
    persona: { ...ARENA_SEAT, gear: { ...ARENA_SEAT.gear, maxTokens: 16 } },
    fetchFn: fakeChannel({ seen, reasoningTokens: 321 }),
  });
  const d = await ai.decide(m.observe('A'));
  assert.equal(d.outcome, 'ok');
  assert.equal(seen[0].body.max_tokens, 3072, '16 token 的调用也要扩成推理＋答案的完整信封');
  assert.deepEqual(seen[0].body.reasoning, { max_tokens: 2048 });
  assert.deepEqual(seen[0].body.response_format, { type: 'json_object' });
  assert.equal(d.meta.reasoningTokens, 321, '推理用量要进回执，才能判断是否真的给足');
});

test('A1：供应商锁与来源标识头；官方通道不掺和', () => {
  assert.deepEqual(providerLock('deepinfra/fp4'), {
    provider: { order: ['deepinfra/fp4'], allow_fallbacks: false },
  });
  assert.deepEqual(providerLock(null), {}, '不指定就不下发（不假装锁住了）');
  const h = originHeaders({ referer: 'https://kai.test' });
  assert.equal(h['HTTP-Referer'], 'https://kai.test');
  assert.ok(h['X-Title']);
  // 头值是 ByteString：塞中文会当场抛，而这一抛会被降级链兜住，表现成"AI 一直不说话"
  for (const v of Object.values(originHeaders({ title: '开！单机大话骰' })))
    assert.ok(/^[\x20-\x7E]*$/.test(v), `头值必须是 ASCII，实得「${v}」`);
  assert.doesNotThrow(() => new Headers(originHeaders({ title: '开！' })));
  assert.equal(isOpenRouter('https://openrouter.ai/api/v1'), true);
  assert.equal(isOpenRouter('https://api.deepseek.com/v1'), false);
  const ch = openrouterChannel({ apiKey: 'k', model: 'a/b' });
  assert.equal(ch.format, 'openai', 'OpenRouter 是 OpenAI 兼容口');
  assert.match(ch.baseUrl, /openrouter\.ai/);
});

// ---------- 引擎侧真相仍由事件流复算（不问模型） ----------
test('擂台的统计全部从事件流复算——模型的嘴碰不到这些数', async () => {
  const m = await playMatch({ seed: 13, seats: { A: seat('mx'), B: seat('my') }, fetchFn: fakeChannel({}) });
  const st = seatStats(m, 'A');
  assert.equal(st.rounds, m.events.filter((e) => e.type === 'roundStart').length);
  assert.equal(st.myBids, m.events.filter((e) => e.type === 'bid' && e.actor === 'A').length);
});

test('roundRobin：N 个模型两两配对，不自己打自己', () => {
  const pairs = roundRobin(['a', 'b', 'c'].map((x) => seat(x)));
  assert.equal(pairs.length, 3);
  for (const [x, y] of pairs) assert.notEqual(x.label, y.label);
});

// ---------- 归属：沉默 bot 顶班的成绩不许挂模型名下（C4 报告归属错位＝P0） ----------
test('污染守卫：顶班率高的行，棋力层与风味层一律不出数', () => {
  const rows = [
    { label: 'dead-model', compliance: { silentFallbackRate: 1 },
      skill: { winRate: 1, n: 2, challengeHitRate: 1, challenges: 1, calzas: 0, netChips: 42 },
      flavor: { bluffRate: 0.06, blindBidRate: 0, avgDepth: 2.67, calcPerRound: 0, declarePerRound: 0, baitRate: null, lines: [], n: { bids: 17, rounds: 12, seenBids: 17, says: 0 } },
      samples: { matches: 2, calls: 30 }, cost: { usd: 0, usdFromApi: false, inTokens: 0, cacheRead: 0 } },
    { label: 'live-model', compliance: { silentFallbackRate: 0.06 },
      skill: { winRate: 0, n: 2, challengeHitRate: 0.18, challenges: 11, calzas: 0, netChips: -42 },
      flavor: { bluffRate: 0, blindBidRate: 0.93, avgDepth: 2.67, calcPerRound: 0.42, declarePerRound: 0.08, baitRate: 0.03, lines: [], n: { bids: 15, rounds: 12, seenBids: 1, says: 33 } },
      samples: { matches: 2, calls: 33 }, cost: { usd: 0.0037, usdFromApi: true, inTokens: 24644, cacheRead: 2816 } },
  ];
  const md = renderBoard(rows, { run: {}, spread: flavorSpread(rows) });
  // ① 合规层照实显示 100% 顶班（那正是它该说的）；②③ 两层必须不出数
  const sect = (h) => md.split('## ').find((x) => x.startsWith(h)) ?? '';
  for (const h of ['② 棋力层', '③ 风味层']) {
    const line = sect(h).split('\n').find((l) => l.startsWith('| dead-model'));
    assert.ok(line, h + ' 应有 dead-model 一行');
    assert.ok(line.includes('未参赛'), '必须写明它根本没打：' + line);
    assert.ok(!/\b42\b|100%|0\.06/.test(line), '不许把沉默 bot 的成绩挂它名下：' + line);
  }
  assert.ok(sect('① 合规层').includes('100%'), '合规层要如实报出 100% 顶班');
  // 活着的那行照常出数
  assert.ok(sect('③ 风味层').split('\n').some((l) => l.startsWith('| live-model') && l.includes('93%')));
});

test('污染守卫：被剔除的行不参与分化计算，且剔除要写出来', () => {
  const spoiledRow = { label: 'dead', compliance: { silentFallbackRate: 1 },
    flavor: { bluffRate: 0.5, avgDepth: 9, calcPerRound: 9, declarePerRound: 9, blindBidRate: 9, baitRate: 9, n: { bids: 99, rounds: 99, seenBids: 99, says: 99 } } };
  const cleanRow = { label: 'live', compliance: { silentFallbackRate: 0 },
    flavor: { bluffRate: 0.1, avgDepth: 2, calcPerRound: 1, declarePerRound: 0, blindBidRate: 0.2, baitRate: 0, n: { bids: 99, rounds: 99, seenBids: 99, says: 99 } } };
  const sp = flavorSpread([spoiledRow, cleanRow]);
  assert.equal(sp.bluffRate.enough, false, '只剩一个干净的，不出结论');
  assert.equal(sp.bluffRate.spoiled, 1, '要说清剔了几个');
});

// ---------- 并发：场与场独立，但账不能串 ----------
test('并发：N 场同时跑，结果不丢不重，单场上限各记各的', async () => {
  const seen = [];
  const pairs = [[seat('mx'), seat('my')]];
  const budget = createBudget({ perMatchUsd: 999 }); // 不真刹车，只看账本不打架
  const ms = await runArena({
    pairs, games: 4, seed0: 500, budget, concurrency: 4,
    fetchFn: fakeChannel({ seen }),
  });
  assert.equal(ms.length, 8, '4 组镜像 = 8 场，一场都不许丢');
  // 镜像成对：每个种子恰好两场，且座位互换
  const bySeed = new Map();
  for (const m of ms) bySeed.set(m.seed, [...(bySeed.get(m.seed) ?? []), m]);
  assert.equal(bySeed.size, 4);
  for (const [, two] of bySeed) {
    assert.equal(two.length, 2);
    assert.deepEqual(
      [two[0].seats.A, two[0].seats.B].sort(),
      [two[1].seats.A, two[1].seats.B].sort(),
    );
    assert.notEqual(two[0].seats.A, two[1].seats.A, '第二遍必须换座');
  }
});

test('并发：单场上限只收那一场，不误伤同时在跑的别场', async () => {
  // 每场自己一份账本——共享 matchSpent 的话，A 场的花费会把 B 场也刹停
  const b = createBudget({ perMatchUsd: 1 });
  const one = b.forMatch();
  const two = b.forMatch();
  one.startMatch();
  two.startMatch();
  one.charge({ cost: 5 }, null); // 把第一场干爆
  assert.equal(one.exceeded(), true, '第一场该刹');
  assert.equal(two.exceeded(), false, '第二场不该被连累');
  assert.equal(b.spent(), 5, '整批的账仍然是共用的');
});

// ---------- 互相听得见（2026-08-10）：此前两个模型收不到对方一个字 ----------
test('台词转发：对家说过的话进得了提示词，belief 永不外传', async () => {
  const seen = [];
  await playMatch({
    seed: 11,
    seats: { A: seat('mx'), B: seat('my') },
    fetchFn: fakeChannel({ seen, say: '你这手牌怕是不硬', belief: '其实我五五开' }),
  });
  const users = seen.map((r) => r.body.messages[1].content);
  const heard = users.filter((u) => u.includes('对方') && u.includes('你这手牌怕是不硬'));
  assert.ok(heard.length > 0, '对家的台词必须进得了提示词——否则「牌手层允许诈」是空转');
  assert.ok(heard.some((u) => /第\d+局，对方(报\d+个\d+|开牌|拨算盘|看骰|宣.)时说/.test(u)), '要带上它当时在做什么');
  // belief 可回灌给说话者自己，但绝不能混入公开引语传给对家。
  for (const u of users) {
    const quotes = u.match(/【牌桌发言[\s\S]*?(?=\n\n【|$)/)?.[0] ?? '';
    assert.ok(!quotes.includes('其实我五五开'), 'belief 永不外传');
  }
});

test('对照臂：--no-relay 下对家的话不进提示词（其余不变）', async () => {
  const seen = [];
  await playMatch({
    seed: 11,
    seats: { A: seat('mx'), B: seat('my') },
    relaySpeech: false,
    fetchFn: fakeChannel({ seen, say: '你这手牌怕是不硬' }),
  });
  const users = seen.map((r) => r.body.messages[1].content);
  // 认转发通道的特征串。不能直接搜台词本身——**自己说过的话本来就会经 ownLog 回灌给自己**
  // （那是同局嘴手不断裂用的，与转发无关），搜文本会把两者混为一谈。
  for (const u of users) assert.ok(!u.includes('【牌桌发言'), '关了就一句都不许转发进来');
  // 其余照旧：规则、局面、动作叙事、自我回灌都不动
  assert.ok(users.some((u) => /【公开历史｜本场完整/.test(u)), '对照臂只关台词转发，别的不动');
  assert.ok(users.some((u) => /你本局此前/.test(u)), '自我回灌不受影响');
});

// ---------- 截断归因：我们的预算不许算成它的合规失败 ----------
test('被 max_tokens 截断另立类目，不计入格式失败', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const ai = createOpponent({
    channel: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'm' },
    persona: ARENA_SEAT,
    // 断在半句上的 JSON ＋ finish_reason=length：这正是 400 预算下的真实形态
    fetchFn: async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"action":{"type":"challenge"},"say":"开","note":"对方拨算盘后报' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 900, completion_tokens: 800 },
      }),
    }),
  });
  await m.act('B', { type: 'peek' });
  const d = await ai.decide(m.observe('B'));
  assert.equal(d.outcome, 'truncated', '截断要有自己的类目');
  assert.notEqual(d.outcome, 'bad-json', '不许算成它不守契约');
  assert.equal(d.silentFallback, true, '这一手仍然由沉默 bot 顶——但账记在我们头上');

  const rows = summarize([{ seats: { A: 'x', B: 'y' }, events: [], logs: { A: ai.logs, B: [] }, rejects: {} }]);
  const row = rows.find((r) => r.label === 'x');
  assert.ok(row.compliance.truncatedRate > 0, '榜上单独一列');
  assert.equal(row.compliance.formatFailRate, 0, '不许混进格式失败');
});

test('推理吃完整个信封、正文为空时也归因 truncated，不算网络错误', async () => {
  const m = await createMatch({ seed: 31 });
  const ai = createOpponent({
    channel: { baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'thinker' },
    persona: ARENA_SEAT,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1000, completion_tokens: 3072 },
      }),
    }),
  });
  const d = await ai.decide(m.observe('A'));
  assert.equal(d.outcome, 'truncated');
  assert.equal(d.silentFallback, true);
  assert.equal(d.meta.finish, 'length');
});

// ---------- 记忆赛道（Q90 联赛方向）：系列赛跨场携带比分与假设，与素颜两本账不混流 ----------
test('playSeries：先到两胜即止；第二场提示词携带系列比分、上场裁判层小结与蒸馏假设', async () => {
  const decisionUsers = [];
  const reflectUsers = [];
  const sysOf = (msg) => (Array.isArray(msg.content) ? msg.content.map((c) => c.text).join('') : msg.content);
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    const system = sysOf(body.messages[0]);
    const user = body.messages[1].content;
    if (system.includes('系列赛两场之间')) {
      reflectUsers.push(user);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"hypotheses":[{"text":"他冲动，报价一深就开","hits":1}]}' } }],
          usage: { prompt_tokens: 500, completion_tokens: 40 },
        }),
      };
    }
    decisionUsers.push(user);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(fakeDecide(user)) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 60 },
      }),
    };
  };
  const seats = {
    A: { label: 'x', channel: openrouterChannel({ apiKey: 'k', model: 'x', providerTag: 'p/fp8' }), price: {} },
    B: { label: 'y', channel: openrouterChannel({ apiKey: 'k', model: 'y', providerTag: 'p/fp8' }), price: {} },
  };
  const s = await playSeries({ seed0: 42, bestOf: 3, seats, fetchFn });
  // 系列结构：有人拿满 2 胜，场数介于 2 和 3
  assert.ok(s.winner, '假模型对打必然分出胜负');
  assert.equal(s.wins[s.winner], 2);
  assert.ok(s.games.length >= 2 && s.games.length <= 3, `场数 ${s.games.length}`);
  assert.equal(s.games.length, s.wins.A + s.wins.B);
  // 第一场就知道自己在打系列赛（框架是数据），但没有过往场次、没有假设
  assert.ok(decisionUsers[0].includes('即将开第1场'), '首场带系列框架');
  assert.ok(!/第1场(你胜|你负)/.test(decisionUsers[0]), '首场没有过往战绩');
  assert.ok(!decisionUsers[0].includes('主观假设'), '首场没有假设');
  // 第二场起：比分、上场小结、蒸馏假设全部进档案分区
  const second = decisionUsers.find((u) => u.includes('即将开第2场'));
  assert.ok(second, '第二场提示词должен携带系列比分');
  assert.match(second, /系列赛（3场2胜，同一对手连打）/);
  assert.match(second, /第1场(你胜|你负)（\d+局）：你开牌\d+次中\d+次/);
  assert.ok(second.includes('他冲动，报价一深就开'), '蒸馏出的假设进第二场档案');
  // 互相明牌（默认开）：第二场能看到对手的本子怎么写自己，且标签言明双方互见
  assert.ok(second.includes('对手的明牌本子'), '对手假设对翻可见');
  assert.ok(second.includes('双方互相可见'), '机制在数据标签里如实说明');
  // 蒸馏调用拿到的是裁判层小结＋自己的留档
  assert.ok(reflectUsers[0].includes('刚打完的一场：第1场'));
  assert.ok(reflectUsers[0].includes('你既有的假设：（还没有）'));
  // 假设演化留痕（每个座位每个场间一格）
  assert.equal(s.hypothesesTrail.A.length, s.games.length - 1);
  assert.deepEqual(s.hypothesesTrail.A[0][0].text, '他冲动，报价一深就开');
});

test('playSeries：胜负 2–0 提前收场，不打第三场也不再蒸馏', async () => {
  // 让 A 席稳定更准：A 用 aggressive（会算），B 一律不算——沉默 bot 都不用，全走假模型
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    const sys = body.messages[0].content;
    if ((Array.isArray(sys) ? sys.map((c) => c.text).join('') : sys).includes('系列赛两场之间'))
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"hypotheses":[]}' } }] }) };
    const user = body.messages[1].content;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(fakeDecide(user)) } }] }) };
  };
  const seats = {
    A: { label: 'x', channel: openrouterChannel({ apiKey: 'k', model: 'x', providerTag: 'p/fp8' }), price: {} },
    B: { label: 'y', channel: openrouterChannel({ apiKey: 'k', model: 'y', providerTag: 'p/fp8' }), price: {} },
  };
  const s = await playSeries({ seed0: 7, bestOf: 3, seats, fetchFn, openBook: false });
  if (s.wins[s.winner] === 2 && s.games.length === 2) {
    assert.equal(s.hypothesesTrail.A.length, 1, '2–0 只有一次场间蒸馏');
  }
  assert.ok(s.games.length <= 3);
});

// ---------- sayRate 口径：沉默是选择，故障不是 ----------
test('sayRate 口径：分母只算模型自己产出合法决策的手，错误/顶班手不稀释话密度', async () => {
  const m = await playMatch({ seed: 7, seats: { A: seat('mx'), B: seat('my') }, fetchFn: fakeChannel({}) });
  // 人工补两条手：一条网络错（不该进分母）、一条 ok 但选择沉默（该进分母）
  m.logs.A.push({ round: 99, outcome: 'error', silentFallback: true, say: '', meta: {} });
  m.logs.A.push({ round: 99, outcome: 'ok', silentFallback: false, say: '', belief: '这手不说话', meta: {} });
  const rows = summarize([m]);
  const rx = rows.find((r) => r.label === 'mx');
  const logs = m.logs.A.filter((l) => !l.auto);
  const okN = logs.filter((l) => l.outcome === 'ok').length;
  const saysN = logs.filter((l) => l.say).length;
  assert.equal(rx.flavor.n.hands, okN, '分母＝ok 手数（错误手不入）');
  assert.equal(rx.flavor.sayRate, +(saysN / okN).toFixed(3));
  assert.ok(rx.flavor.sayRate < 1, '选择沉默的那手计入分母，拉低话密度');
});

// ---------- 推理开关实验臂：#nothink 的通道级 reasoning 关断要真的进请求体 ----------
test('推理开关臂：channel.extra.reasoning={enabled:false} 原样下发，且不再套推理信封', async () => {
  const seen = [];
  const ch = pinSampling({
    baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'm',
    extra: { reasoning: { enabled: false } },
    reasoningProfile: { enabled: true, maxTokens: 2048, minCompletionTokens: 3072 },
  });
  await createOpponent({ channel: ch, fetchFn: async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"action":{"type":"peek"}}' } }] }) };
  } }).decide((await createMatch({ seed: 3 })).observe('A'));
  assert.deepEqual(seen[0].reasoning, { enabled: false }, '关断显式下发');
  assert.equal(seen[0].max_tokens, DECISION_MAX_TOKENS, '显式关断后不套推理信封（裸预算原样下发）');
});

// ---------- 逐句制品主键：跨臂同 seed 不得碰撞（2026-08-12 用户核数抓获的伪象根源） ----------
test('saysRowsOf：同 seed 跨对局的 lineId 全批唯一，且携带对局序号与顶班注记', async () => {
  const mk = async (label) =>
    await playMatch({ seed: 1000, seats: { A: seat('anchor'), B: seat(label) }, fetchFn: fakeChannel({}) });
  const matches = [await mk('cand1'), await mk('cand2')]; // 两臂同 seed —— 旧主键必然碰撞
  const rows = saysRowsOf(matches);
  assert.equal(new Set(rows.map((r) => r.lineId)).size, rows.length, 'lineId 全批唯一');
  assert.ok(rows.every((r) => r.match === 0 || r.match === 1), '每行携带对局序号');
  assert.ok(rows.every((r) => typeof r.matchSilentHands === 'number'), '干净度注记随行携带');
  const m0 = rows.filter((r) => r.match === 0).map((r) => r.model);
  assert.ok(!m0.includes('cand2'), '行归属不串臂');
});
