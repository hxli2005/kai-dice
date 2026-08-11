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
import { fetchModels, fetchEndpoints, openrouterChannel, pickDefaults, OPENROUTER_BASE } from '../src/ai/openrouter.js';
import { runArena, roundRobin, playSeries, SAMPLING, MAX_TOKENS, TIMEOUT_MS, pinSampling } from '../src/arena/arena.js';
import { chat } from '../src/ai/llm.js';
import { summarize, routingIntegrity, flavorSpread } from '../src/arena/metrics.js';
import { createBudget, estimateRun, cacheReport, thinkingNote, HAND_ESTIMATE } from '../src/arena/cost.js';
import { renderBoard } from '../src/arena/board.js';

const argv = process.argv.slice(2);
// 参赛者是否显式指定了后端（`id@tag`）。**没指定就是不可复现的**：
// /endpoints 的顺序不稳定，同一条命令两次跑可能落到不同后端与量化档（实测 streamlake/fp8
// 与 novita/fp8 轮着来），跨批次比对时那就是一个偷偷变化的自变量（Q52②）。
const tagOverrideOf = (label) =>
  argv.some((a) => typeof a === 'string' && a.includes(`${label}@`));
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1]?.startsWith('--') ? true : argv[i + 1]) : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const apiKey = process.env.OPENROUTER_KEY ?? process.env.KAI_KEY;
if (!apiKey) {
  console.error('缺 OPENROUTER_KEY（BYOK 专属，官方通道不开放擂台——Q52①）');
  process.exit(2);
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

const base = process.env.OPENROUTER_BASE ?? OPENROUTER_BASE; // 本地假服务器可覆盖（集成自测用）

console.log('拉取模型清单…（动态拉取，禁硬编易腐名单——Q52①）');
const live = await fetchModels({ base }); // 清单是公开的，不必拿钥匙去换
console.log(`清单 ${live.length} 个纯文本模型`);

// 参赛名单
let wanted = (flag('models') && typeof flag('models') === 'string' ? flag('models').split(',') : [])
  .map((s) => s.trim())
  .filter(Boolean);
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

// 解析参赛者：价格、后端锁、思考型标注
const entrants = [];
for (const raw of wanted) {
  const [id, tagOverride] = raw.split('@');
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
  entrants.push({
    label: id,
    price: model,
    channel: openrouterChannel({ apiKey, model: id, modelInfo: model, providerTag: tag, base }),
    endpoints, // 体检轮换用：首选端点可能在你的数据策略下不可达
    meta: { tag, quant, thinking: thinkingNote(model) },
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
  for (const tag of tags.length ? tags : [null]) {
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
        `  ✓ ${e.label}${tag ? `（锁 ${tag}）` : '（未锁后端）'}` +
          (tagOverrideOf(e.label) ? '' : tag ? `　← 未显式指定，本次自动选中；要复现这一批请写 ${e.label}@${tag}` : ''),
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
      '    → 淘汰。若是 400，多半它不接受钉死的采样参数；' +
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
      const s = await playSeries({ seed0, bestOf, seats: jobs[i], budget, relaySpeech, openBook });
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
    onMatch: (m) => {
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
    run: { seed0, games: bestOf ?? games, at, sampling: SAMPLING, maxTokens: MAX_TOKENS, concurrency, relaySpeech },
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

writeFileSync(
  `${dir}/run.json`,
  JSON.stringify(
    {
      at,
      entrants: entrants.map((e) => ({ label: e.label, ...e.meta })),
      setup: { sampling: SAMPLING, maxTokens: MAX_TOKENS, games, seed0, concurrency, relaySpeech, bestOf, openBook, vsAnchor, handEstimate: HAND_ESTIMATE },
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
