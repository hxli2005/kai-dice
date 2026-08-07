// 官方通道 v0（§9.2）：同域 LLM 代理。真 key 存 Pages secret，客户端只持暗号（FRIEND_PASS）。
// 部署形态：Cloudflare Pages advanced mode——本文件复制进 dist/ 随站发布，拦截 /api/llm/*，其余请求回源静态资产。
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/llm")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": url.origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
          },
        });
      }
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      if (!env.FRIEND_PASS || !env.DEEPSEEK_KEY) return json({ error: "服务端未配置暗号或 key" }, 503);
      const pass = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (pass !== env.FRIEND_PASS) return json({ error: "暗号不对" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      body.model = "deepseek-chat"; // 模型服务端钉死：暗号持有者也改不了成本档
      const upstream = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.DEEPSEEK_KEY}` },
        body: JSON.stringify(body),
      });
      const headers = new Headers({ "Content-Type": upstream.headers.get("Content-Type") || "application/json" });
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
