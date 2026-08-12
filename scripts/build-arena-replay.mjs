// 公开实录与本桌榜的生成器（Q93）。
//
// 输入＝素颜擂台的原始跑批（`run.json`，大且只对本机有用，按仓库规则不入库）；
// 输出＝两件可发布的制品：
//   docs/arena/verified-replay.json  逐手复盘用的裁剪实录（引擎事件＋原话＋当时留档）
//   docs/arena/verified-board.json   本桌榜的数据（干净集 22 臂 ＋ 机算风味层）
//
// 干净集 v2（docs/arena/clean-2026-08-12.md）是**人的裁定**：哪几臂算数、用哪一批的数据、
// 三档怎么分。脚本不重新发明这些，只照单抓取；但**战绩与顶班分级由脚本从原始数据重算**，
// 与已发布的干净集逐格对账——对不上就吵，不许悄悄发一份和文档不一样的榜。
//
// 用法：npm run arena:archive
//      node scripts/build-arena-replay.mjs <单批目录> <输出文件>   （临时单批模式）

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { groundEvents } from '../src/grounding.js';
import { summarize } from '../src/arena/metrics.js';

const ROOT = 'docs/arena';

// 干净集 v2 的选臂表：每组对手用哪一批。R2（12-32-32）只取 Gemini/K3 两臂，
// Mistral/Haiku 臂以 R2补（16-49-50）替换——这是干净集文档里写明的裁定。
const CLEAN_SET = {
  source: 'clean-2026-08-12.md',
  date: '2026-08-11',
  pairs: [
    { batch: '2026-08-11T16-13-08', a: 'anthropic/claude-haiku-4.5', b: 'deepseek/deepseek-v4-pro' },
    { batch: '2026-08-11T16-13-08', a: 'deepseek/deepseek-v4-pro', b: 'google/gemini-3.6-flash' },
    { batch: '2026-08-11T16-13-08', a: 'deepseek/deepseek-v4-pro', b: 'openai/gpt-5.6-luna' },
    { batch: '2026-08-11T16-13-08', a: 'deepseek/deepseek-v4-pro', b: 'openai/gpt-5.6-luna#nothink' },
    { batch: '2026-08-11T16-13-08', a: 'deepseek/deepseek-v4-pro', b: 'moonshotai/kimi-k3' },
    { batch: '2026-08-11T16-13-08', a: 'deepseek/deepseek-v4-pro', b: 'mistralai/mistral-small-2603' },
    { batch: '2026-08-11T12-32-32', a: 'google/gemini-3.6-flash', b: 'openai/gpt-5.6-luna' },
    { batch: '2026-08-11T12-32-32', a: 'moonshotai/kimi-k3', b: 'openai/gpt-5.6-luna' },
    { batch: '2026-08-11T16-27-43', a: 'moonshotai/kimi-k3', b: 'openai/gpt-5.6-luna#nothink' },
    { batch: '2026-08-11T16-49-50', a: 'anthropic/claude-haiku-4.5', b: 'openai/gpt-5.6-luna' },
    { batch: '2026-08-11T16-49-50', a: 'mistralai/mistral-small-2603', b: 'openai/gpt-5.6-luna' },
  ],
};

