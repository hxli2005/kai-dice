// 素颜擂台跑批（施工单 A1–A5）。离屏，BYOK 走 OpenRouter，官方通道不参与。
//
//   预演（只估价不花钱，默认行为）：
//     OPENROUTER_KEY=sk-or-... node scripts/arena.mjs --models deepseek/deepseek-chat,z-ai/glm-5.2 --games 5
//   真跑（--yes 才会花钱）：
//     OPENROUTER_KEY=sk-or-... node scripts/arena.mjs --models a,b,c --games 5 --cap 3 --per-match 0.25 --yes
//   便宜档自动选（按清单实时价选最便宜的 N 个非免费模型）：
//     OPENROUTER_KEY=sk-or-... node scripts/arena.mjs --cheap 4 --games 3 --yes
//
// 指定后端：模型写成 `id@provider-tag`（如 deepseek/deepseek-v4-flash-0731@deepinfra/fp4）。
// 不写就取该模型的第一个 endpoint 并锁住——**锁了还要验**，回执里后端变过就在榜上标污染。
//
// A4 红线：禁止把消费级订阅桥接成 API 后端（见 src/arena/cost.js）。

import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { seatSystem, PROMPT_VERSION } from '../src/ai/agent.js';
import { fetchModels, fetchEndpoints, openrouterChannel, pickDefaults, OPENROUTER_BASE } from '../src/ai/openrouter.js';
import { runArena, roundRobin, playSeries, SAMPLING, MAX_TOKENS, TIMEOUT_MS, REASONING_TOKENS, pinSampling } from '../src/arena/arena.js';
import { chat } from '../src/ai/llm.js';
import { summarize, routingIntegrity, flavorSpread, saysRowsOf } from '../src/arena/metrics.js';
import { createBudget, estimateRun, cacheReport, thinkingNote, HAND_ESTIMATE } from '../src/arena/cost.js';
import { renderBoard } from '../src/arena/board.js';
import { catalogMap } from '../src/mods/catalog.js';

const argv = process.argv.slice(2);
// 参赛者是否显式指定了后端（`id@tag`）。**没指定就是不可复现的**：
// /endpoints 的顺序不稳定，同一条命令两次跑可能落到不同后端与量化档（实测 streamlake/fp8
// 与 novita/fp8 轮着来），跨批次比对时那就是一个偷偷变化的自变量（Q52②）。
const tagOverrideOf = (label) => {
  const id = label.replace('#nothink', '');
  return argv.some((a) => typeof a === 'string' && a.includes(`${id}@`));
};
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1]?.startsWith('--') ? true : argv[i + 1]) : dflt;
};
const has = (name) => argv.includes(`--${name}`);

// 分席供应商（2026-08-13）：默认全席走 OpenRouter；写成 `provider:id` 的那一席改走该厂自己的 API。
// 为什么要有这个口子——有些构建只在原厂端拿得到（OpenRouter 的清单里有 id 却打不通）。
// ⚠️ 代价必须写在脸上：**跨供应商的一批，版本差异与后端／量化差异是分不开的**（Q52② 反面），
// 所以 label 里带上供应商前缀，让榜上每一行自己说清楚它是从哪个口子进来的。
// 汇率只用于成本护栏的粗估（原厂按人民币计价，护栏按美元设）。**不是记账汇率**，
// 只求量级对：护栏的作用是"跑爆当场收手"，不是出账单。
const CNY_PER_USD = 7.1;
const PROVIDERS = {
  deepseek: {
    base: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_KEY',
    label: 'DeepSeek 官方 API',
    // 官网价目（2026-08-13）：缓存未命中 ¥3/M 输入、¥6/M 输出（v4-pro）；命中 ¥0.025/M。
    // 这里按未命中报价（保守，估高不估低）；实测缓存确实在命中，所以真实花费会低于估算。
    // 非思考模式关掉推理：见 nothink 字段——DeepSeek 吃 `reasoning_effort`，不吃 OpenRouter 那套信封。
    prices: { 'deepseek-v4-pro': { cny: [3, 6] }, 'deepseek-v4-flash': { cny: [1, 2] } },
    nothink: { reasoning_effort: 'none' },
  },
};
const splitProvider = (raw) => {
  const i = raw.indexOf(':');
  if (i < 0) return { provider: null, id: raw };
  const provider = raw.slice(0, i);
  if (!PROVIDERS[provider]) {
    console.error(`✗ 不认识的供应商前缀「${provider}:」（有：${Object.keys(PROVIDERS).join('、')}）`);
    process.exit(2);
  }
  return { provider, id: raw.slice(i + 1) };
};

