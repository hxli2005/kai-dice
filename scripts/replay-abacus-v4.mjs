// 反事实重放（2026-08-13，算盘去权威化 v4 的第一道验证）：
// 从 bo3 存档（docs/arena/2026-08-13T09-51-52）抽 kimi-k3 决胜局四手的**原始提示词**，
// A/B 两臂只换算盘话术——A 臂＝v3 原文逐字，B 臂＝v4 现行文案（三处模板行替换＋system 行替换），
// 其余每个字节相同（含它自己 v3 时代的留档回灌——测的就是"旧史＋新词"）。每臂 N 发重问同一模型，
// 同后端锁、同采样钉子（temperature 0.8）、同预算信封。
//
// 四手是什么（match idx 2, seed 1002, k3=席B）：
//   #15/#19＝拨算盘选择手：belief 里已手写出正确的 7/27≈26%，仍去"确认准数"——仪式消不消失？
//   #16/#20＝26% 开牌手：铁律（首报必实）与算盘 26% 冲突，v3 下它信了算盘——锚松没松？
//
// 两臂都重采样是因为原始对局每手只有 n=1：不重建 v3 分布，v4 的差异就没有参照。
// 结论口径：这是**单模型、单局面**的探针，不是批次证据；正式验证走下一批擂台（F6 calcFollowRate）。
//
// 用法：
//   node scripts/replay-abacus-v4.mjs --dry          离线验证（v3 重建哈希、补丁差异），零网络
//   OPENROUTER_KEY=sk-or-... node scripts/replay-abacus-v4.mjs [--n 6] [--cap 3]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { seatSystem, PROMPT_VERSION } from '../src/ai/agent.js';
import { fetchModels, openrouterChannel } from '../src/ai/openrouter.js';
import { pinSampling, MAX_TOKENS, TIMEOUT_MS, REASONING_TOKENS } from '../src/arena/arena.js';
import { chat } from '../src/ai/llm.js';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const DRY = args.includes('--dry');
const N = Number(flag('n', 6));
const CAP_USD = Number(flag('cap', 3));
const RUN_DIR = 'docs/arena/2026-08-13T09-51-52';
const OUT_DIR = 'docs/arena/replay-2026-08-13-abacus-v4';

const run = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'run.json'), 'utf8'));
const MATCH = 2; // 决胜局 seed 1002
const SEAT = 'B'; // kimi-k3
const HANDS = [
  { idx: 15, name: 'r5-拨算盘选择', kind: 'calc-choice' },
  { idx: 16, name: 'r5-26%开牌', kind: 'post-calc' },
  { idx: 19, name: 'r6-拨算盘选择', kind: 'calc-choice' },
  { idx: 20, name: 'r6-26%开牌', kind: 'post-calc' },
];

// ---- v3 提示词重建（必须逐字精确，哈希对不上就中止）----
const V4_CALC_ROW =
  '拨算盘 ｜ 轮到你，本局未算 ｜ 引擎替你做一道算术并发你结果：「当前报价为真」的概率，本局内随当前报价更新。算式输入只有你已可见的信息（可见的骰、各家骰数、当前报价、斋否），所有你看不见的骰一律按每面 1/6 计；同样的输入谁算都得同一个数，引擎只保证不算错。未拨则引擎不发此数';
const V3_CALC_ROW =
  '拨算盘 ｜ 轮到你，本局未算 ｜ 得「当前报价为真」的精确概率（按你的骰面与其余未知骰计算）；未拨算盘你手上就没有准数';
const sysV4 = seatSystem(false);
if (!sysV4.includes(V4_CALC_ROW)) {
  console.error(
    '本实验已被超越：v5（2026-08-13 用户裁决）已从模型席拔掉算盘，当前 system 里没有 v4 算盘行。\n' +
      '如需考古这组 A/B，checkout 提交 84d91ef（提示词 v4）再跑本脚本。',
  );
  process.exit(3);
}
const sysV3 = sysV4.replace(V4_CALC_ROW, V3_CALC_ROW);
const h16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const wantHash = run.provenance.systemPromptHash;
if (h16(sysV3) !== wantHash)
  throw new Error(`v3 system 重建失败：hash ${h16(sysV3)} ≠ 存档 ${wantHash}——v3→v4 之间还有别的 system 改动，重建不成立`);

