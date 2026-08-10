// OpenRouter 接入（施工单 A1，凭 Q52）：一把钥匙开一屋子模型。
//
// 三条硬纪律，全部来自 Q52 裁决：
//   ① **BYOK 专属，官方通道绝不开放**——别人的模型烧别人的钱（Q7 财务线）。
//      本模块只被客席与擂台调用；infra/pages/_worker.js 的模型白名单一个字不动。
//   ② **清单动态拉取，禁硬编易腐名单**——四百个模型每周都在变，写死的名单三个月后全是幽灵。
//      拉不到就退回自由输入框（老路径），**不拿假名单糊弄**。
//   ③ **实验须锁供应商路由**——同一个模型 ID 会被路由到不同后端与量化档
//      （实测 deepseek-v4-flash 同时挂在 DigitalOcean/unknown、Baidu/fp8、DeepInfra/fp4 上），
//      不锁的话方差里混着后端差异。锁 + 验（见 arena/arena.js：回包里的 provider 变了就标污染）。
//
// key 不出设备（§3.4）：浏览器直连 openrouter.ai，我方服务器永不经手。

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const OPENROUTER_REASONING_TOKENS = 2048;
export const OPENROUTER_COMPLETION_TOKENS = 3072;

export const isOpenRouter = (baseUrl = '') => /(^|\/\/)openrouter\.ai/.test(baseUrl);

// 来源标识头（OpenRouter 惯例）：告诉它这些调用是谁打来的。
// 浏览器不禁 HTTP-Referer（它不是 Referer，是自定义头），node 侧给个占位。
//
// **头值必须是 ASCII**：fetch 的头值是 ByteString，塞中文会当场抛
// "Cannot convert argument to a ByteString"——而这一抛会被决策链的降级兜住，
// 表现成"AI 一直不说话"（本批实测踩到：整条 OpenRouter 通道 100% 静默降级）。
// 所以这里硬过滤一道，宁可标识难看，不许把通道毒死。
const ascii = (s = '') => String(s).replace(/[^\x20-\x7E]/g, '').trim();
export function originHeaders({ referer, title = 'Kai (kai-dice)' } = {}) {
  const ref = referer ?? (typeof location !== 'undefined' ? location.origin : 'https://kai-dice.pages.dev');
  return { 'HTTP-Referer': ascii(ref) || 'https://kai-dice.pages.dev', 'X-Title': ascii(title) || 'Kai' };
}

// 价格解析。**负数＝价格不定**（实测：openrouter/fusion 这类路由型元模型报 "-1"）——
// 归一成 null，别让它以"每百万 -100 万美元"的身份排到便宜档第一名。
const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? null : n;
};

// 一条模型 → 我们要的那几件事。字段按 OpenRouter /models 的实际形状读，全部防空：
// 它加字段是常态，我们只认自己用得上的那几个。
export function normalizeModel(m) {
  const p = m.pricing ?? {};
  const promptPrice = num(p.prompt); // USD / token
  const completionPrice = num(p.completion);
  const reasoningInfo = m.reasoning ?? null;
  const defaultEffort = reasoningInfo?.default_effort ?? null;
  const reasoningDefaultEnabled = !!(
    reasoningInfo?.mandatory ||
    reasoningInfo?.default_enabled ||
    (defaultEffort && defaultEffort !== 'none')
  );
  return {
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? m.top_provider?.context_length ?? null,
    maxOutput: m.top_provider?.max_completion_tokens ?? null,
    promptPrice,
    completionPrice,
    cacheReadPrice: num(p.input_cache_read),
    cacheWritePrice: num(p.input_cache_write),
    free: promptPrice === 0 && completionPrice === 0,
    // 价格不定的多半是**路由型元模型**（每手可能落到不同的底模）——
    // 那种东西上擂台，方差里混的就不只是后端了，是整个模型都在换。
    priceKnown: promptPrice != null && completionPrice != null,
    // 思考型标注与默认档都以实时清单为准。只看 mandatory/default_enabled 会漏掉
    // `default_effort: high` 但没重复写 default_enabled 的型号（V4 Pro 实测即如此）。
    reasoning: !!reasoningInfo,
    reasoningMandatory: !!reasoningInfo?.mandatory,
    reasoningDefaultEnabled,
    reasoningDefaultEffort: defaultEffort,
    reasoningEfforts: [...(reasoningInfo?.supported_efforts ?? [])],
    reasoningSupportsMaxTokens: !!reasoningInfo?.supports_max_tokens,
    supports: new Set(m.supported_parameters ?? []),
    // 只留纯文本模型：这张桌子上没有图
    textOnly: (m.architecture?.output_modalities ?? ['text']).every((x) => x === 'text'),
  };
}