const wantedRaw = (flag('models') && typeof flag('models') === 'string' ? flag('models').split(',') : [])
  .map((s) => s.trim())
  .filter(Boolean);
const needsOpenRouter = !wantedRaw.length || wantedRaw.some((s) => !splitProvider(s.replace('#nothink', '')).provider);

const apiKey = process.env.OPENROUTER_KEY ?? process.env.KAI_KEY;
if (!apiKey && needsOpenRouter) {
  console.error('缺 OPENROUTER_KEY（BYOK 专属，官方通道不开放擂台——Q52①）');
  process.exit(2);
}
for (const raw of wantedRaw) {
  const { provider } = splitProvider(raw.replace('#nothink', ''));
  if (provider && !process.env[PROVIDERS[provider].keyEnv]) {
    console.error(`缺 ${PROVIDERS[provider].keyEnv}（${raw} 要走 ${PROVIDERS[provider].label}）`);
    process.exit(2);
  }
}

const games = +(flag('games', 5) || 5);
const seed0 = +(flag('seed', 1000) || 1000);
const outDir = flag('out', 'docs/arena');
const capUsd = flag('cap') ? +flag('cap') : null;
const perMatchUsd = flag('per-match') ? +flag('per-match') : null;
// 并发跑场（场与场独立）。**保守默认**：开太高会撞上游限流，而限流会以超时/格式失败
// 的形式落到合规层，把"这个模型听不听话"污染成"我们打太急了"。
const concurrency = Math.max(1, +(flag('concurrency', 4) || 4));
// 对照臂：--no-relay 关掉「把对家台词转发进提示词」，其余全同
const relaySpeech = !has('no-relay');
// 记忆赛道（Q90 联赛方向）：--bestof N＝每对打两个方向的 N 场 M 胜系列赛，
// 场间携带比分、裁判层小结与蒸馏假设。⚠️ 有记忆＝顺序效应，产出不与素颜批次比较。
const bestOf = flag('bestof') ? Math.max(1, Math.floor(+flag('bestof'))) : null;
// 互相明牌（用户裁决 2026-08-11）：系列赛场间双方假设本对翻；--no-openbook 为对照臂
const openBook = !has('no-openbook');
// 海选模式：--vs <model>＝该模型坐庄，其余候选逐一对打（N 场而非 N² 场）
const vsAnchor = typeof flag('vs') === 'string' ? flag('vs').split('@')[0] : null;
// 词条实验臂：--mods qia[,liang,rang]＝把官方词条摆上桌（明牌，全席对等）。
// ⚠️ 词条改变对局物理（掐＝唯一回骰通道，对局会变长），带词条的批次**不与基础桌批次比较**。
// 产品侧词条仍按 Q43 冻结——这只是把 Q37「实验桌放开 1v1 试」跑起来，离屏采证。
const modIds = typeof flag('mods') === 'string' ? flag('mods').split(',').map((s) => s.trim()).filter(Boolean) : [];
const mods = modIds.map((id) => {
  const m = catalogMap()[id];
  if (!m) {
    console.error(`✗ 官方词条目录里没有「${id}」（有：${Object.keys(catalogMap()).join('、')}）`);
    process.exit(2);
  }
  return m;
});
if (mods.length) console.log(`词条上桌（明牌，全席对等）：${mods.map((m) => `「${m.name}」`).join('')}`);

const base = process.env.OPENROUTER_BASE ?? OPENROUTER_BASE; // 本地假服务器可覆盖（集成自测用）

console.log('拉取模型清单…（动态拉取，禁硬编易腐名单——Q52①）');
const live = await fetchModels({ base }); // 清单是公开的，不必拿钥匙去换
console.log(`清单 ${live.length} 个纯文本模型`);

