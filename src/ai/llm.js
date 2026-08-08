// BYOK 模型通道（DESIGN §3.4）：浏览器直连，key 不出设备。
// 兼容 OpenAI 与 Anthropic 两种消息格式。fetch 可注入以便测试。

// extra：透传进请求体的额外参数（如推理型模型的 reasoning_effort）——人设装备层配置
export async function chat(
  { baseUrl, apiKey, model, format = 'openai', headers: extraHeaders },
  { system, user, maxTokens = 500, timeoutMs = 10_000, extra },
  fetchFn = globalThis.fetch,
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
              system,
              messages: [{ role: 'user', content: user }],
              ...extra,
            },
            text: (j) => j.content?.[0]?.text,
          }
        : {
            url: `${url}/chat/completions`,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...extraHeaders },
            body: {
              model,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: system },
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
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const text = req.text(await res.json());
    if (typeof text !== 'string') throw new Error('llm empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