// user 侧三处模板行（v3→v4 的全部 user 差异；模型自己留档里的「准数」是它的原话，不动）
const USER_PATCHES = [
  [/你已拨算盘：按你的骰面算，当前报价为真的精确概率/g, '你已拨算盘：看不见的骰按每面 1/6 计，当前报价为真的概率'],
  [/你未拨算盘：手上没有准数。/g, '你未拨算盘：引擎未发概率数。'],
  [/拨了算盘（对手都看见了；这局你手上有准数）/g, '拨了算盘（对手都看见了；本局内引擎随当前报价发你概率）'],
];
const patchUser = (s) => USER_PATCHES.reduce((acc, [re, to]) => acc.replace(re, to), s);

const logs = run.matches[MATCH].logs[SEAT];
const hands = HANDS.map((h) => {
  const l = logs[h.idx];
  const v3 = l.facts;
  const v4 = patchUser(v3);
  if (v4 === v3) throw new Error(`#${h.idx} 补丁零命中——存档文案与预期不符`);
  for (const [re] of USER_PATCHES) if (re.test(v4)) throw new Error(`#${h.idx} 补丁残留`);
  return { ...h, round: l.round, original: l.action, v3user: v3, v4user: v4 };
});

console.log(`v3 system 重建哈希 ${h16(sysV3)} ＝ 存档 ${wantHash} ✓（唯一差异＝算盘行）`);
for (const h of hands) {
  const nPatched = h.v3user.length === h.v4user.length ? '同长' : `${h.v3user.length}→${h.v4user.length}字`;
  console.log(`#${h.idx} ${h.name}：原动作=${JSON.stringify(h.original)}；补丁后 ${nPatched}`);
}
if (DRY) {
  console.log(`\n--dry 完成。实跑：4手 × 2臂 × ${N}发 = ${hands.length * 2 * N} 发，预算上限 $${CAP_USD}`);
  process.exit(0);
}

// ---- 通道：与 bo3 同构（同模型、同后端锁、同预算、同采样钉子）----
const apiKey = process.env.OPENROUTER_KEY ?? process.env.KAI_KEY;
if (!apiKey) {
  console.error('缺 OPENROUTER_KEY。用法见文件头；离线自检用 --dry。');
  process.exit(2);
}
const entrant = run.entrants.find((e) => e.label === 'moonshotai/kimi-k3');
const models = await fetchModels({ apiKey });
const modelInfo = models.find((m) => m.id === 'moonshotai/kimi-k3');
if (!modelInfo) throw new Error('清单里没有 moonshotai/kimi-k3');
const channel = pinSampling(
  openrouterChannel({
    apiKey,
    model: 'moonshotai/kimi-k3',
    modelInfo,
    providerTag: entrant.tag, // morph/fp4——与存档同锁
    budget: { completionTokens: MAX_TOKENS, reasoningTokens: REASONING_TOKENS },
  }),
);
console.log(`通道：moonshotai/kimi-k3 后端锁 ${entrant.tag}　推理 ${channel.reasoningProfile ? `budget${channel.reasoningProfile.maxTokens}` : 'native'}`);

// ---- 跑 ----
const parse = (raw) => {
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    const a0 = j.action ?? {};
    const a = ['blind', 'zhai', 'raise'].includes(a0.type) ? { type: 'declare', declaration: a0.type } : a0;
    return { action: a, belief: j.belief ?? '', say: j.say ?? '', note: j.note ?? '', speechMode: j.speechMode ?? '' };
  } catch {
    return null;
  }
};
let spent = 0;
const results = [];
const jobs = [];
for (const h of hands)
  for (const arm of ['v3', 'v4'])
    for (let i = 0; i < N; i++) jobs.push({ h, arm, i });

