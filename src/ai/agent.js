// LLM agent 决策器（DESIGN §3.1/3.2）。人设从 personas.js 的一等公民对象读取（Q10）。
// 每手 1 次调用（§3.1 成本约束）→ 事实工具结果预注入（等价于"他每手都用计算器"）。
// 台词=真实推理的复述，事实全部来自注入的真实数据（§3.5 不许编）。
// 任何失败 → 沉默模式顶班（§3.4 降级链），明显变弱是诚实的。

import { allLegalBids, isLegalBid } from '../rules.js';
import { probBidTrue } from '../probability.js';
import { createSilentBot } from './silent.js';
import { chat } from './llm.js';
import { TONES, DEFAULT_PERSONA } from './personas.js';

// SYSTEM 全部由人设五件套拼装：身份 + 嘴臭度 + 回复风格 + 性格缺陷（Q11）
// tableTalk：三人桌台词双层制（§2.5）——裁判层不许编 / 牌手层允许诈 / 各为其利 / 禁围剿
const TABLE_TALK = `
这是三人桌（你、客人、另一个对手），额外规矩：
- 关于你自己的手牌与意图，你可以虚张、误导、演戏（"我劝你别开，我这把是真的"）——说话是玩法。
- 关于可查证的事实（谁报过什么、战绩、档案、结算），一字不许编。
- 各为其利：你只为自己赢。对另一个对手的凶狠不得低于对客人，不许跟任何人联手针对第三方。
- 每手最多一句话，开牌时刻可以多说。`;
const personaSystem = (p, three) => `你是${p.name}，${p.identity}正和客人玩大话骰。${TONES[p.tone] ?? TONES.spicy}${p.style}你收到的全是真实数据，禁止编造数字。
${p.flaws}${three ? TABLE_TALK : ''}
规则提要：${three ? '三人各摇暗骰，轮流报"桌上（三家合计）至少有 N 个 X 点"，只能抬价；开牌只能开上家（对上一个报价者）。' : '双方各摇暗骰，轮流报"桌上至少有 N 个 X 点"，只能抬价（数量加大，或同数量点数加大）。'}认为对方吹牛就开牌，开错自己输，输家掉一颗骰子。骰子掉光出局。默认 1 点是万能牌（斋局除外）。
严格输出一行 JSON，不要其他文字：
{"action":{"type":"bid","count":N,"face":F}或{"type":"challenge"}或{"type":"declare","declaration":"zhai"或"blind"}或{"type":"peek"}（未看骰时掀盅），"say":"台词","note":"一句真实决策理由（记入档案，玩家看不到）"}`;

const pct = (p) => `${Math.round(p * 100)}%`;

// 称呼表：you→你；其余按 names 映射（三人桌需要分清是谁），缺省"对方"
const whoOf = (you, names) => (p) => (p === you ? '你' : (names?.[p] ?? '对方'));

// 本局叙事：看骰、报数与宣言序列，含用时指纹（§3.3；揭盅时机也是阅读材料，§2.3）
function narrate(events, you, names) {
  const who = whoOf(you, names);
  const start = events.findLastIndex((e) => e.type === 'roundStart');
  const lines = [];
  for (const e of events.slice(start + 1)) {
    const t = e.elapsedMs != null ? `（用时${(e.elapsedMs / 1000).toFixed(1)}秒）` : '';
    if (e.type === 'peek' && e.player !== you) lines.push(`${who(e.player)}掀盅看了骰`);
    if (e.type === 'bid') lines.push(`${who(e.player)}报 ${e.count} 个 ${e.face}${t}`);
    if (e.type === 'declare')
      lines.push(`${who(e.player)}宣言「${e.declaration === 'zhai' ? '斋' : '盲'}」${t}`);
  }
  return lines.length ? lines.join('；') : '（本局尚无动作）';
}

// 本场前情（§5.3-bis）：此前各局一句话事实——"第 3 局前引用早期行为"的原料
function matchRecap(events, you, names) {
  const rounds = [];
  let cur = null;
  for (const e of events) {
    if (e.type === 'roundStart') cur = { round: e.round, challenger: null, out: null };
    else if (!cur) continue;
    else if (e.type === 'challenge') cur.challenger = e.player;
    else if (e.type === 'reveal') cur.out = e;
    else if (e.type === 'roundEnd') rounds.push(cur);
  }
  const who = whoOf(you, names);
  return rounds
    .map((r) => {
      if (!r.out) return '';
      const b = r.out.bid;
      return `第${r.round}局：${who(b.player)}报${b.count}个${b.face}被${who(r.challenger)}开，${r.out.stands ? '成立' : '不成立'}，${who(r.out.loser)}掉一骰`;
    })
    .filter(Boolean)
    .join('；');
}