// 干净集已发布的战绩与分级（用于对账，不用于出榜——出榜的数字由脚本重算）。
// 键＝`模型|对手`，值＝[净, 轻, 污, 原始胜, 零顶班胜, 零顶班负, 主观率%, ±]
const PUBLISHED = {
  'anthropic/claude-haiku-4.5|deepseek/deepseek-v4-pro': [3, 1, 0, 0, 0, 3, 26, 21],
  'anthropic/claude-haiku-4.5|openai/gpt-5.6-luna': [2, 2, 0, 0, 0, 2, 57, 16],
  'deepseek/deepseek-v4-pro|anthropic/claude-haiku-4.5': [3, 1, 0, 4, 3, 0, 59, 9],
  'deepseek/deepseek-v4-pro|google/gemini-3.6-flash': [2, 0, 2, 1, 1, 1, 62, 19],
  'deepseek/deepseek-v4-pro|openai/gpt-5.6-luna': [4, 0, 0, 3, 3, 1, 50, 17],
  'deepseek/deepseek-v4-pro|openai/gpt-5.6-luna#nothink': [4, 0, 0, 2, 2, 2, 42, 22],
  'deepseek/deepseek-v4-pro|moonshotai/kimi-k3': [2, 2, 0, 2, 2, 0, 73, 16],
  'deepseek/deepseek-v4-pro|mistralai/mistral-small-2603': [3, 1, 0, 4, 3, 0, 65, 22],
  'google/gemini-3.6-flash|deepseek/deepseek-v4-pro': [2, 0, 2, 3, 1, 1, 60, 13],
  'google/gemini-3.6-flash|openai/gpt-5.6-luna': [4, 0, 0, 2, 2, 2, 60, 26],
  'openai/gpt-5.6-luna|anthropic/claude-haiku-4.5': [2, 2, 0, 4, 2, 0, 44, 24],
  'openai/gpt-5.6-luna|deepseek/deepseek-v4-pro': [4, 0, 0, 1, 1, 3, 33, 12],
  'openai/gpt-5.6-luna|google/gemini-3.6-flash': [4, 0, 0, 2, 2, 2, 26, 15],
  'openai/gpt-5.6-luna|moonshotai/kimi-k3': [3, 0, 1, 2, 1, 2, 57, 22],
  'openai/gpt-5.6-luna|mistralai/mistral-small-2603': [4, 0, 0, 3, 3, 1, 47, 14],
  'openai/gpt-5.6-luna#nothink|deepseek/deepseek-v4-pro': [4, 0, 0, 2, 2, 2, 47, 18],
  'openai/gpt-5.6-luna#nothink|moonshotai/kimi-k3': [3, 1, 0, 2, 2, 1, 19, 24],
  'moonshotai/kimi-k3|deepseek/deepseek-v4-pro': [2, 2, 0, 2, 0, 2, 77, 18],
  'moonshotai/kimi-k3|openai/gpt-5.6-luna': [3, 0, 1, 2, 2, 1, 81, 35],
  'moonshotai/kimi-k3|openai/gpt-5.6-luna#nothink': [3, 1, 0, 2, 1, 2, 87, 14],
  'mistralai/mistral-small-2603|deepseek/deepseek-v4-pro': [3, 1, 0, 0, 0, 3, 78, 19],
  'mistralai/mistral-small-2603|openai/gpt-5.6-luna': [4, 0, 0, 1, 1, 3, 65, 17],
};

// G2：主客体（actor/target）随事件一起进公开实录——谁开谁不留给读者去猜。
// round/action 由载入侧的 groundEvents 按报价梯还原，不占公开档的体积。
const eventFields = {
  roundStart: ['type', 'round', 'first'],
  peek: ['type', 'actor'],
  calc: ['type', 'actor'],
  bid: ['type', 'actor', 'count', 'face'],
  declare: ['type', 'actor', 'declaration'],
  challenge: ['type', 'actor', 'target'],
  reveal: ['type', 'actor', 'target', 'actual', 'bid', 'stands', 'loser'],
  roundEnd: ['type'],
  matchEnd: ['type', 'winner'],
  modAction: ['type', 'actor', 'target', 'action', 'op'],
};

const pick = (value, fields) => Object.fromEntries(
  fields.filter((field) => value?.[field] != null).map((field) => [field, value[field]]),
);

const readRun = (batch) => {
  const file = `${ROOT}/${batch}/run.json`;
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(run.matches)) throw new Error(`${file} 没有 matches 数组`);
  return run;
};

const pairKey = (x, y) => [x, y].sort().join('|');
const trimMatch = (match, batch) => ({
  seed: match.seed,
  seats: match.seats,
  winner: match.winner,
  batch,
  ...(match.aborted ? { aborted: match.aborted } : {}),
  // 先接地再裁剪：G2 之前跑出来的 run.json 用 {player} 且不带 target，这里一次补齐
  events: groundEvents(match.events ?? []).map((event) => pick(event, eventFields[event.type] ?? ['type'])),
  logs: Object.fromEntries(['A', 'B'].map((seat) => [
    seat,
    (match.logs?.[seat] ?? []).map((log) => pick(log, ['say', 'belief', 'silentFallback'])),
  ])),
});

// 顶班率＝这场里两席合计有多少手是沉默 bot 代打的（干净集的"对局双方合计口径"）。
// 三档：0＝净、≤5%＝轻、>5%＝污。
function relayRate(match) {
  const hands = ['A', 'B'].flatMap((seat) => match.logs?.[seat] ?? []);
  if (!hands.length) return 0;
  return hands.filter((log) => log.silentFallback).length / hands.length;
}
const gradeOf = (rate) => (rate === 0 ? 'clean' : rate <= 0.05 ? 'light' : 'spoiled');

// 单批模式：保持原来的行为（临时看某一批用）
function buildSingle(source, target) {
  const run = readRun(path.basename(path.dirname(`${source}/x`)));
  const output = {
    schema: 'kai.arena.public-replay.v1',
    source: path.basename(source),
    scope: '在这张桌子上',
    matches: run.matches.map((match) => trimMatch(match, path.basename(source))),
  };
  fs.writeFileSync(target, `${JSON.stringify(output)}\n`);
  console.log(`公开复盘：${output.matches.length} 场，${fs.statSync(target).size} bytes → ${target}`);
}

