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
import { runArena, roundRobin, SAMPLING, MAX_TOKENS } from '../src/arena/arena.js';
import { summarize, routingIntegrity, flavorSpread } from '../src/arena/metrics.js';
import { createBudget, estimateRun, cacheReport, thinkingNote, HAND_ESTIMATE } from '../src/arena/cost.js';
import { renderBoard } from '../src/arena/board.js';

const argv = process.argv.slice(2);
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
  if (!tag) {
    try {
      const eps = await fetchEndpoints(id, { base });
      tag = eps[0]?.tag ?? null;
      quant = eps[0]?.quantization ?? null;
    } catch {
      console.warn(`  ! ${id} 拉不到 endpoint 清单，本次不锁后端（方差里可能混后端差异）`);
    }
  }
  entrants.push({
    label: id,
    price: model,
    channel: openrouterChannel({ apiKey, model: id, providerTag: tag, base }),
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

const pairs = roundRobin(entrants);
const est = estimateRun({ pairs, games });
console.log(
  `\n预估：${pairs.length} 对 × ${games} 组镜像 = ${est.matches} 场 / ${est.calls} 次调用　**约 $${est.usd}**（${est.note}）`,
);
if (capUsd) console.log(`整批上限 $${capUsd}${perMatchUsd ? `　单场上限 $${perMatchUsd}` : ''}`);
if (!has('yes')) {
  console.log('\n这是预演。确认要花这笔钱就加 --yes（建议同时加 --cap 与 --per-match）。');
  process.exit(0);
}

const budget = createBudget({ capUsd, perMatchUsd });
let done = 0;
const matches = await runArena({
  pairs,
  games,
  seed0,
  budget,
  onMatch: (m) => {
    done += 1;
    process.stdout.write(
      `\r跑完 ${done}/${est.matches} 场　实花 $${budget.spent()}　` +
        `${m.aborted ? `[中断:${m.aborted}] ` : ''}${m.seats.A} vs ${m.seats.B} → ${m.winner ?? '未终局'}   `,
    );
  },
});
console.log('');
if (budget.exceeded()) console.log(`⚠️ 刹车触发：${budget.reason()}`);

const rows = summarize(matches);
const integrity = routingIntegrity(rows);
const spread = flavorSpread(rows);
const cache = cacheReport(rows);
const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
const board = renderBoard(rows, {
  run: { seed0, games, at, sampling: SAMPLING, maxTokens: MAX_TOKENS },
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

writeFileSync(
  `${dir}/run.json`,
  JSON.stringify(
    {
      at,
      entrants: entrants.map((e) => ({ label: e.label, ...e.meta })),
      setup: { sampling: SAMPLING, maxTokens: MAX_TOKENS, games, seed0, handEstimate: HAND_ESTIMATE },
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
console.log(`\n落盘：${dir}/board.md（榜）　${dir}/lines.md（台词留样）　${dir}/run.json（全量事件与决策日志，不入库）`);
if (!integrity.ok) process.exit(1);
