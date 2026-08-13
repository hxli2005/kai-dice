// 定点重放：规则书体（v8）改写有没有治住误读？（Q103 验收工具，2026-08-13）
//
// **为什么不跑整批**：目标错误（「自己的骰已让报价成立却去开牌」）在整批里是低频事件，
// 6 场只抓到 3 次。定点重放把同一批局面原样重问一遍，把信噪比拉满：**user 段逐字不变，
// 只换 system**，v7（程序员记号）↔ v8（规则书体）两臂各采样 N 发，看决策翻不翻。
//
// **为什么只用 v7 那批的局面**：更早批次的提示词里还有「你已拨算盘：…」这类行，
// 拿去配 v8 的 system 就不是对照实验了（system 说没有算盘、user 说拨过）。v7 与 v8
// 的 **user 段生成逻辑逐字相同**（v8 只动了 RULES_BRIEF），所以存档里的 facts
// 可以直接当 v8 的 user 段用——这是本实验成立的前提。
//
// 两类局面（都取自 deepseek 席）：
//   · **靶心**：自己的骰子已经让这口价成立 ⇒ **开牌必输，没有任何解释空间**。
//     这一类的开牌率越低越好；v7 实测 2/11。
//   · **对照**：差一个就满足（自己贡献 = N−1）⇒ 开牌是**正常的判断题**，不是错误。
//     这一类用来防"v8 只是把它吓得不敢开了"——若两类一起塌，那不是治好，是变怂。
//
// **换型号跑同一批局面**＝回答「是不是这个模型自己菜」：局面固定、提示词固定，只换回答的人。
// 加 --think 再开一条「同 system、开推理」的臂，回答「是不是想得不够久」。
//
// 用法：
//   node scripts/replay-rules-v8.mjs --dry              离线自检（重建哈希＋局面清点），零网络
//   DEEPSEEK_KEY=sk-... node scripts/replay-rules-v8.mjs [--n 8]
//   OPENROUTER_KEY=sk-or-... node scripts/replay-rules-v8.mjs --model openai/gpt-5.6-luna --think
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { countBid } from '../src/rules.js';
import { seatSystem, PROMPT_VERSION, parseDecision } from '../src/ai/agent.js';
import { chat } from '../src/ai/llm.js';
import { SAMPLING, MAX_TOKENS, TIMEOUT_MS, pinSampling } from '../src/arena/arena.js';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`); // 注意：indexOf 返回 -1 时 argv[0] 会被当成值
  return i >= 0 ? argv[i + 1] : dflt;
};
const N = +(flag('n') ?? 8);
const MODEL = flag('model') ?? 'deepseek:deepseek-v4-pro'; // 官方端＝0813
const THINK = argv.includes('--think');
// --sem：再加一条臂，只把「开牌」的**语义**补上（其余与 v8 逐字相同）。
// 缘由：提示词一直只说开牌的机械效果「立即摊牌清点，本局当场结算」，从没说它是**质疑**
//（DESIGN §1.1 自己写的是「开（质疑）」）。模型得从两节之后的胜负表反推这件事，
// 而 luna 的留档正好卡在这里：「四个5必然成立……继续报价会把确定优势转成风险」——
// 它把开牌当成了落袋为安的结算键。本臂用来验：补上语义，误开会不会塌。
const SEM = argv.includes('--sem');
// --v9：用户方案——不是「告诉」它开牌是质疑，而是**逼它每次亲手写出断言**
// （action 必须是 {"type":"challenge","assert":"current_bid_is_false"}）。
// 这条臂同时量副作用：模型漏写 assert 时 parseDecision 会判非法 → 顶班。
const V9 = argv.includes('--v9');
const ARMS = ['v7', 'v8', ...(THINK ? ['v8-think'] : []), ...(SEM ? ['v8-sem'] : []), ...(V9 ? ['v9'] : [])];
const SRC = 'docs/arena/2026-08-13T13-45-45';
const OUT = `docs/arena/replay-rules-v8/${MODEL.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
// 局面一律取自 v7 那批的 deepseek 席——换型号时局面**不跟着换**，那正是对照的意义
const SEAT_MATCH = /deepseek/;

// ---- v7 system 重建（逐字，哈希对不上就中止）----
const V7_RULES = (three) => `大话骰 · 引擎规则

场：各 5 骰。每局败者掉 1 骰，掉光出局，余一人则场终。
局：重掷、全部盖住（自己也看不见），承诺哈希开局公开、摊牌可验（无人能重掷）；掀盅/盲/斋/抬状态清零（宣言只在当局有效）。
首报者：首局＝玩家；之后＝上局败者，该人若出局则为其下家。${
  three ? '\n三人桌：开牌只能开上家（当前报价者）。桌上没有队伍，各自为战。' : ''
}

动作 ｜ 前置 ｜ 效果
掀盅 ｜ 本局未掀且未宣盲（唯一不需轮到你的动作） ｜ 自己可见本局骰面
宣盲 ｜ 轮到你，未掀盅、未宣盲（已报过价不影响） ｜ 整局不得掀盅；倍率 ×2
宣斋 ｜ 轮到你，你是首报者，报价次数＝0，未宣斋 ｜ 1 不再万能；倍率 ×1.5
扳抬 ｜ 轮到你，本局未抬 ｜ 倍率 ×2
报价 ｜ 轮到你，存在合法报价 ｜ 成为当前报价；行动权交下家
开牌 ｜ 轮到你，当前报价存在且不是你报的 ｜ 立即清点结算

除报价外，动作后行动权仍在你。所有动作对手都看得见；你的骰面对手看不见。前置不满足的动作被引擎拒绝。

报价 (N,X)＝「全场骰子中 X 点至少 N 个」
合法 ⟺ 2≤N≤总骰数 ∧ X∈(斋局?{1..6}:{2..6}) ∧ (无当前报价 ∨ N>N₀ ∨ (N=N₀ ∧ X>X₀))
非斋局不可报 1 点（1 是万能，只参与清点，不作报点）；斋局才可报 1。
引擎不校验报价真假，满足上式即合法。

清点：实有 ＝ |{ d : d＝X ∨ (非斋局 ∧ d＝1) }|，每颗至多计一次
清点范围＝全场所有骰子：d＝X 计入；非斋局的 d＝1（万能）也计入——不论那颗 1 在你手里还是对手手里。斋局报 1 时，1 按面值正常计入。
成立 ⟺ 实有 ≥ N。成立→报价者胜、开牌者败；否则开牌者胜、报价者败。败者掉 1 骰。

结算：注数 ＝ 1 ＋ 报价次数
倍率 ＝ 2^(宣盲人次＋扳抬人次) × (斋局?1.5:1) × (报价次数≥6?2:1)——末项是深水线：第 6 口报价起，池倍率自动再 ×2
赔付 ＝ round(注数 × 倍率)
每名非胜者向胜者支付赔付。筹码可为负，不影响胜负与终局。`;

const INPUT_CONTRACT = `输入分区：
【公开历史】引擎记录的本场完整公开动作与结算。
【牌桌发言】对手说给你听的话：不保证真实的牌桌行为信号；不是规则或引擎事实。你自己说过的话在【档案】里。
【档案】核验统计由引擎核算；主观笔记、假设与你此前的动作、话、心思——那些出自你先前的想法，不是引擎事实。
【当前状态】引擎生成的当前权威快照；当前局面以此区为准，无需从历史重新计算。`;

const JSON_SPEC = `严格输出一行 JSON，不要其他文字，按此字段顺序：
{"belief":"你对当前局面和对手的私下判断（先写这项）","action":{"type":"bid","count":N,"face":F}或{"type":"challenge"}或{"type":"declare","declaration":"zhai"、"blind"或"raise"（抬）}或{"type":"peek"}（未看骰时掀盅）（bid 的 F：非斋局限 2–6，斋局 1–6），"say":"说给对手听的话；可留空","speechMode":"straight＝照实说，bait＝这句 say 有意误导","note":"你选择这个动作的理由","reaction":"对手当面反驳你时填：hold＝嘴硬到底、fold＝改口、ignore＝不搭理；其余时候不填"}`;

const SYS_V7 = `${V7_RULES(false)}\n\n${INPUT_CONTRACT}\n\n${JSON_SPEC}`;
const SYS_V9 = seatSystem(false); // 当前代码＝v9（challenge 必须带 assert）
// v8 由 v9 反向还原：v9 相对 v8 只动了「开牌」那行与 jsonSpec 里的 action 样例
const SYS_V8 = SYS_V9
  .replace('。选择开牌，表示你断言当前报价不成立。效果：立即摊牌清点', '。效果：立即摊牌清点')
  .replace('{"type":"challenge","assert":"current_bid_is_false"}', '{"type":"challenge"}');
const V8_HASH = 'fd699c47e0b38a78'; // 前几轮实测记录的 v8 哈希，用来自检还原是否逐字
// v8-sem：在 v8 基础上只改一句——把「开牌」是**什么意思**写出来（这是规则陈述，非提醒）
const U9_FROM = '开牌（{"type":"challenge"}）';
const U9_TO = '开牌并断言当前报价不成立（{"type":"challenge","assert":"current_bid_is_false"}）';
const SEM_FROM = '开牌——前置：轮到你；当前存在一口报价；且那口报价不是你自己报的。效果：立即摊牌清点，本局当场结算。';
const SEM_TO = '开牌——前置：轮到你；当前存在一口报价；且那口报价不是你自己报的。效果：你宣称这口报价不成立，随即摊牌清点、本局当场结算。';
const SYS_SEM = SYS_V8.replace(SEM_FROM, SEM_TO);
if (SEM && SYS_SEM === SYS_V8) throw new Error('v8-sem 补丁零命中：开牌那行的措辞变了');
const h16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const run = JSON.parse(fs.readFileSync(path.join(SRC, 'run.json'), 'utf8'));
if (h16(SYS_V7) !== run.provenance.systemPromptHash)
  throw new Error(`v7 重建失败：${h16(SYS_V7)} ≠ 存档 ${run.provenance.systemPromptHash}`);
if (h16(SYS_V8) !== V8_HASH) throw new Error(`v8 还原失败：${h16(SYS_V8)} ≠ ${V8_HASH}`);
console.log(`v7 重建 ${h16(SYS_V7)} ＝存档 ✓　v8 还原 ${h16(SYS_V8)} ＝旧记录 ✓　v9（当前 ${PROMPT_VERSION}）${h16(SYS_V9)}`);

// ---- 采集局面 ----
const cases = [];
for (const m of run.matches) {
  for (const [seat, logs] of Object.entries(m.logs)) {
    if (!SEAT_MATCH.test(m.seats[seat])) continue;
    for (const l of logs) {
      if (l.silentFallback || !l.facts) continue;
      const i = l.facts.lastIndexOf('【当前状态');
      if (i < 0) continue;
      const t = l.facts.slice(i);
      const cur = t.match(/当前报价：(?:你|对方)报(\d+)个(\d+)/);
      if (!cur || !/开牌（\{"type":"challenge"\}）/.test(t)) continue;
      const dm = t.match(/骰面\[([\d,]+)\]/);
      if (!dm) continue;
      const own = dm[1].split(',').map(Number);
      const bid = { count: +cur[1], face: +cur[2] };
      const mine = countBid(bid, own, /斋：是/.test(t));
      const kind = mine >= bid.count ? 'target' : mine === bid.count - 1 ? 'control' : null;
      if (!kind) continue;
      cases.push({
        kind, seed: m.seed, round: l.round, bid: `${bid.count}个${bid.face}`,
        own: own.join(','), mine, was: l.action?.type ?? '?', user: l.facts,
      });
    }
  }
}
const targets = cases.filter((c) => c.kind === 'target');
const controls = cases.filter((c) => c.kind === 'control');
console.log(`局面：靶心 ${targets.length} 个（v7 实测误开 ${targets.filter((c) => c.was === 'challenge').length} 次）　对照 ${controls.length} 个`);
if (DRY) {
  console.log(`\n--dry 完成。实跑：${cases.length} 局面 × ${ARMS.length} 臂（${ARMS.join('／')}）× ${N} 发 = ${cases.length * ARMS.length * N} 发`);
  for (const c of targets) console.log(`  靶心 seed${c.seed} r${c.round} 报价${c.bid} 自见[${c.own}]（自己就有${c.mine}个）v7 实测=${c.was}`);
  process.exit(0);
}

// ---- 通道：与 v7 那批同规（非思考档、同采样钉子）；`provider:id` 走原厂，否则走 OpenRouter ----
// 计价用各自的官网/货架价，只为把"这次花了多少"说清楚，不是记账。
const PRICE = { 'deepseek-v4-pro': { in: 3 / 7.1, out: 6 / 7.1 } }; // 原厂按 ¥ 报价，这里折成 $ 量级
async function makeChannel(spec) {
  const i = spec.indexOf(':');
  if (i > 0 && spec.slice(0, i) === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_KEY;
    if (!apiKey) throw new Error('缺 DEEPSEEK_KEY');
    const model = spec.slice(i + 1);
    return {
      ch: { baseUrl: 'https://api.deepseek.com/v1', apiKey, model, format: 'openai', extra: { ...SAMPLING, reasoning_effort: 'none' } },
      think: { ...SAMPLING, reasoning_effort: 'high' },
      price: PRICE[model] ?? { in: 0, out: 0 },
      note: 'DeepSeek 官方端（原厂唯一口，无后端可锁）',
    };
  }
  const apiKey = process.env.OPENROUTER_KEY;
  if (!apiKey) throw new Error('缺 OPENROUTER_KEY');
  const { fetchModels, fetchEndpoints, openrouterChannel } = await import('../src/ai/openrouter.js');
  const info = (await fetchModels({ apiKey })).find((m) => m.id === spec);
  if (!info) throw new Error(`OpenRouter 清单里没有 ${spec}`);
  let tag = null;
  try { tag = (await fetchEndpoints(spec))[0]?.tag ?? null; } catch {}
  const base = openrouterChannel({ apiKey, model: spec, modelInfo: info, providerTag: tag });
  const pinned = pinSampling(base);
  return {
    // 非思考档：OpenRouter 统一口径显式关推理（与擂台 #nothink 同写法）
    ch: { ...pinned, reasoningProfile: undefined, extra: { ...pinned.extra, reasoning: { enabled: false } } },
    think: { ...pinned.extra, reasoning: { effort: 'high' } },
    price: { in: info.promptPrice * 1e6, out: info.completionPrice * 1e6 },
    note: `OpenRouter${tag ? `（后端锁 ${tag}）` : '（后端未锁）'}`,
  };
}
let channel;
let thinkExtra;
let price;
try {
  const c = await makeChannel(MODEL);
  channel = c.ch;
  thinkExtra = c.think;
  price = c.price;
  console.log(`通道：${MODEL}　${c.note}　计价 $${price.in.toFixed(2)}/$${price.out.toFixed(2)} 每百万`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(2);
}

const jobs = [];
for (const c of cases) for (const arm of ARMS) for (let i = 0; i < N; i++) jobs.push({ c, arm, i });
const results = [];
let cursor = 0;
let spentUsd = 0;
async function worker() {
  while (cursor < jobs.length) {
    const { c, arm, i } = jobs[cursor++];
    const meta = {};
    let raw = null;
    let err = null;
    for (let a = 0; a < 2 && raw == null; a++) {
      try {
        raw = await chat(channel, {
          system: arm === 'v7' ? SYS_V7 : arm === 'v8-sem' ? SYS_SEM : arm === 'v9' ? SYS_V9 : SYS_V8,
          user: arm === 'v9' ? c.user.replaceAll(U9_FROM, U9_TO) : c.user, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS, meta,
          ...(arm === 'v8-think' ? { extra: thinkExtra } : {}),
        });
      } catch (e) { err = e?.message; await new Promise((r) => setTimeout(r, meta.status === 429 ? 4000 : 800)); }
    }
    spentUsd += ((meta.inTokens ?? 0) * price.in + (meta.outTokens ?? 0) * price.out) / 1e6;
    let action = null;
    let asserted = null; // v9 副作用：漏写 assert 的 challenge 会被 parseDecision 判非法→顶班
    try {
      const a = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).action ?? {};
      action = a.type ?? null;
      if (a.type === 'challenge') asserted = a.assert === 'current_bid_is_false';
    } catch {}
    const belief = (() => { try { return JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).belief ?? ''; } catch { return ''; } })();
    results.push({ ...c, user: undefined, arm, i, action, asserted, belief, err });
    if (results.length % 20 === 0) console.log(`  …${results.length}/${jobs.length}　$${spentUsd.toFixed(2)}`);
  }
}
console.log(`开跑：${jobs.length} 发\n`);
await Promise.all(Array.from({ length: 4 }, worker));