// 参赛名单
let wanted = [...wantedRaw];
if (!wanted.length && flag('cheap')) {
  const n = +flag('cheap');
  wanted = live
    .filter((m) => !m.free && m.priceKnown && m.promptPrice > 0 && (m.contextLength ?? 0) >= 32000)
    .sort((a, b) => a.promptPrice + a.completionPrice - (b.promptPrice + b.completionPrice))
    .slice(0, n)
    .map((m) => m.id);
  console.log(`便宜档自动选：${wanted.join(', ')}`);
}
if (!wanted.length) {
  const d = pickDefaults(live);
  console.error(
    `没给 --models。清单里现有的常见款：\n  ${d.map((m) => m.id).join('\n  ') || '（一个都没对上，清单变过了）'}\n` +
      '用 --models a,b,c 指定，或 --cheap N 自动选便宜档。',
  );
  process.exit(2);
}

// 解析参赛者：价格、后端锁、思考型标注。
// 语法 id[@tag][#nothink]——#nothink＝显式关闭推理（推理开关实验臂），标签带后缀单独成行。
const entrants = [];
for (const raw of wanted) {
  const noThink = raw.includes('#nothink');
  const { provider, id: idPart } = splitProvider(raw.replace('#nothink', ''));
  // 原厂端：不查 OpenRouter 清单（那是另一家的货架），也没有后端可锁——只有一个口子。
  // 价格从 /models 拿不到，因此按"价格不定"上报：估算会点名少算了谁，不许悄悄按 0 算。
  if (provider) {
    const p = PROVIDERS[provider];
    const channel = {
      baseUrl: p.base,
      apiKey: process.env[p.keyEnv],
      model: idPart,
      format: 'openai',
      providerTag: null,
    };
    // #nothink 的关法各家不同：OpenRouter 用 `reasoning:{enabled:false}` 信封，
    // DeepSeek 原厂端不认那个字段（实测被忽略），认的是 `reasoning_effort:'none'`。
    if (noThink) channel.extra = { ...channel.extra, ...(p.nothink ?? {}) };
    const cny = p.prices?.[idPart]?.cny ?? null;
    entrants.push({
      label: `${provider}:${idPart}` + (noThink ? '#nothink' : ''),
      price: cny
        ? { priceKnown: true, promptPrice: cny[0] / 1e6 / CNY_PER_USD, completionPrice: cny[1] / 1e6 / CNY_PER_USD }
        : { priceKnown: false },
      channel,
      endpoints: [],
      meta: {
        tag: null,
        quant: null,
        provider,
        providerBase: p.base,
        thinking: null,
        reasoningRequested: noThink ? 'off' : 'native',
      },
    });
    console.log(
      `  · ${provider}:${idPart}　${p.label}　` +
        (cny ? `¥${cny[0]}/¥${cny[1]} 每百万（官网价，按缓存未命中估）` : '价格不定（原厂端不报价）') +
        `　后端＝原厂唯一口${noThink ? '　非思考档' : ''}`,
    );
    continue;
  }
  const [id, tagOverride] = idPart.split('@');
  const model = live.find((m) => m.id === id);
  if (!model) {
    console.error(`✗ 清单里没有 ${id}（拼错了，或它下架了）`);
    process.exit(2);
  }
  let tag = tagOverride ?? null;
  let quant = null;
  let endpoints = [];
  if (!tag) {
    try {
      endpoints = await fetchEndpoints(id, { base });
      tag = endpoints[0]?.tag ?? null;
      quant = endpoints[0]?.quantization ?? null;
    } catch {
      console.warn(`  ! ${id} 拉不到 endpoint 清单，本次不锁后端（方差里可能混后端差异）`);
    }
  }
  // 擂台预算，不是产品预算（见 arena.js 的 MAX_TOKENS/REASONING_TOKENS 注释）
  const channel = openrouterChannel({
    apiKey, model: id, modelInfo: model, providerTag: tag, base,
    budget: { completionTokens: MAX_TOKENS, reasoningTokens: REASONING_TOKENS },
  });
  if (noThink) {
    // 推理开关臂：OpenRouter 统一口径显式关推理；chat() 会据此不再下发推理信封
    channel.extra = { ...channel.extra, reasoning: { enabled: false } };
    delete channel.reasoningProfile;
  }
  entrants.push({
    label: id + (noThink ? '#nothink' : ''),
    price: model,
    channel,
    endpoints, // 体检轮换用：首选端点可能在你的数据策略下不可达
    meta: {
      tag,
      quant,
      thinking: thinkingNote(model),
      // 溯源：这一席"要求的"推理形态；"实际的"（回执 reasoningTokens）跑完由 run.json 汇总
      reasoningRequested: noThink ? 'off' : channel.reasoningProfile ? `native+budget${channel.reasoningProfile.maxTokens}` : 'native',
    },
  });
  console.log(
    `  · ${id}　${model.priceKnown ? `$${(model.promptPrice * 1e6).toFixed(2)}/$${(model.completionPrice * 1e6).toFixed(2)} 每百万` : '价格不定'}` +
      `${tag ? `　后端锁 ${tag}${quant ? `(${quant})` : ''}` : '　后端未锁'}${model.reasoning ? `　${thinkingNote(model)}` : ''}`,
  );
  // 价格不定 ≈ 路由型元模型：每手可能落到不同底模，方差里混的就不只是后端了
  if (!model.priceKnown)
    console.warn(`    ⚠️ ${id} 价格不定，多半是路由型元模型——上擂台前想清楚：它每手可能换一个底模，数据不可比。`);
}

