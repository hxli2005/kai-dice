// 台词主观性分类管线（用户裁决的指标准入条件，2026-08-11）：
//   制品必须齐：labels.jsonl（lineId/标签/分类员/理由）＋ audit.jsonl（抽样审计裁决）＋
//   subjectivity.md（主观率**按场估误差**——同一场几十句话不是独立样本）。
// 判据（已裁，勿改）：把这句话删掉，牌桌信息是否有损失？
//   无损失（动作本身已公开）＝factual；暴露/伪装了一个心理立场＝subjective。
//
// 用法：OPENROUTER_KEY=sk-or-... node scripts/classify-says.mjs docs/arena/<批次目录> \
//         [--model deepseek/deepseek-chat] [--audit-model google/gemini-3.6-flash] [--batch 25]
// says.jsonl 缺失时自动从 run.json 回填（旧批次同样可分类）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chat } from '../src/ai/llm.js';
import { fetchModels, openrouterChannel } from '../src/ai/openrouter.js';

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const apiKey = process.env.OPENROUTER_KEY ?? process.env.KAI_KEY;
if (!dir || !apiKey) {
  console.error('用法：OPENROUTER_KEY=... node scripts/classify-says.mjs <run目录> [--model m] [--audit-model m]');
  process.exit(2);
}
const CLS_MODEL = flag('model', 'deepseek/deepseek-chat');
const AUD_MODEL = flag('audit-model', 'google/gemini-3.6-flash');
const BATCH = +flag('batch', '25');

// ---- 行装载（says.jsonl 优先；缺则从 run.json 回填并落盘）----
let rows;
if (existsSync(`${dir}/says.jsonl`)) {
  rows = readFileSync(`${dir}/says.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} else {
  const run = JSON.parse(readFileSync(`${dir}/run.json`, 'utf8'));
  rows = [];
  for (const m of run.matches)
    for (const s of ['A', 'B']) {
      const opp = m.seats[s === 'A' ? 'B' : 'A'];
      (m.logs[s] ?? []).forEach((l, i) => {
        if (l.auto || l.silentFallback || !l.say) return;
        rows.push({ lineId: `${m.seed}:${s}:${i}`, model: m.seats[s], opponent: opp, seed: m.seed, round: l.round, action: l.action, say: l.say, speechMode: l.speechMode ?? 'straight' });
      });
    }
  writeFileSync(`${dir}/says.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n'));
  console.log(`says.jsonl 从 run.json 回填：${rows.length} 句`);
}
console.log(`待分类 ${rows.length} 句（分类员 ${CLS_MODEL}，审计员 ${AUD_MODEL}）`);

const RUBRIC = `任务：给大话骰牌桌台词逐句分类，只有两类。
判据：把这句话删掉，牌桌信息是否有损失？无损失（动作/数字本身已公开）＝factual；暴露或伪装了一个心理立场（判断、怀疑、挑衅、情绪、意图、自评、引用对手）＝subjective。
例：「四个5。」「我先看看自己的骰。」「开牌。」＝factual；「四个5？我不信，开牌。」「这把我陪你玩大的。」「三个5，先稳稳来。」＝subjective（"稳"是自评尾巴）。
严格输出一行 JSON 数组，不要其他文字：[{"id":"…","label":"subjective"或"factual","reason":"≤20字"}]，逐行都要有。`;

// 通道必须走能力协商（教训：审计员 gemini 是重推理模型，裸 3072 会被推理吃光→全 unlabeled）
const live = await fetchModels().catch(() => null);
const channel = (model) => openrouterChannel({ apiKey, model, modelInfo: live?.find((m) => m.id === model) });
const parseArr = (raw) => {
  const m = raw.match(/\[[\s\S]*\]/);
  return JSON.parse(m[0]);
};

async function classify(model, items, who) {
  const out = new Map();
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const user = `${RUBRIC}\n\n${batch.map((r) => `${r.lineId}\t${r.say}`).join('\n')}`;
    let labeled = null;
    for (let attempt = 0; attempt < 3 && !labeled; attempt++) {
      try {
        const raw = await chat(channel(model), { system: '', user, maxTokens: 3072, timeoutMs: 90_000, extra: { temperature: 0 } });
        const arr = parseArr(raw);
        labeled = new Map(arr.filter((x) => x?.id && ['subjective', 'factual'].includes(x.label)).map((x) => [x.id, x]));
      } catch (e) {
        console.warn(`  ${who} 批 ${i / BATCH + 1} 第 ${attempt + 1} 次失败：${e.message?.slice(0, 60)}`);
      }
    }
    for (const r of batch) {
      const hit = labeled?.get(r.lineId);
      out.set(r.lineId, hit ? { label: hit.label, reason: String(hit.reason ?? '').slice(0, 60) } : { label: 'unlabeled', reason: '' });
    }
    process.stdout.write(`\r${who} ${Math.min(i + BATCH, items.length)}/${items.length}`);
  }
  console.log('');
  return out;
}

