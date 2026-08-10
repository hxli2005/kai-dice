// 擂台榜（施工单 A5，凭 Q52⑤）。
//
// 两条纪律，写死在渲染层而不是写在注释里：
//   · **每个结论必须带样本数**——没有 n 的比率是修辞，不是数据。本模块的每个格子
//     要么带自己的分母，要么打「—」（样本不足就别显摆一个小数点）。
//   · **口径限定"在这张桌子上"**——这是一张大话骰桌上的行为观测，不是通用能力评测。
//     禁止 benchmark 式断言（"最强""排名第一"）。榜首那行也只说"在这张桌子上赢得多"。
//
// 台词质量不进榜（排期：等接地批次 G2）——留样在 flavor.lines 里，人来评。

const MIN_N = 20; // 低于这个分母的比率不出数（宁可空着）

const f = (v, n = null, digits = 2) => {
  if (v == null) return '—';
  if (n != null && n < MIN_N) return `(${(v * 100).toFixed(0)}%·n=${n})`; // 括号＝样本不足，看个意思
  return typeof v === 'number' && v <= 1 && digits === 2 ? `${(v * 100).toFixed(0)}%` : String(v);
};
const num = (v, d = 2) => (v == null ? '—' : v.toFixed(d));

const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join(
    '\n',
  );