// ---- 参赛体检（Q91）：用**钉死的那套设置**各发一发试试 ----
// 不再强制关闭推理：那会压平思考型模型的原生特征，有的型号还会直接 400 拒绝。
// 体检仍使用真实比赛请求，避免沉默 bot 替失败型号上榜。
// 打不通就当场淘汰：**宁可少一个参赛者，也不许让沉默 bot 顶着别人的名字上榜。**
console.log('\n参赛体检（用钉死的设置各发一发）…');
const fit = [];
for (const e of entrants) {
  // 后端清单**不按账号的数据策略过滤**：`/endpoints` 列的第一个端点，
  // 在你的账号下可能压根不可达（实测 deepseek/deepseek-v4-pro 的首选端点 404）。
  // 所以体检兼做选端点：锁不通就换下一个，**换到通为止，但仍然锁死并记下来**。
  const tags = [e.meta.tag, ...(e.endpoints ?? []).map((x) => x.tag)].filter(
    (t, i, a) => t && a.indexOf(t) === i,
  );
  let ok = false;
  let lastErr = null;
  // 每个端点给两次机会：单发体检会让候选死于一次抽风（实测 qwen3.7-plus 上轮干净打完、
  // 本轮体检回了句怪话就被淘汰）——比赛里同样的失败有沉默兜底，体检不该比比赛更脆。
  for (const tag of (tags.length ? tags : [null]).flatMap((t) => [t, t])) {
    const ch = { ...e.channel, providerTag: tag };
    try {
      const pinned = pinSampling(ch);
      const raw = await chat(pinned, {
        system: '连通测试。严格输出一行 JSON：{"ok":true}',
        user: '输出指定 JSON。',
        maxTokens: MAX_TOKENS,
        timeoutMs: TIMEOUT_MS,
        extra: pinned.decisionExtra,
      });
      // 体检的宽容度必须与真实对局一致：parseDecision 本就容忍 ```json 围栏与前后缀，
      // 体检用严格 JSON.parse 会误杀能正常上场的模型（实测 kimi-k2 因围栏被淘汰）。
      if (JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? 'null')?.ok !== true) throw new Error('health bad json');
      if (tag !== e.meta.tag)
        console.log(`  ! ${e.label} 首选后端 ${e.meta.tag} 不可达，改锁 ${tag}`);
      e.channel = ch;
      e.meta.tag = tag;
      console.log(
        `  ✓ ${e.label}${e.meta.provider ? `（${PROVIDERS[e.meta.provider].label}，原厂唯一口）` : tag ? `（锁 ${tag}）` : '（未锁后端）'}` +
          (e.meta.provider || tagOverrideOf(e.label) ? '' : tag ? `　← 未显式指定，本次自动选中；要复现这一批请写 ${e.label}@${tag}` : ''),
      );
      ok = true;
      break;
    } catch (err) {
      lastErr = err?.message ?? String(err);
    }
  }
  if (!ok) {
    console.error(`  ✗ ${e.label} 打不通：${lastErr}`);
    console.error(
      e.meta.provider
        ? `    → 淘汰。原厂端只有一个口，打不通就是 key、模型名或该端点本身的问题（${e.meta.providerBase}）。`
        : '    → 淘汰。若是 400，多半它不接受钉死的采样参数；' +
            '若是 404，是所有后端在你的数据策略下都不可达（见 openrouter.ai/settings/privacy）。',
    );
  } else fit.push(e);
}
if (fit.length < 2) {
  console.error('\n能参赛的不足 2 个，跑不成。');
  process.exit(2);
}
entrants.length = 0;
entrants.push(...fit);

