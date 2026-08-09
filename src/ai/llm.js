// BYOK 模型通道（DESIGN §3.4）：浏览器直连，key 不出设备。
// 兼容 OpenAI 与 Anthropic 两种消息格式。fetch 可注入以便测试。

// 缓存断点（A4 降本一）：稳定前缀＝系统提示词（规则/输出契约/人设，每手逐字相同），
// 每手变化的局面与档案在断点之后。只在明确开启时下发——多数 OpenAI 兼容端点吃不下
// 数组式 content，默认不动；OpenRouter 转 Anthropic 时才用得上。
const cacheBlock = (text) => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];

// 用量回填（A4 成本护栏）：调用方传 meta 对象，这里把这一发的账写进去——
// 花了多少、缓存读了多少、哪个后端接的（A2 供应商路由锁定要靠它验，不靠承诺）。
function fillMeta(meta, j, res, ms) {
  if (!meta) return;
  const u = j?.usage ?? {};
  meta.ms = ms;
  meta.status = res?.status ?? null;
  meta.usage = u;
  meta.inTokens = u.prompt_tokens ?? u.input_tokens ?? null;
  meta.outTokens = u.completion_tokens ?? u.output_tokens ?? null;
  // 三种口径都收：OpenAI 系 prompt_tokens_details.cached_tokens、Anthropic 原生
  // cache_read_input_tokens、OpenRouter 转发时两者皆可能——收不到就是 null（不假装省了钱）
  meta.cacheRead =
    u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? u.cache_read_tokens ?? null;
  meta.cacheWrite = u.cache_creation_input_tokens ?? u.cache_write_tokens ?? null;
  meta.cost = typeof u.cost === 'number' ? u.cost : null; // OpenRouter：请求带 usage:{include:true} 才有
  meta.provider = j?.provider ?? null; // 实际接单的后端（同 ID 不同后端会污染方差）
  meta.finish = j?.choices?.[0]?.finish_reason ?? j?.stop_reason ?? null;
}

// extra：透传进请求体的额外参数（如推理型模型的 reasoning_effort）——人设装备层配置
// meta：可选回填对象（用量/费用/后端/耗时）；cacheSystem：给系统提示词打缓存断点
// 通道级 extra/cacheSystem（A2）：供应商路由锁、用量回报、钉死的采样参数属于"这条通道"，
// 与人设无关；调用级 extra（人设装备）后覆盖，两者合并下发。
export async function chat(
  { baseUrl, apiKey, model, format = 'openai', headers: extraHeaders, extra: chanExtra, cacheSystem: chanCache },
  { system, user, maxTokens = 500, timeoutMs = 10_000, extra: callExtra, meta, cacheSystem: callCache },
  fetchFn = globalThis.fetch,
) {
  const extra = chanExtra || callExtra ? { ...chanExtra, ...callExtra } : undefined;
  const cacheSystem = !!(chanCache || callCache);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const url = baseUrl.replace(/\/$/, '');
    const req =
      format === 'anthropic'
        ? {
            url: `${url}/v1/messages`,
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
              ...extraHeaders,
            },
            body: {
              model,
              max_tokens: maxTokens,
              system: cacheSystem ? cacheBlock(system) : system,
              messages: [{ role: 'user', content: user }],
              ...extra,
            },
            text: (j) => j.content?.[0]?.text,
          }
        : {
            url: `${url}/chat/completions`,
            // 没钥匙就**别发这个头**：空的 `Bearer ` 到了服务端会被规范化成 `Bearer`，
            // 看起来像"带了一个叫 Bearer 的暗号"——免费托管档就是这么被自己挡在门外的（实测 401）。
            headers: {
              'content-type': 'application/json',
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
              ...extraHeaders,
            },
            body: {
              model,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: cacheSystem ? cacheBlock(system) : system },
                { role: 'user', content: user },
              ],
              ...extra,
            },
            text: (j) => j.choices?.[0]?.message?.content,
          };
    const res = await fetchFn(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (meta) {
        meta.status = res.status;
        meta.ms = Date.now() - t0;
      }
      throw new Error(`llm http ${res.status}`);
    }
    const j = await res.json();
    fillMeta(meta, j, res, Date.now() - t0);
    const text = req.text(j);
    if (typeof text !== 'string') throw new Error('llm empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