// ---- 分类（--summarize-only 时从既有 labels.jsonl 装载，不发任何调用）----
let labels;
if (argv.includes('--summarize-only') && existsSync(`${dir}/labels.jsonl`)) {
  labels = new Map(
    readFileSync(`${dir}/labels.jsonl`, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).map((x) => [x.lineId, { label: x.label, reason: x.reason }]),
  );
  console.log('summarize-only：从 labels.jsonl 装载');
} else {
  labels = await classify(CLS_MODEL, rows, '分类');
}
writeFileSync(
  `${dir}/labels.jsonl`,
  rows.map((r) => JSON.stringify({ lineId: r.lineId, model: r.model, label: labels.get(r.lineId).label, reason: labels.get(r.lineId).reason, classifier: CLS_MODEL })).join('\n'),
);

// ---- 审计（lineId 稳定哈希抽 ~1/7，审计员独立重判）----
const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
const sampled = rows.filter((r) => h(r.lineId) % 7 === 0);
const audited = argv.includes('--summarize-only') && existsSync(`${dir}/audit.jsonl`)
  ? new Map(readFileSync(`${dir}/audit.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.lineId, { label: x.auditLabel }]))
  : await classify(AUD_MODEL, sampled, '审计');
const auditRows = sampled.map((r) => {
  const a = audited.get(r.lineId).label;
  const b = labels.get(r.lineId).label;
  // unlabeled＝审计腿自身失败，只报失败数，不算分歧（算进去会把管线故障伪装成口径分歧）
  return { lineId: r.lineId, model: r.model, label: b, auditLabel: a, agree: a === 'unlabeled' ? null : a === b, auditor: AUD_MODEL };
});
writeFileSync(`${dir}/audit.jsonl`, auditRows.map((r) => JSON.stringify(r)).join('\n'));

// ---- 汇总：主观率按场（seed×座位＝一场里该席的全部台词）估误差 ----
const byModel = {};
for (const r of rows) {
  const lab = labels.get(r.lineId).label;
  const mk = `${r.seed}:${r.lineId.split(':')[1]}:${r.opponent.split('/').pop()}`; // 场＝seed×座位×对手（坐庄批防跨臂碰撞）
  const m = (byModel[r.model] ??= { matches: {}, total: 0, subj: 0, unlabeled: 0 });
  const g = (m.matches[mk] ??= { total: 0, subj: 0, opponent: r.opponent });
  m.total += 1;
  g.total += 1;
  if (lab === 'subjective') { m.subj += 1; g.subj += 1; }
  if (lab === 'unlabeled') m.unlabeled += 1;
}
const md = ['# 台词主观率（逐句制品版）', '', `分类员 ${CLS_MODEL}（temperature 0）｜审计员 ${AUD_MODEL}｜判据＝删句无损失=factual`, ''];
for (const [model, m] of Object.entries(byModel)) {
  const rates = Object.values(m.matches).map((g) => g.subj / g.total);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = rates.length > 1 ? Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / (rates.length - 1)) : 0;
  const agr = auditRows.filter((r) => r.model === model && r.agree !== null);
  const afail = auditRows.filter((r) => r.model === model && r.agree === null).length;
  md.push(`## ${model}`);
  md.push(`- 主观率（按场，n=${rates.length} 场）：**${(mean * 100).toFixed(0)}% ± ${(sd * 100).toFixed(0)}pt**　句级 ${m.subj}/${m.total}${m.unlabeled ? `（未标 ${m.unlabeled}）` : ''}`);
  md.push(`- 各场：${Object.entries(m.matches).map(([k, g]) => `${k} vs ${g.opponent.split('/').pop()}＝${((g.subj / g.total) * 100).toFixed(0)}%(${g.subj}/${g.total})`).join('；')}`);
  md.push(`- 审计一致率：${agr.length ? `${((agr.filter((r) => r.agree).length / agr.length) * 100).toFixed(0)}%（n=${agr.length}${afail ? `，审计失败另计 ${afail}` : ''}）` : afail ? `（审计腿全部失败 ${afail} 句）` : '（未抽中）'}`);
  md.push('');
}
writeFileSync(`${dir}/subjectivity.md`, md.join('\n'));
console.log(md.join('\n'));
console.log(`\n制品落盘：${dir}/{says,labels,audit}.jsonl + subjectivity.md`);