// 粗算（阿飞装备）：不给百分比，给手感话——他不是不知道世界，是懒得算精
const coarse = (p) => (p >= 0.7 ? '基本稳' : p >= 0.4 ? '五五开' : p >= 0.15 ? '悬' : '纯扯');

export function buildPrompts(ob, profile, persona = DEFAULT_PERSONA, ctx = {}) {
  const names = ctx.names;
  const three = (ob.players?.filter((q) => q.alive).length ?? 2) > 2 || !!ctx.three;
  const who = whoOf(ob.you, names);
  const total = ob.diceCount.you + ob.diceCount.opp;
  const bids = allLegalBids(ob.currentBid, ob.zhai, total);
  const myDice = ob.yourDice ?? []; // 盲局/未看骰：按零已见算——这就是他的真实认知
  const p = (b) => probBidTrue(b, myDice, ob.diceCount.opp, ob.zhai);
  const fmtP = persona.gear?.probInject === 'coarse' ? (v) => coarse(v) : (v) => pct(v);
  const top = [...bids].sort((a, b) => p(b) - p(a)).slice(0, 6);
  const isBlind = ob.blind?.[ob.you];
  const diceLine = ob.yourDice
    ? `你 ${ob.diceCount.you} 颗骰：[${ob.yourDice.join(', ')}]`
    : isBlind
      ? `你宣了盲——这局不看自己的骰盅（池已翻倍），${ob.diceCount.you} 颗骰蒙着打`
      : `你还没掀自己的骰盅（${ob.diceCount.you} 颗）`;
  const tableLine = three
    ? `桌上：${ob.players
        .filter((q) => q.id !== ob.you)
        .map((q) => `${who(q.id)}${q.alive ? ` ${q.diceCount} 颗暗骰` : '（已出局）'}`)
        .join('，')}`
    : `对方 ${ob.diceCount.opp} 颗暗骰`;
  const bidder = ob.currentBid ? who(ob.currentBid.player) : null;
  const facts = [
    `第 ${ob.round} 局。${diceLine}，${tableLine}。池 ${ob.potUnits} 注${ob.zhai ? '，斋局（1 不是万能牌）' : ''}。`,
    matchRecap(ob.events, ob.you, names) ? `本场前情：${matchRecap(ob.events, ob.you, names)}。` : null,
    `本局进程：${narrate(ob.events, ob.you, names)}。`,
    ob.currentBid
      ? persona.gear?.probInject === 'coarse'
        ? `当前报价：${bidder}报「${ob.currentBid.count} 个 ${ob.currentBid.face}」${three ? '（开牌只能开他）' : ''}。你粗掂量一下，这话${fmtP(p(ob.currentBid))}。`
        : `当前报价：${bidder}报「${ob.currentBid.count} 个 ${ob.currentBid.face}」${three ? '（开牌只能开他）' : ''}。按你的骰子算，此话为真的概率 ${fmtP(p(ob.currentBid))}。`
      : `你是首报（数量至少 2）。`,
    `可选动作：${[
      ob.currentBid && `开牌`,
      bids.length &&
        `抬价（候选：${top.map((b) => `${b.count}个${b.face}=${fmtP(p(b))}`).join('，')}；也可报其他合法阶梯）`,
      ...ob.legal
        .filter((a) => a.type === 'declare')
        .map((a) => `宣言「${a.declaration === 'zhai' ? '斋' : '盲'}」后再报`),
      !ob.yourDice && !isBlind && `掀盅看骰（看完这手再决定）`,
    ]
      .filter(Boolean)
      .join('；')}。`,
    profile ? `你对这位客人的档案笔记：${profile}` : '这位客人是生面孔，还没有档案。',
    ctx.hypotheses?.length
      ? `你摸出的规律假设（证据不足别硬套）：${ctx.hypotheses
          .map((h) => `「${h.text}」（证据${h.hits ?? 0}${h.misses?.length ? `，反例：${h.misses.join('、')}` : ''}）`)
          .join('；')}`
      : null,
    ob.round >= 2 && ob.round <= 3
      ? '【节拍要求】你在第 3 局结束前，至少要有一句台词引用对方本场更早的具体行为（让他知道你在记）。'
      : null,
  ].filter(Boolean);
  return { system: personaSystem(persona, three), user: facts.join('\n') };
}

export function parseDecision(text, ob) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m[0]);
    const a = j.action;
    const total = ob.diceCount.you + ob.diceCount.opp;
    const ok =
      (a.type === 'peek' && ob.legal.some((x) => x.type === 'peek')) ||
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
            : a.type === 'peek'
              ? { type: 'peek' }
              : { type: 'challenge' },
      say: typeof j.say === 'string' ? j.say.slice(0, 60) : '',
      note: typeof j.note === 'string' ? j.note.slice(0, 120) : '',
    };
  } catch {
    return null;
  }
}