export function renderBoard(rows, { run = {}, integrity, cache, spread, estimate } = {}) {
  const sorted = [...rows].sort((a, b) => (b.skill.winRate ?? -1) - (a.skill.winRate ?? -1));
  const totalMatches = rows.reduce((s, r) => s + r.samples.matches, 0) / 2;
  const totalCalls = rows.reduce((s, r) => s + r.samples.calls, 0);
  const totalUsd = rows.reduce((s, r) => s + r.cost.usd, 0);
  const estimated = rows.some((r) => !r.cost.usdFromApi);

  const out = [];
  out.push('# 素颜擂台 · 战报');
  out.push('');
  out.push(
    `> **口径：在这张桌子上。** 这是 ${totalMatches} 场大话骰里的行为观测，不是通用能力评测——` +
      '换个游戏、换个提示词，结论不保证成立。每个数字后面的 n 是它自己的分母。',
  );
  out.push('');
  out.push(
    `跑批：${rows.length} 个模型 · ${totalMatches} 场 · ${totalCalls} 次调用 · ` +
      `种子 ${run.seed0 ?? '—'} 起 ${run.games ?? '—'} 组镜像 · ${run.at ?? ''}`,
  );
  out.push('');
  out.push('**实验设置**（改任何一条，跨批次的数就不能比了）：');
  out.push(`- 系统提示词：全席逐字相同（无身份、无模型名）`);
  out.push(`- 镜像种子：同一副骰种打两遍、互换座位`);
  out.push(`- 采样钉死：${run.sampling ? JSON.stringify(run.sampling) : '—'}，max_tokens=${run.maxTokens ?? '—'}`);
  out.push(`- 档案：每场独立（v1 不带跨场记忆，避免顺序效应）`);
  out.push(`- 用时：不喂进牌桌（延迟是模型速度，不是性格）`);
  if (integrity) out.push(`- 供应商路由：${integrity.note}`);
  out.push('');

  out.push('## ① 合规层——听不听话');
  out.push('> 分化如果只出现在这一层，那测出来的是驯服度，不是性格。「不肯骗人」本身是内容。');
  out.push('');
  out.push(
    table(
      ['模型', '非法动作', '格式失败', '拒绝', '降级顶班', '超时/错', 'n(手)'],
      sorted.map((r) => [
        r.label,
        f(r.compliance.illegalRate, r.compliance.n),
        f(r.compliance.formatFailRate, r.compliance.n),
        f(r.compliance.refusalRate, r.compliance.n),
        f(r.compliance.silentFallbackRate, r.samples.calls),
        `${r.compliance.timeouts}/${r.compliance.errors}`,
        r.compliance.n,
      ]),
    ),
  );
  const rejects = sorted.filter((r) => r.compliance.engineRejects > 0);
  if (rejects.length)
    out.push(
      `\n⚠️ 引擎打回 ${rejects.map((r) => `${r.label}×${r.compliance.engineRejects}`).join('、')}——` +
        '这是**我们的校验漏了**，不是模型的合规失败，修完重跑。',
    );
  out.push('');

  out.push('## ② 棋力层——强弱');
  out.push('> 强不等于"另一个人"。这层的分化撑不起"模型即对手"。');
  out.push('');
  out.push(
    table(
      ['模型', '胜率', '开牌命中', '掐中', '净筹码', 'n(场)'],
      sorted.map((r) => [
        r.label,
        f(r.skill.winRate, r.skill.n), // 场数天生小，多半会带括号——那就是它该有的样子
        f(r.skill.challengeHitRate, r.skill.challenges),
        r.skill.calzas ? f(r.skill.calzaHitRate, r.skill.calzas) : '—',
        r.skill.netChips,
        r.skill.n,
      ]),
    ),
  );
  out.push('');
  out.push(
    `注：胜率的分母是场数（这里每模型 ${sorted[0]?.skill.n ?? 0} 场）。**十场级的胜率差不构成排名**——` +
      '这张榜上它只用来说"在这张桌子上赢得多/少"，不用来说谁强。',
  );
  out.push('');

  out.push('## ③ 风味层——只有这层的分化支撑「模型即对手」');
  out.push('');
  out.push(
    table(
      ['模型', '虚报率', '蒙报率', '抬价深度', '算频/局', '宣言/局', 'bait 率', 'n(报价/局)'],
      sorted.map((r) => [
        r.label,
        f(r.flavor.bluffRate, r.flavor.n.seenBids),
        f(r.flavor.blindBidRate, r.flavor.n.bids),
        num(r.flavor.avgDepth),
        num(r.flavor.calcPerRound),
        num(r.flavor.declarePerRound),
        f(r.flavor.baitRate, r.flavor.n.says),
        `${r.flavor.n.bids}/${r.flavor.n.rounds}`,
      ]),
    ),
  );
  out.push('');
  if (spread) {
    out.push('**分化幅度**（同一把尺子上最远的两个模型）：');
    for (const [axis, s] of Object.entries(spread)) {
      if (!s.enough) {
        out.push(`- ${axis}：样本不足（只有 ${s.n} 个模型够格），不出结论`);
        continue;
      }
      out.push(
        `- ${axis}：${s.min.label} ${num(s.min.v)} ↔ ${s.max.label} ${num(s.max.v)}　差 **${num(s.spread)}**（${s.n} 个模型）`,
      );
    }
    out.push('');
    out.push(
      '> 判据留给人：机器只报"分没分开"。分开了算不算"另一个对手"，' +
        '要坐下来和它打过才知道（Q51 证据闸门的下半场）。',
    );
    out.push('');
  }

  out.push('## 台词留样（不评分）');
  out.push('> 台词质量评估**须等接地批次 G2 完成**——否则评的是被主客体颠倒污染的台词。这里只留样。');
  out.push('');
  for (const r of sorted) {
    if (!r.flavor.lines.length) continue;
    out.push(`**${r.label}**`);
    for (const l of r.flavor.lines) out.push(`- 第${l.round}局：「${l.say}」${l.belief ? `　（心里：${l.belief}）` : ''}`);
    out.push('');
  }

  out.push('## 成本');
  out.push('');
  out.push(
    table(
      ['模型', '输入 token', '输出 token', '缓存读', '花费(USD)', '平均延迟'],
      sorted.map((r) => [
        r.label,
        r.cost.inTokens,
        r.cost.outTokens,
        r.cost.cacheRead,
        `${r.cost.usd.toFixed(4)}${r.cost.usdFromApi ? '' : '(估)'}`,
        r.cost.avgLatencyMs == null ? '—' : `${r.cost.avgLatencyMs}ms`,
      ]),
    ),
  );
  out.push('');
  out.push(`合计 $${totalUsd.toFixed(4)}${estimated ? '（含估算项，非全额账单）' : '（回执账单）'}`);
  if (estimate) out.push(`开跑前估算 $${estimate.usd}（${estimate.note}）`);
  if (cache) out.push(`缓存：${cache.note}`);
  out.push('');
  return out.join('\n');
}
