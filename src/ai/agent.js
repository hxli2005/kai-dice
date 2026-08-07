// 老周（DESIGN §3.1/3.2）：LLM agent 决策器。
// 每手 1 次调用（§3.1 成本约束）→ 事实工具结果预注入（等价于"他每手都用计算器"）。
// 台词=真实推理的复述，事实全部来自注入的真实数据（§3.5 不许编）。
// 任何失败 → 沉默模式顶班（§3.4 降级链），明显变弱是诚实的。

import { allLegalBids, isLegalBid } from '../rules.js';
import { probBidTrue } from '../probability.js';
import { createSilentBot } from './silent.js';
import { chat } from './llm.js';

const SYSTEM = `你是老周，深夜小酒馆的老板，正和客人玩大话骰。人设：话少，句句带数据，记仇十年。台词一到两短句，不用感叹号，不解释规则；可以引用对方刚才的具体行为（用时、习惯、档案）。你收到的全是真实数据，禁止编造数字。
规则提要：双方各摇暗骰，轮流报"桌上至少有 N 个 X 点"，只能抬价（数量加大，或同数量点数加大）；认为对方吹牛就开牌，开错自己输，输家掉一颗骰子。默认 1 点是万能牌（斋局除外）。
严格输出一行 JSON，不要其他文字：
{"action":{"type":"bid","count":N,"face":F}或{"type":"challenge"}或{"type":"declare","declaration":"zhai"或"blind"},"say":"台词","note":"一句真实决策理由（记入档案，玩家看不到）"}`;

const pct = (p) => `${Math.round(p * 100)}%`;

// 本局叙事：看骰、报数与宣言序列，含用时指纹（§3.3；揭盅时机也是阅读材料，§2.3）
function narrate(events, you) {
  const start = events.findLastIndex((e) => e.type === 'roundStart');
  const lines = [];
  for (const e of events.slice(start + 1)) {
    const who = e.player === you ? '你' : '对方';
    const t = e.elapsedMs != null ? `（用时${(e.elapsedMs / 1000).toFixed(1)}秒）` : '';
    if (e.type === 'peek' && e.player !== you) lines.push(`对方掀盅看了骰`);
    if (e.type === 'bid') lines.push(`${who}报 ${e.count} 个 ${e.face}${t}`);
    if (e.type === 'declare')
      lines.push(`${who}宣言「${e.declaration === 'zhai' ? '斋' : '盲'}」${t}`);
  }
  return lines.length ? lines.join('；') : '（本局尚无动作）';
}

export function buildPrompts(ob, profile) {
  const total = ob.diceCount.you + ob.diceCount.opp;
  const bids = allLegalBids(ob.currentBid, ob.zhai, total);
  const p = (b) => probBidTrue(b, ob.yourDice, ob.diceCount.opp, ob.zhai);
  const top = [...bids].sort((a, b) => p(b) - p(a)).slice(0, 6);
  const facts = [
    `第 ${ob.round} 局。你 ${ob.diceCount.you} 颗骰：[${ob.yourDice.join(', ')}]，对方 ${ob.diceCount.opp} 颗暗骰。池 ${ob.potUnits} 注${ob.zhai ? '，斋局（1 不是万能牌）' : ''}。`,
    `本局进程：${narrate(ob.events, ob.you)}。`,
    ob.currentBid
      ? `当前报价：对方报「${ob.currentBid.count} 个 ${ob.currentBid.face}」。按你的骰子算，此话为真的概率 ${pct(p(ob.currentBid))}。`
      : `你是首报（数量至少 2）。`,
    `可选动作：${[
      ob.currentBid && `开牌`,
      bids.length &&
        `抬价（高可信候选：${top.map((b) => `${b.count}个${b.face}=${pct(p(b))}`).join('，')}；也可报其他合法阶梯）`,
      ...ob.legal
        .filter((a) => a.type === 'declare')
        .map((a) => `宣言「${a.declaration === 'zhai' ? '斋' : '盲'}」后再报`),
    ]
      .filter(Boolean)
      .join('；')}。`,
    profile ? `你对这位客人的档案笔记：${profile}` : '这位客人是生面孔，还没有档案。',
  ];
  return { system: SYSTEM, user: facts.join('\n') };
}

export function parseDecision(text, ob) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m[0]);
    const a = j.action;
    const total = ob.diceCount.you + ob.diceCount.opp;
    const ok =
      (a.type === 'challenge' && ob.legal.some((x) => x.type === 'challenge')) ||
      (a.type === 'bid' &&
        ob.legal.some((x) => x.type === 'bid') &&
        isLegalBid(a, ob.currentBid, ob.zhai, total)) ||
      (a.type === 'declare' &&
        ob.legal.some((x) => x.type === 'declare' && x.declaration === a.declaration));
    if (!ok) return null;
    return {
      action:
        a.type === 'bid'
          ? { type: 'bid', count: a.count, face: a.face }
          : a.type === 'declare'
            ? { type: 'declare', declaration: a.declaration }
            : { type: 'challenge' },
      say: typeof j.say === 'string' ? j.say.slice(0, 60) : '',
      note: typeof j.note === 'string' ? j.note.slice(0, 120) : '',
    };
  } catch {
    return null;
  }
}

// 结算 1 次调用（§3.1）：场终判词＋档案笔记。失败返回 null，调用方用模板判词。
export async function settleVerdict(channel, { won, statsText }, fetchFn) {
  try {
    const raw = await chat(
      channel,
      {
        system: SYSTEM.replace(/严格输出一行 JSON[\s\S]*$/, '') +
          '现在一场结束了，你在写这位客人的酒桌档案。判词两三句，必须引用给你的具体数据，不许编。严格输出一行 JSON：{"verdict":"给客人看的判词","note":"记进你档案本的一句观察"}',
        user: `${won ? '这场你输了。' : '这场你赢了。'}客人本场数据：${statsText}`,
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (typeof j.verdict !== 'string') return null;
    return { verdict: j.verdict.slice(0, 120), note: (j.note ?? '').slice(0, 80) };
  } catch {
    return null;
  }
}

// channel 为 null 时直接沉默模式（官方通道未配、额度耗尽等）
export function createLaoZhou({ channel, profile = '', fetchFn } = {}) {
  const silent = createSilentBot();
  const logs = []; // 决策日志（B.3）：台词事实来源与审计素材
  return {
    logs,
    async decide(ob) {
      if (ob.yourDice === null) return { action: { type: 'peek' } };
      const prompts = buildPrompts(ob, profile);
      let decision = null;
      let raw = null;
      if (channel) {
        try {
          raw = await chat(channel, prompts, fetchFn);
          decision = parseDecision(raw, ob);
        } catch {
          decision = null;
        }
      }
      const silentFallback = decision === null;
      if (silentFallback) decision = { action: silent.decide(ob), say: '', note: '' };
      logs.push({ round: ob.round, facts: prompts.user, raw, ...decision, silentFallback });
      return decision;
    },
  };
}