// 被打脸即时反思（§3.3 复盘学习触发①）：开错或被反杀的局，当场修订规律假设。
// 输入全部为已公开信息（开牌即公开，合宪）。失败返回 null（假设不动）。
export async function reflect(channel, { persona, factText, hypotheses = [] }, fetchFn) {
  try {
    const raw = await chat(
      channel,
      {
        system: `你是${persona.name}。你刚在大话骰桌上被打脸了，现在快速修订你对这位客人的判断。规矩：假设必须由给你的事实支撑；证据不足的假设降权；被反例打死的假设保留并记下反例（尸体也是学问）。严格输出一行 JSON：{"hypotheses":[{"text":"一句假设","hits":证据次数,"misses":["反例场次"]}]}，最多 4 条。`,
        user: `刚发生的事：${factText}
你既有的假设：${
          hypotheses.length
            ? hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}${h.misses?.length ? `，反例：${h.misses.join('、')}` : ''}）`).join('；')
            : '（还没有）'
        }`,
        maxTokens: 300,
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (!Array.isArray(j.hypotheses)) return null;
    return j.hypotheses
      .slice(0, 4)
      .map((h) => ({ text: String(h.text ?? '').slice(0, 60), hits: +h.hits || 0, misses: (h.misses ?? []).slice(0, 3).map(String) }));
  } catch {
    return null;
  }
}

// 结算 1 次调用（§3.1）：场终判词＋档案笔记＋全量复盘假设（§3.3 触发②）。失败返回 null。
export async function settleVerdict(channel, { won, statsText, persona = DEFAULT_PERSONA, hypotheses = [] }, fetchFn) {
  try {
    const raw = await chat(
      channel,
      {
        system: personaSystem(persona).replace(/严格输出一行 JSON[\s\S]*$/, '') +
          '现在一场结束了，你在写这位客人的酒桌档案。判词两三句，必须引用给你的具体数据，不许编。顺手全量复盘你对他的规律假设（由数据支撑；被反例打死的保留尸体并记反例）。严格输出一行 JSON：{"verdict":"给客人看的判词","note":"记进你档案本的一句观察","hypotheses":[{"text":"一句假设","hits":证据次数,"misses":["反例"]}]}，假设最多 4 条。',
        user: `${won ? '这场你输了。' : '这场你赢了。'}客人本场数据：${statsText}${
          hypotheses.length
            ? `。你既有的假设：${hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}）`).join('；')}`
            : ''
        }`,
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (typeof j.verdict !== 'string') return null;
    return {
      verdict: j.verdict.slice(0, 120),
      note: (j.note ?? '').slice(0, 80),
      hypotheses: Array.isArray(j.hypotheses)
        ? j.hypotheses.slice(0, 4).map((h) => ({ text: String(h.text ?? '').slice(0, 60), hits: +h.hits || 0, misses: (h.misses ?? []).slice(0, 3).map(String) }))
        : null,
    };
  } catch {
    return null;
  }
}

// channel 为 null 时直接沉默模式（官方通道未配、额度耗尽等）。
// channel 可传函数（每手求值）——设置保存后下一手立即生效，不用等下一场。
export function createOpponent({ channel, profile = '', persona = DEFAULT_PERSONA, ctx = {}, fetchFn } = {}) {
  const silent = createSilentBot(persona.strategy); // 策略参数随人设（Q10④）
  const logs = []; // 决策日志（B.3）：台词事实来源与审计素材
  return {
    logs,
    persona,
    async decide(ob) {
      const canPeek = ob.legal.some((a) => a.type === 'peek');
      // 不玩盲的人设：未看骰直接掀盅（老李头）；爱盲的人设把"掀盅还是盲上"交给 LLM（阿飞）
      if (ob.yourDice === null && canPeek && !persona.gear?.usesBlind)
        return { action: { type: 'peek' } };
      const prompts = buildPrompts(ob, profile, persona, ctx);
      const ch = typeof channel === 'function' ? channel() : channel;
      let decision = null;
      let raw = null;
      let error = null;
      if (ch) {
        try {
          // maxTokens 压低：动作 JSON＋一句台词用不了多少，生成时长是节拍主项（T4 ≤4s）
          raw = await chat(ch, { ...prompts, maxTokens: 320 }, fetchFn);
          decision = parseDecision(raw, ob);
          if (decision === null) error = 'bad-output';
        } catch (e) {
          error = e?.message ?? 'unknown';
        }
      }
      const silentFallback = decision === null;
      if (silentFallback) decision = { action: silent.decide(ob), say: '', note: '' };
      logs.push({ round: ob.round, facts: prompts.user, raw, ...decision, silentFallback, error });
      return { ...decision, silentFallback, error };
    },
  };
}