let pairs;
if (vsAnchor) {
  const a = entrants.find((e) => e.label === vsAnchor);
  if (!a) {
    console.error(`--vs ${vsAnchor} 不在（或没通过体检的）参赛名单里`);
    process.exit(2);
  }
  pairs = entrants.filter((e) => e !== a).map((c) => [a, c]);
  console.log(`海选模式：${a.label} 坐庄，${pairs.length} 位候选逐一对打`);
} else {
  pairs = roundRobin(entrants);
}
const est = estimateRun({ pairs, games: bestOf ?? games });
console.log(
  bestOf
    ? `\n预估（记忆赛道上界）：${pairs.length} 对 × 双向 × 至多 ${bestOf} 场 = ≤${est.matches} 场 / ≤${est.calls} 次调用　**约 $${est.usd}**（${est.note}；提前分出胜负会少打）`
    : `\n预估：${pairs.length} 对 × ${games} 组镜像 = ${est.matches} 场 / ${est.calls} 次调用　**约 $${est.usd}**（${est.note}）` +
        `\n并发 ${concurrency} 场（--concurrency 可改；开太高会把上游限流拍进合规层）`,
);
if (capUsd) console.log(`整批上限 $${capUsd}${perMatchUsd ? `　单场上限 $${perMatchUsd}` : ''}`);
if (!has('yes')) {
  console.log('\n这是预演。确认要花这笔钱就加 --yes（建议同时加 --cap 与 --per-match）。');
  process.exit(0);
}