let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    if (spent > CAP_USD) return;
    const { h, arm, i } = job;
    const meta = {};
    let raw = null;
    let err = null;
    for (let attempt = 0; attempt < 2 && raw == null; attempt++) {
      try {
        raw = await chat(channel, {
          system: arm === 'v3' ? sysV3 : sysV4,
          user: arm === 'v3' ? h.v3user : h.v4user,
          maxTokens: MAX_TOKENS,
          timeoutMs: TIMEOUT_MS,
          extra: channel.decisionExtra,
          meta,
        });
      } catch (e) {
        err = e?.message ?? 'unknown';
        await new Promise((r) => setTimeout(r, meta.status === 429 ? 4000 : 800));
      }
    }
    const d = raw ? parse(raw) : null;
    spent += meta.cost ?? 0;
    const act = d?.action ? `${d.action.type}${d.action.type === 'bid' ? ` ${d.action.count}个${d.action.face}` : ''}` : `✗${err ?? meta.finish ?? 'bad'}`;
    console.log(`#${h.idx} ${arm} [${i + 1}/${N}] ${act}　${Math.round((meta.ms ?? 0) / 1000)}s $${(meta.cost ?? 0).toFixed(4)} ${meta.provider ?? '?'} 累计$${spent.toFixed(2)}`);
    results.push({ hand: h.idx, name: h.name, kind: h.kind, arm, i, action: d?.action ?? null, belief: d?.belief ?? null, say: d?.say ?? null, note: d?.note ?? null, speechMode: d?.speechMode ?? null, error: err, meta: { ms: meta.ms, cost: meta.cost, provider: meta.provider, finish: meta.finish, outTokens: meta.outTokens }, raw });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

// ---- 汇总与落盘 ----
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'result.json'), JSON.stringify({ at: new Date().toISOString(), promptVersion: { v3: h16(sysV3), v4: h16(sysV4) }, entrant: entrant.label, tag: entrant.tag, sampling: { temperature: 0.8, top_p: 1 }, n: N, spent, hands: HANDS, results }, null, 1));

const lines = ['# 反事实重放：算盘去权威化（v3 ↔ v4），kimi-k3 决胜局四手', '', `每臂 ${N} 发，temperature 0.8，后端锁 ${entrant.tag}，实花 $${spent.toFixed(2)}`, ''];
for (const h of hands) {
  lines.push(`## #${h.idx} ${h.name}（原动作 ${JSON.stringify(h.original)}）`, '');
  for (const arm of ['v3', 'v4']) {
    const rs = results.filter((r) => r.hand === h.idx && r.arm === arm);
    const dist = {};
    for (const r of rs) {
      const k = r.action ? `${r.action.type}${r.action.type === 'bid' ? ` ${r.action.count}个${r.action.face}` : ''}` : '坏输出';
      dist[k] = (dist[k] ?? 0) + 1;
    }
    lines.push(`### ${arm}：${Object.entries(dist).map(([k, v]) => `${k}×${v}`).join('、') || '（无）'}`, '');
    for (const r of rs) lines.push(`- [${r.i + 1}] **${r.action ? r.action.type : '✗'}**${r.action?.count ? ` ${r.action.count}个${r.action.face}` : ''}　belief：${(r.belief ?? '').slice(0, 500)}`);
    lines.push('');
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'beliefs.md'), lines.join('\n'));
console.log(`\n落盘 ${OUT_DIR}/{result.json,beliefs.md}　实花 $${spent.toFixed(2)}`);
for (const h of hands) {
  const row = (arm) => {
    const rs = results.filter((r) => r.hand === h.idx && r.arm === arm && r.action);
    const ch = rs.filter((r) => r.action.type === 'challenge').length;
    const calc = rs.filter((r) => r.action.type === 'calc').length;
    return `${arm}: 开牌${ch}/${rs.length}　拨算盘${calc}/${rs.length}`;
  };
  console.log(`#${h.idx} ${h.name}　${row('v3')}　｜　${row('v4')}`);
}