// 实时能力清单 → 通道技术参数。它只做两件事：
//   ① 默认会思考的型号，给推理独立上限并保留答案余量；不替默认关闭的型号强开推理；
//   ② 支持 JSON 模式的型号只在“决策调用”上锁传输格式，不污染开场白等纯文本任务。
// 这是能力协商，不是按型号改提示词；所有席位看到的 system/user 仍逐字相同。
export function requestFeatures(model) {
  if (!model) return {};
  const maxCompletion = Math.max(1, Math.min(OPENROUTER_COMPLETION_TOKENS, model.maxOutput ?? Infinity));
  // Anthropic 等后端的显式推理预算最低 1024；总信封不足 2048 时不乱下一个会 400 的配置。
  const reasoningMax =
    maxCompletion >= 2048 ? Math.min(OPENROUTER_REASONING_TOKENS, maxCompletion - 1024) : 0;
  return {
    ...(model.reasoningDefaultEnabled && reasoningMax > 0
      ? {
          reasoningProfile: {
            enabled: true,
            maxTokens: reasoningMax,
            minCompletionTokens: maxCompletion,
            maxCompletionTokens: model.maxOutput ?? null,
          },
        }
      : {}),
    ...(model.supports?.has('response_format') || model.supports?.has('structured_outputs')
      ? { decisionExtra: { response_format: { type: 'json_object' } } }
      : {}),
  };
}

// 每百万 token 报价（人看的口径；美元）
export const perMillion = (price) => (price == null ? null : price * 1e6);

// 动态拉取清单（纪律②）。公开接口，不需要 key。
export async function fetchModels({ apiKey, fetchFn = globalThis.fetch, base = OPENROUTER_BASE } = {}) {
  const res = await fetchFn(`${base}/models`, {
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
  });
  if (!res.ok) throw new Error(`openrouter models http ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j?.data)) throw new Error('openrouter models: bad shape');
  return j.data.map(normalizeModel).filter((m) => m.textOnly);
}

// 某模型的后端清单（纪律③的原料）：每个 endpoint 是一个供应商×量化档。
// tag 形如 "deepinfra/fp4"，是能精确指到那一档的名字。
export async function fetchEndpoints(modelId, { fetchFn = globalThis.fetch, base = OPENROUTER_BASE } = {}) {
  const res = await fetchFn(`${base}/models/${modelId}/endpoints`);
  if (!res.ok) throw new Error(`openrouter endpoints http ${res.status}`);
  const j = await res.json();
  return (j?.data?.endpoints ?? []).map((e) => ({
    tag: e.tag ?? null,
    provider: e.provider_name ?? null,
    quantization: e.quantization ?? null,
    contextLength: e.context_length ?? null,
    maxOutput: e.max_completion_tokens ?? null,
    promptPrice: num(e.pricing?.prompt),
    completionPrice: num(e.pricing?.completion),
    cacheReadPrice: num(e.pricing?.input_cache_read),
  }));
}

// 供应商路由锁（纪律③）：allow_fallbacks:false ＋ 指名到 tag。
// 锁不住时 OpenRouter 会报错而不是偷偷换后端——报错是好事，静默换后端才是脏数据。
export const providerLock = (tagOrSlug) =>
  tagOrSlug ? { provider: { order: [tagOrSlug], allow_fallbacks: false } } : {};

// 常见款默认项（Q52"预置常见款"）：**只用作预选，不作清单**——
// 拿它去和真清单求交集，清单里没有的就当它不存在（名单腐烂了也只是少个默认值，不会显示幽灵）。
export const DEFAULT_PICKS = [
  'deepseek/deepseek-chat',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-terra',
  'google/gemini-3.6-flash',
  'x-ai/grok-4.5',
  'qwen/qwen3.8-max',
  'z-ai/glm-5.2',
  'moonshotai/kimi-k2',
];

export const pickDefaults = (models, picks = DEFAULT_PICKS) => {
  const have = new Map(models.map((m) => [m.id, m]));
  return picks.map((id) => have.get(id)).filter(Boolean);
};

// 客席/擂台用的通道对象（与 llm.js 的 chat 同构）。
// base 可覆盖：本地跑集成测试时指到假服务器，生产不用动。
export function openrouterChannel({ apiKey, model, modelInfo, referer, title, providerTag, base = OPENROUTER_BASE } = {}) {
  return {
    baseUrl: base,
    apiKey,
    model,
    format: 'openai', // OpenRouter 是 OpenAI 兼容口，Anthropic 模型也从这个口进
    headers: originHeaders({ referer, title }),
    providerTag: providerTag ?? null,
    ...requestFeatures(modelInfo),
  };
}