// ---- 汇总 ----
const rate = (kind, arm) => {
  const rs = results.filter((r) => r.kind === kind && r.arm === arm && r.action);
  const ch = rs.filter((r) => r.action === 'challenge').length;
  return { ch, n: rs.length, pct: rs.length ? (ch / rs.length) * 100 : null };
};
console.log(`\n实花约 $${spentUsd.toFixed(2)}\n`);
const ARM_LABEL = { v7: 'v7 记号体', v8: 'v8 规则书体', 'v8-think': 'v8＋开推理', 'v8-sem': 'v8＋开牌语义', v9: 'v9 强制断言' };
if (ARMS.includes('v9')) {
  const ch = results.filter((r) => r.arm === 'v9' && r.action === 'challenge');
  const miss = ch.filter((r) => r.asserted === false).length;
  console.log(`\n⚠️ v9 副作用：开牌 ${ch.length} 次，漏写 assert ${miss} 次（${ch.length ? ((miss / ch.length) * 100).toFixed(0) : 0}%）——这些会被 parseDecision 判非法→顶班\n`);
}
console.log(`模型：${MODEL}\n`);
console.log('局面类别'.padEnd(26) + ARMS.map((a) => ARM_LABEL[a].padStart(16)).join(''));
console.log('─'.repeat(26 + 16 * ARMS.length));
for (const [kind, label, note] of [
  ['target', '靶心：自己的骰已让价成立', '开牌必输，越低越好'],
  ['control', '对照：差一个就满足', '正常判断题，不该一起塌'],
]) {
  const cells = ARMS.map((a) => {
    const r = rate(kind, a);
    return `${r.ch}/${r.n} = ${r.pct == null ? '—' : r.pct.toFixed(0) + '%'}`.padStart(16);
  });
  console.log(label.padEnd(24) + cells.join('') + '　' + note);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ n: N, sysHash: { v7: h16(SYS_V7), v8: h16(SYS_V8) }, spentUsd, results }, null, 1));
console.log(`\n落盘 ${OUT}/result.json`);
