// 官方通道 v0（§9.2）：同域 LLM 代理。真 key 存 Pages secret，客户端只持暗号（FRIEND_PASS）。
// 部署形态：Cloudflare Pages advanced mode——本文件复制进 dist/ 随站发布，拦截 /api/llm/*，其余请求回源静态资产。
// 配额与熔断（§9.3/§9.6）：设备日配额 + 全局月熔断（月红线 ¥500 的调用数上限），KV 计数。
// 超限返回 429/503 → 客户端自动降级沉默模式。KV 故障时放行（预充值余额是物理上限兜底）。

const DEVICE_DAILY_LIMIT = 80; // 每设备每日调用（≈6 场）
const GLOBAL_MONTHLY_LIMIT = 100_000; // 全局月调用熔断（≈¥250，低于 ¥500 红线一半，双保险）

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
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device",
          },
        });
      }
      if (url.pathname === "/api/llm/ping") {
        let kv = "no-binding";
        if (env.QUOTA) {
          try {
            await env.QUOTA.put("ping", String(Date.now()), { expirationTtl: 3600 });
            kv = (await env.QUOTA.get("ping")) ? "rw-ok" : "write-lost";
          } catch (e) {
            kv = "err:" + (e && e.message);
          }
        }
        // 带 Authorization 时顺带校验暗号（免费连通测试，不动 LLM）
        const auth = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
        const pass = auth && env.FRIEND_PASS ? auth === env.FRIEND_PASS : null;
        return json({ quota: !!env.QUOTA, secrets: !!(env.FRIEND_PASS && env.DEEPSEEK_KEY), kv, pass });
      }
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      if (!env.FRIEND_PASS || !env.DEEPSEEK_KEY) return json({ error: "服务端未配置暗号或 key" }, 503);
      const pass = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (pass !== env.FRIEND_PASS) return json({ error: "暗号不对" }, 401);

      // ---- 配额检查（尽力计数，KV 异常放行）----
      if (env.QUOTA) {
        try {
          const now = new Date();
          const day = now.toISOString().slice(0, 10);
          const month = day.slice(0, 7);
          const device = (request.headers.get("X-Device") || "anon").slice(0, 64);
          const dKey = `d:${device}:${day}`;
          const gKey = `g:${month}`;
          const [dUsed, gUsed] = await Promise.all([
            env.QUOTA.get(dKey).then((v) => +v || 0),
            env.QUOTA.get(gKey).then((v) => +v || 0),
          ]);
          if (gUsed >= GLOBAL_MONTHLY_LIMIT) return json({ error: "本月打烊，下月再来" }, 503);
          if (dUsed >= DEVICE_DAILY_LIMIT) return json({ error: "今日额度用完，明天再来" }, 429);
          await Promise.all([
            env.QUOTA.put(dKey, String(dUsed + 1), { expirationTtl: 86400 * 2 }),
            env.QUOTA.put(gKey, String(gUsed + 1), { expirationTtl: 86400 * 40 }),
          ]);
        } catch {}
      }

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