function buildCleanSet() {
  const matches = [];
  const full = []; // 未裁剪的原始对局：风味层要读骰面才能判"报这口时他自己看到了什么"
  const arms = [];
  const mismatches = [];
  const runs = new Map();

  for (const pair of CLEAN_SET.pairs) {
    if (!runs.has(pair.batch)) runs.set(pair.batch, readRun(pair.batch));
    const key = pairKey(pair.a, pair.b);
    const picked = runs.get(pair.batch).matches.filter((m) => pairKey(m.seats.A, m.seats.B) === key);
    if (picked.length !== 4)
      throw new Error(`${pair.batch} 的 ${key} 应有 4 场，实得 ${picked.length}`);

    const graded = picked.map((m) => ({ m, grade: gradeOf(relayRate(m)) }));
    for (const { m } of graded) {
      matches.push(trimMatch(m, pair.batch));
      // 风味层要读骰面，所以留一份未裁剪的；但事件必须先接地——
      // 这些 run.json 是 G2 之前跑的，用 {player}，不迁移的话统计一口报价都数不出来
      full.push({ ...m, events: groundEvents(m.events ?? []) });
    }

    // 一组对局出两行（各自站在自己那边看）——干净集就是这么排的
    for (const [model, opponent] of [[pair.a, pair.b], [pair.b, pair.a]]) {
      const won = (m) => m.winner != null && m.seats[m.winner] === model;
      const clean = graded.filter((g) => g.grade === 'clean');
      const row = {
        model,
        opponent,
        batch: pair.batch,
        matches: graded.length,
        grades: {
          clean: clean.length,
          light: graded.filter((g) => g.grade === 'light').length,
          spoiled: graded.filter((g) => g.grade === 'spoiled').length,
        },
        record: [graded.filter((g) => won(g.m)).length, graded.filter((g) => !won(g.m)).length],
        cleanRecord: [clean.filter((g) => won(g.m)).length, clean.filter((g) => !won(g.m)).length],
      };
      const pub = PUBLISHED[`${model}|${opponent}`];
      if (pub) {
        row.subjectivity = { rate: pub[6] / 100, spread: pub[7] / 100, n: 4 }; // 逐句制品，来自干净集文档
        const got = [row.grades.clean, row.grades.light, row.grades.spoiled, row.record[0], row.cleanRecord[0], row.cleanRecord[1]];
        const want = pub.slice(0, 6);
        if (got.join(',') !== want.join(','))
          mismatches.push(`${model} vs ${opponent}：脚本重算 ${got.join('/')}，干净集文档 ${want.join('/')}`);
      } else mismatches.push(`${model} vs ${opponent}：干净集文档里没有这一行`);
      arms.push(row);
    }
  }

  // 风味层由 metrics.js 现算（含 G7 新拆的「明知」一列），不抄文档
  const flavor = summarize(full)
    .map((r) => ({
      model: r.label ?? r.model,
      bluffRate: r.flavor.bluffRate,
      knowingBluffRate: r.flavor.knowingBluffRate,
      blindBidRate: r.flavor.blindBidRate,
      avgDepth: r.flavor.avgDepth,
      calcPerRound: r.flavor.calcPerRound,
      n: { seenBids: r.flavor.n.seenBids, bids: r.flavor.n.bids, rounds: r.flavor.n.rounds },
    }));

  const board = {
    schema: 'kai.arena.verified-board.v2',
    scope: '在这张桌子上',
    set: '干净集 v2',
    date: CLEAN_SET.date,
    sourceDoc: CLEAN_SET.source,
    batches: [...runs.keys()].sort(),
    totals: {
      models: new Set(arms.map((a) => a.model)).size,
      pairs: CLEAN_SET.pairs.length,
      matches: matches.length,
      arms: arms.length,
    },
    arms,
    flavor,
  };

  fs.writeFileSync(`${ROOT}/verified-board.json`, `${JSON.stringify(board, null, 1)}\n`);
  fs.writeFileSync(
    `${ROOT}/verified-replay.json`,
    `${JSON.stringify({
      schema: 'kai.arena.public-replay.v2',
      set: board.set,
      scope: board.scope,
      batches: board.batches,
      matches,
    })}\n`,
  );

  const size = (f) => fs.statSync(`${ROOT}/${f}`).size;
  console.log(`本桌榜：${board.totals.models} 模型 · ${board.totals.arms} 臂 · ${board.totals.matches} 场 → verified-board.json（${size('verified-board.json')} bytes）`);
  console.log(`公开复盘：${matches.length} 场 → verified-replay.json（${size('verified-replay.json')} bytes）`);
  if (mismatches.length) {
    console.log(`\n⚠️ 与干净集文档对不上的格子（${mismatches.length}）——出榜用的是脚本重算值：`);
    for (const line of mismatches) console.log(`   ${line}`);
  } else console.log('对账：22 臂的场次分级与战绩与干净集文档逐格一致。');
}

const [source, target] = process.argv.slice(2);
if (source) buildSingle(source, target ?? `${ROOT}/verified-replay.json`);
else buildCleanSet();
