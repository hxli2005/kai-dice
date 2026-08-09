// 官方通道 v0（§9.2）：同域 LLM 代理。真 key 存 Pages secret，客户端只持暗号（FRIEND_PASS）。
// 部署形态：Cloudflare Pages advanced mode——本文件复制进 dist/ 随站发布，拦截 /api/llm/*，其余请求回源静态资产。
// 配额与熔断（§9.3/§9.6）：设备日配额 + 全局月熔断（月红线 ¥500 的调用数上限），KV 计数。
// 超限返回 429/503 → 客户端自动降级沉默模式。KV 故障时放行（预充值余额是物理上限兜底）。

const DEVICE_DAILY_LIMIT = 400; // 每设备每日调用（2026-08-08 二次上调 150→400，用户授权：词条时代编译/体检/判词都计调用，重度日 150 必见底；成本兜底=预充值余额+月熔断）
const GLOBAL_MONTHLY_LIMIT = 100_000; // 全局月调用熔断（≈¥250，低于 ¥500 红线一半，双保险）

// ---- 托管席（用户裁决 2026-08-09）：不带暗号也能玩上一个真模型 ----
// §3.4 早写了"默认走官方通道（内置低成本模型，每日限额，保证零门槛上手）"，一直欠着。
// 现在补上，但按 Q7 保命三律「别破产」把口子开小：
//   · 免费档**只放行托管这一个便宜模型**（暗号持有者才碰得到别的原版演员）；
//   · 免费档单设备日限另算一档更小的（≈4–5 场），暗号档仍是 400；
//   · 免费档要求请求来自浏览器同源（Origin 或 Sec-Fetch-Site）——挡住裸脚本刷；
//   · 全局月熔断照旧，是最后那道闸。
const HOSTED_MODEL = "deepseek-v4-flash"; // 与 src/ai/personas.js 的 HOSTED_MODEL 同名
const OPEN_DAILY_LIMIT = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 好友房（Q29）：/api/room/* → 房间 DO（kai-room worker 提供，同域零 CORS）
    if (url.pathname.startsWith("/api/room")) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
      if (!env.ROOMS) return json({ error: "房间服务未接（DO 绑定缺失）" }, 503);
      if (url.pathname === "/api/room/new" && request.method === "POST") {
        const rid = (n) =>
          Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
        const room = rid(10);
        const hostKey = rid(16);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
        await stub.fetch("https://do/init", { method: "POST", body: JSON.stringify({ hostKey }) });
        return json({ room, hostKey });
      }
      const m = url.pathname.match(/^\/api\/room\/ws\/([a-z0-9]{10})$/);
      if (m && request.headers.get("Upgrade") === "websocket") {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
        return stub.fetch(request);
      }
      return json({ error: "not found" }, 404);
    }
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
        // 带 X-Device 时回报今日用量——"连不上"从猜谜变成读数
        let deviceUsed = null;
        let openUsed = null;
        const dev = request.headers.get("X-Device");
        if (env.QUOTA && dev) {
          const day = new Date().toISOString().slice(0, 10);
          try {
            deviceUsed = +(await env.QUOTA.get(`d:${dev.slice(0, 64)}:${day}`)) || 0;
            openUsed = +(await env.QUOTA.get(`o:${dev.slice(0, 64)}:${day}`)) || 0;
          } catch {}
        }
        return json({
          quota: !!env.QUOTA,
          secrets: !!(env.FRIEND_PASS && env.DEEPSEEK_KEY),
          kv,
          pass,
          deviceUsed,
          deviceLimit: DEVICE_DAILY_LIMIT,
          openUsed, // 免费托管档今日用量
          openLimit: OPEN_DAILY_LIMIT,
          hosted: HOSTED_MODEL,
        });
      }
      // 上游模型清单（运维用）：托管席的模型名必须与上游对得上，靠这个查而不是靠猜。
      if (url.pathname === "/api/llm/models") {
        if (!env.DEEPSEEK_KEY) return json({ error: "服务端未配置 key" }, 503);
        try {
          const r = await fetch("https://api.deepseek.com/models", {
            headers: { Authorization: `Bearer ${env.DEEPSEEK_KEY}` },
          });
          const j = await r.json();
          const ids = (j.data ?? []).map((m) => m.id);
          return json({ ids, hosted: HOSTED_MODEL, hostedAvailable: ids.includes(HOSTED_MODEL) }, r.status);
        } catch (e) {
          return json({ error: "上游清单拉取失败：" + (e && e.message) }, 502);
        }
      }
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      // Origin 锁域（§9.7 Q8②）：镜像站在浏览器里带的是自己的 Origin——有 Origin 且非本站即拒。
      // 无 Origin（curl 等）不拦：威胁模型是"镜像网站白嫖官方通道"，脚本盗刷靠暗号轮换与配额兜底。
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ error: "此暗号只在官方域有效" }, 403);
      if (!env.DEEPSEEK_KEY) return json({ error: "服务端未配置 key" }, 503);
      // `\s*` 不是 `\s+`：客户端若发了个空的 `Bearer `，代理这边收到的可能是光秃秃的 `Bearer`——
      // 用 `\s+` 剥不掉，就会把 "Bearer" 本身当成暗号判 401，免费档整个进不来（实测踩过）。
      const pass = (request.headers.get("Authorization") || "").replace(/^Bearer\s*/i, "").trim();
      // 两档：有暗号＝原班人马全开、日限 400；没暗号＝免费托管档、只放行托管模型、日限 60。
      const friend = !!(env.FRIEND_PASS && pass && pass === env.FRIEND_PASS);
      if (pass && !friend) return json({ error: "暗号不对" }, 401);
      if (!friend) {
        // 免费档只招待浏览器里的真人：裸脚本（无 Origin 且无 Sec-Fetch-Site）不接待
        const sfs = request.headers.get("Sec-Fetch-Site");
        if (origin !== url.origin && sfs !== "same-origin")
          return json({ error: "免费档只在官方页面里可用" }, 403);
      }
      const dailyLimit = friend ? DEVICE_DAILY_LIMIT : OPEN_DAILY_LIMIT;

      // ---- 配额检查（尽力计数，KV 异常放行）----
      if (env.QUOTA) {
        try {
          const now = new Date();
          const day = now.toISOString().slice(0, 10);
          const month = day.slice(0, 7);
          const device = (request.headers.get("X-Device") || "anon").slice(0, 64);
          // 免费档单独记一本账：省得路人把暗号持有者的额度吃掉，也方便看免费档到底有多少人在用
          const dKey = `${friend ? "d" : "o"}:${device}:${day}`;
          const gKey = `g:${month}`;
          const [dUsed, gUsed] = await Promise.all([
            env.QUOTA.get(dKey).then((v) => +v || 0),
            env.QUOTA.get(gKey).then((v) => +v || 0),
          ]);
          if (gUsed >= GLOBAL_MONTHLY_LIMIT) return json({ error: "本月打烊，下月再来" }, 503);
          if (dUsed >= dailyLimit)
            return json(
              { error: friend ? "今日额度用完，明天再来" : "今日免费额度用完了，明天再来（有暗号可以填在设置里）" },
              429,
            );
          await Promise.all([
            env.QUOTA.put(dKey, String(dUsed + 1), { expirationTtl: 86400 * 2 }),
            env.QUOTA.put(gKey, String(gUsed + 1), { expirationTtl: 86400 * 40 }),
          ]);
        } catch {}
      }

      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      // 模型服务端白名单（Q18 原版演员按人设钉）：名单外一律钉回默认——暗号持有者也改不了成本档。
      // 免费档更严：只准托管那一个模型，谁也别想用免费口子点贵的。
      // 名单以**上游 /api/llm/models 查到的为准**，不照抄历史里的名字：
      // 2026-08-09 核对发现上游只有 deepseek-v4-flash 与 deepseek-v4-pro 两个 id，
      // 而化身一直钉着 "deepseek-chat"——名单外的一律钉回托管模型，别让它去敲一个不存在的门。
      const MODEL_ALLOW = friend ? [HOSTED_MODEL, "deepseek-v4-pro"] : [HOSTED_MODEL];
      if (!MODEL_ALLOW.includes(body.model)) body.model = HOSTED_MODEL;
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