const budget = createBudget({ capUsd, perMatchUsd });
// 逐场增量落盘：每场打完立即把台词与留档写进 live/，中途就能翻牌（跑完后的正式产物不变）
const liveDir = `${outDir}/.live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
mkdirSync(liveDir, { recursive: true });
const dumpLive = (m) => {
  const lines = [`# ${m.seats.A} vs ${m.seats.B}（seed ${m.seed}${m.aborted ? `，中断:${m.aborted}` : ''}）`, ''];
  for (const s of ['A', 'B']) {
    lines.push(`## ${m.seats[s]}（座 ${s}）`);
    for (const l of m.logs[s] ?? []) {
      if (l.auto) continue;
      lines.push(`- 第${l.round}局 ${JSON.stringify(l.action)}${l.say ? `　说：「${l.say}」` : '　（没说话）'}${l.speechMode === 'bait' ? '〔诈〕' : ''}`);
      if (l.belief) lines.push(`  想：${l.belief.slice(0, 200)}`);
    }
    lines.push('');
  }
  writeFileSync(`${liveDir}/match-${m.seed}-${m.seats.A.split('/').pop()}.md`, lines.join('\n'));
};
let done = 0;
let matches;
let seriesResults = null;
if (bestOf) {
  console.log(`\n记忆赛道开跑：系列赛内跨场携带比分与假设（产出不作统计断言、不与素颜批次比较——Q90）。`);
  const jobs = pairs.flatMap(([x, y]) => [{ A: x, B: y }, { A: y, B: x }]); // 双向＝先手差各吃一遍
  const out = new Array(jobs.length).fill(null);
  let nextJob = 0;
  const worker = async () => {
    while (true) {
      const i = nextJob++;
      if (i >= jobs.length || budget.runExceeded()) return;
      const s = await playSeries({ seed0, bestOf, seats: jobs[i], budget, relaySpeech, openBook, mods, onGame: dumpLive });
      out[i] = s;
      console.log(
        `[系列赛] ${s.seats.A} ${s.wins.A}–${s.wins.B} ${s.seats.B}（${s.games.length} 场）→ ` +
          `${s.winner ? `${s.seats[s.winner]} 拿下` : '未分出'}　实花 $${budget.spent()}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  seriesResults = out.filter(Boolean);
  matches = seriesResults.flatMap((s) => s.games);
} else {
  matches = await runArena({
    pairs,
    games,
    seed0,
    budget,
    concurrency,
    relaySpeech,
    mods,
    onMatch: (m) => {
      dumpLive(m);
      done += 1;
      const line =
        `跑完 ${done}/${est.matches} 场　实花 $${budget.spent()}　` +
        `${m.aborted ? `[中断:${m.aborted}] ` : ''}${m.seats.A} vs ${m.seats.B} → ${m.seats[m.winner] ?? '未终局'}`;
      // TTY 上原地刷新好看；**管道里必须换行**——否则 node 会把 \r 全缓冲住，
      // 跑一个小时输出文件还是 0 字节，只能靠查账单反推进度（2026-08-10 实测踩过）。
      if (process.stdout.isTTY) process.stdout.write(`\r${line}   `);
      else console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
    },
  });
}
console.log('');
if (budget.exceeded()) console.log(`⚠️ 刹车触发：${budget.reason()}`);

const rows = summarize(matches);
const integrity = routingIntegrity(rows);
const spread = flavorSpread(rows);
const cache = cacheReport(rows);
const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
const memoryNote = bestOf
  ? `> ⚠️ **记忆赛道**（--bestof ${bestOf}）：系列赛内跨场携带比分与假设，有记忆＝顺序效应。本榜数字**不作统计断言、不与素颜批次比较**（Q90 两本账不混流）。\n\n`
  : '';
const board =
  memoryNote +
  renderBoard(rows, {
    run: {
      seed0, games: bestOf ?? games, at, sampling: SAMPLING, maxTokens: MAX_TOKENS, concurrency, relaySpeech,
      mods: mods.map((m) => m.name),
      channels: entrants.map((e) => ({
        label: e.label,
        origin: e.meta.provider ? PROVIDERS[e.meta.provider].label : 'OpenRouter',
        tag: e.meta.tag ?? null,
        note: e.meta.provider ? '原厂唯一口，无后端可锁' : null,
      })),
    },
    integrity,
    cache,
    spread,
    estimate: est,
  });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = `${outDir}/${stamp}`;
mkdirSync(dir, { recursive: true });

// 台词全量留样（G2 之后由人来评——排期：台词质量评估须等接地批次 G2）。
// 说的一套、想的一套并排放，跟复盘室「他的小本子」同一个口径：真迹不可赛后重写。
const lines = ['# 台词留样（未评分）', '', '> 台词质量评估须等接地批次 G2 完成。这里只留样：左＝他说的，右＝他当时留的档。', ''];
for (const m of matches) {
  for (const s of ['A', 'B']) {
    const said = (m.logs[s] ?? []).filter((l) => !l.auto && l.say);
    if (!said.length) continue;
    lines.push(`## ${m.seats[s]}　（seed ${m.seed}，座 ${s}，对手 ${m.seats[s === 'A' ? 'B' : 'A']}）`);
    for (const l of said)
      lines.push(`- 第${l.round}局：「${l.say}」${l.speechMode === 'bait' ? ' 〔诈〕' : ''}${l.belief ? `　心里：${l.belief}` : ''}`);
    lines.push('');
  }
}
writeFileSync(`${dir}/lines.md`, lines.join('\n'));

// 系列赛战报（记忆赛道专属）：比分、逐场、假设演化——"它学到了什么"直接可读
if (seriesResults) {
  const md = ['# 系列赛战报（记忆赛道）', '', memoryNote.trim(), '', `互相明牌：${openBook ? '开（场间双方假设本对翻）' : '关（对照臂）'}`, ''];
  for (const s of seriesResults) {
    md.push(`## ${s.seats.A} vs ${s.seats.B}（${s.seats.A} 先手）`);
    md.push(`比分 **${s.wins.A}–${s.wins.B}**，${s.winner ? `**${s.seats[s.winner]}** 拿下系列赛` : '未分出（中断或预算触顶）'}`);
    s.games.forEach((g, i) => {
      const end = g.events.at(-1);
      md.push(`- 第${i + 1}场（seed ${g.seed}）：${g.winner ? `${g.seats[g.winner]} 胜` : '未终局'}，${end?.rounds ?? '?'} 局${g.aborted ? `（中断:${g.aborted}）` : ''}`);
    });
    for (const id of ['A', 'B']) {
      const t = s.hypothesesTrail[id];
      if (!t?.length) continue;
      md.push(`\n${s.seats[id]} 的场间假设演化：`);
      t.forEach((hyps, i) => {
        md.push(`- 第${i + 1}场后：${hyps.length ? hyps.map((h) => `「${h.text}」（证据${h.hits}${h.misses?.length ? `，反例 ${h.misses.length}` : ''}）`).join('；') : '（没形成假设）'}`);
      });
    }
    md.push('');
  }
  writeFileSync(`${dir}/series.md`, md.join('\n'));
}

// 溯源（可复现三件）：代码位＋提示词版本与哈希——跨批可比性先验这三个字段
const gitCommit = (() => {
  try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return null; }
})();
const systemPromptHash = createHash('sha256').update(seatSystem(false)).digest('hex').slice(0, 16);
// 每席"实际的"推理形态：从回执 reasoningTokens 汇总（承诺不算数，回执才算——A2 同款纪律）
const reasoningActualOf = (label) => {
  const toks = [];
  let hands = 0;
  for (const m of matches)
    for (const s of ['A', 'B']) {
      if (m.seats[s] !== label) continue;
      for (const l of m.logs[s] ?? []) {
        if (l.auto || !l.meta) continue;
        hands += 1;
        const r = l.meta.reasoningTokens ?? 0;
        if (r > 0) toks.push(r);
      }
    }
  toks.sort((a, b) => a - b);
  return {
    hands,
    reasoningShare: hands ? +(toks.length / hands).toFixed(2) : null,
    medianReasoningTokens: toks.length ? toks[(toks.length - 1) >> 1] : 0,
  };
};

// 逐句制品（分类管线的输入）：lineId 全批唯一（含对局序号），构造与唯一性断言统一在 metrics.saysRowsOf
const saysRows = saysRowsOf(matches);
writeFileSync(`${dir}/says.jsonl`, saysRows.map((r) => JSON.stringify(r)).join('\n'));

writeFileSync(
  `${dir}/run.json`,
  JSON.stringify(
    {
      at,
      provenance: { gitCommit, promptVersion: PROMPT_VERSION, systemPromptHash },
      entrants: entrants.map((e) => ({ label: e.label, ...e.meta, reasoningActual: reasoningActualOf(e.label) })),
      setup: { sampling: SAMPLING, maxTokens: MAX_TOKENS, games, seed0, concurrency, relaySpeech, bestOf, openBook, vsAnchor, mods: modIds, handEstimate: HAND_ESTIMATE },
      series: seriesResults?.map((s) => ({
        seats: s.seats,
        bestOf: s.bestOf,
        wins: s.wins,
        winner: s.winner,
        games: s.games.map((g) => ({ seed: g.seed, winner: g.winner, aborted: g.aborted })),
        hypothesesTrail: s.hypothesesTrail,
      })) ?? null,
      estimate: est,
      spent: budget.spent(),
      integrity,
      cache,
      rows,
      matches: matches.map((m) => ({
        seed: m.seed,
        seats: m.seats,
        winner: m.winner,
        over: m.over,
        aborted: m.aborted,
        rejects: m.rejects,
        events: m.events,
        logs: m.logs, // 决策日志全留（含 belief／留档）——散场后不许重写，只许翻
      })),
    },
    null,
    1,
  ),
);
writeFileSync(`${dir}/board.md`, board);
console.log(board);
console.log(
  `\n落盘：${dir}/board.md（榜）　${dir}/lines.md（台词留样）${seriesResults ? `　${dir}/series.md（系列赛战报）` : ''}　${dir}/run.json（全量事件与决策日志，不入库）`,
);
if (!integrity.ok) process.exit(1);
