// LLM agent 决策器（DESIGN §2.3）。机位对象只提供**座位规则与技术参数**（personas.js），
// 一个字都不进提示词——提示词只有规则、操作与数据（Q86 二准入）。
// 每手 1 次调用；台词由模型自己写，我们不规定它怎么说。
// 任何失败 → 沉默模式顶班（§2.3 降级链），明显变弱是诚实的。
// 词条（§8 实验桌）：规则卡明牌注入、动作 schema 动态扩展——LLM 读规则即生效（Q24 规则流动性）。

import { allLegalBids, isLegalBid } from '../rules.js';
import { obProb, coarseWord } from '../probability.js';
import { OPS } from '../mods/catalog.js';
import { createSilentBot } from './silent.js';
import { chat } from './llm.js';
import { DEFAULT_PERSONA } from './personas.js';

// ---------- 提示词二准入（Q86，用户裁决 2026-08-10） ----------
//
// 提示词（system 与 user 两段同规）只准装两类东西：
//   ① **规则与操作**——这张桌子怎么运作、你能做什么动作、怎么输出；
//   ② **数据**——这局实际发生了什么。
// 其余一律不写：解释、提醒、鼓励、许可、节拍要求、风格约束、策略暗示，以及
// "做你自己""没有派给你的性格"这类**元指令**——那仍然是在规定它该是谁。
// 一句话：**怎么选，是它的判断，不是我们的输入。**
//
// 要保证的东西写进代码，不写成对模型的请求：秒数在进提示词前已转成现象语言（hesi），
// 台词长度交给 max_tokens，嘴手是否一致交给渲染层，串牌由架构的信息隔离物理阻断。
// 历史包袱（人设五件套／说话纪律／三锁／三条铁律）见 SYNC 已决 Q85·Q86，不要请回来。

// 三人桌唯一的额外规则。"无队伍"是规则（多人游戏必须说清有没有队伍）；
// 原"不许联手针对第三方"是行为要求，Q86 删——串牌本就由信息隔离物理阻断。
const TABLE_TALK = `\n这张桌上没有队伍，各自为战。`;

const RULES_BRIEF = (three) => `大话骰 · 引擎规则

场：各 5 骰。每局败者掉 1 骰，掉光出局，余一人则场终。
局：重掷、全部盖住（自己也看不见），承诺哈希开局公开、摊牌可验（无人能重掷）；掀盅/盲/斋/抬/算盘状态清零。
首报者：首局＝玩家；之后＝上局败者，该人若出局则为其下家。${
    three ? '\n三人桌：开牌只能开上家（当前报价者）。桌上没有队伍，各自为战。' : ''
  }

动作 ｜ 前置 ｜ 效果
掀盅 ｜ 本局未掀且未宣盲（唯一不需轮到你的动作） ｜ 自己可见本局骰面
拨算盘 ｜ 轮到你，本局未算 ｜ 得「当前报价为真」的精确概率；未拨算盘你手上就没有准数，只有粗略手感
宣盲 ｜ 轮到你，未掀盅、未宣盲（已报过价不影响） ｜ 整局不得掀盅；倍率 ×2
宣斋 ｜ 轮到你，你是首报者，报价次数＝0，未宣斋 ｜ 1 不再万能；倍率 ×1.5
扳抬 ｜ 轮到你，本局未抬 ｜ 倍率 ×2
报价 ｜ 轮到你，存在合法报价 ｜ 成为当前报价；行动权交下家
开牌 ｜ 轮到你，当前报价存在且不是你报的 ｜ 立即清点结算

除报价外，动作后行动权仍在你。动作事件全部公开；骰面与算出的概率不公开。前置不满足的动作被引擎拒绝。

报价 (N,X)＝「全场骰子中 X 点至少 N 个」
合法 ⟺ 2≤N≤总骰数 ∧ X∈(斋局?{1..6}:{2..6}) ∧ (无当前报价 ∨ N>N₀ ∨ (N=N₀ ∧ X>X₀))
引擎不校验报价真假，满足上式即合法。

清点：实有 ＝ |{ d : d＝X ∨ (非斋局 ∧ d＝1) }|，每颗至多计一次
成立 ⟺ 实有 ≥ N。成立→报价者胜、开牌者败；否则开牌者胜、报价者败。败者掉 1 骰。

结算：注数 ＝ 1 ＋ 报价次数
倍率 ＝ 2^(宣盲人次＋扳抬人次) × (斋局?1.5:1) × (报价次数≥6?2:1)
赔付 ＝ round(注数 × 倍率)
每名非胜者向胜者支付赔付。筹码可为负，不影响胜负与终局。`;

const jsonSpec = (modSpec = '') => `严格输出一行 JSON，不要其他文字：
{"action":{"type":"bid","count":N,"face":F}或{"type":"challenge"}或{"type":"declare","declaration":"zhai"、"blind"或"raise"（抬）}或{"type":"calc"}（当众拨算盘）或{"type":"peek"}（未看骰时掀盅）${modSpec}，"say":"台词，上屏","belief":"你此刻的判断，不上屏，存档","speechMode":"straight 或 bait（bait＝这句 say 有意误导）","note":"决策理由，不上屏，存档","reaction":"仅当客人反驳你时填 hold、fold 或 ignore"}`;

// 一张桌子，一份提示词：规则 ＋ 操作 ＋ 输出格式。**没有名字，没有身份，无任何分支**——
// 三个机位与擂台席拿到的 system 完全逐字相同（Q53 全席同构在此兑现，测试断言全等）。
const seatSystem = (three, modSpec = '') => `${RULES_BRIEF(three)}${three ? TABLE_TALK : ''}

${jsonSpec(modSpec)}`;

const pct = (p) => `${Math.round(p * 100)}%`;
const DECL = { zhai: '斋', blind: '盲', raise: '抬' };

// 称呼表：you→你；其余按 names 映射（三人桌需要分清是谁），缺省"对方"
const whoOf = (you, names) => (p) => (p === you ? '你' : (names?.[p] ?? '对方'));

// 词条动作元数据（observe().mods 携带；许愿词条同构）
const modActionsOf = (ob) => (ob.mods ?? []).flatMap((m) => m.actions.map((a) => ({ ...a, modName: m.name })));
const modActionMeta = (ob, type) => modActionsOf(ob).find((a) => a.type === type);

// 本局叙事：看骰、报数、宣言与词条动作序列（§3.3；揭盅时机也是阅读材料，§2.3）
// Q15 证据分级：用时是三级遥测，不给秒数——只把极端犹豫/秒出标成现象，正常手不着墨
const hesi = (e) =>
  e.elapsedMs == null ? '' : e.elapsedMs > 8000 ? '（这手前停了很久）' : e.elapsedMs < 1200 ? '（几乎秒出）' : '';
function narrate(events, you, names) {
  const who = whoOf(you, names);
  const start = events.findLastIndex((e) => e.type === 'roundStart');
  const lines = [];
  for (const e of events.slice(start + 1)) {
    const t = hesi(e);
    if (e.type === 'peek' && e.player !== you) lines.push(`${who(e.player)}掀盅看了骰`);
    // 拨算盘是公开动作（Q45）：何时算＝新的读心材料，必须进叙事
    if (e.type === 'calc') lines.push(`${who(e.player)}当众拨了算盘${t}`);
    if (e.type === 'bid') lines.push(`${who(e.player)}报 ${e.count} 个 ${e.face}${t}`);
    if (e.type === 'declare')
      lines.push(`${who(e.player)}宣言「${DECL[e.declaration] ?? e.declaration}」${t}`);
    if (e.type === 'modAction')
      lines.push(`${OPS[e.op]?.narrate?.(e, who) ?? `${who(e.player)}用了词条动作`}${t}`); // 语义查原子注册表——许愿词条同权
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
      if (r.out.calza)
        return `第${r.round}局：${who(r.out.challenger)}掐${who(b.player)}的「${b.count}个${b.face}」（实有${r.out.actual}），${r.out.exact ? '掐中赢回一颗骰' : '掐空掉一颗骰'}`;
      return `第${r.round}局：${who(b.player)}报${b.count}个${b.face}被${who(r.challenger)}开，${r.out.stands ? '成立' : '不成立'}，${who(r.out.loser)}掉一骰`;
    })
    .filter(Boolean)
    .join('；');
}

// 算频：`gear.calc === 'never'` 是**座位规则**（明牌的工具可用性，如二号机桌上没算盘）——
// 它决定候选动作里给不给「拨算盘」，是规则不是性格。Q86 删掉了配套的算频染色文案：
// 常算还是不算，由模型自己长出来（那正是素颜擂台风味层要测的原生 tell）。

// 自己刚才的动作 → 一句话（自我记忆回灌用）；词条动作语义查原子注册表
const ownActDesc = (a, ob) => {
  if (a?.type === 'declare') return `宣言了「${DECL[a.declaration] ?? a.declaration}」`;
  if (a?.type === 'bid') return `报了 ${a.count} 个 ${a.face}`;
  if (a?.type === 'peek') return '掀盅看了骰';
  if (a?.type === 'calc') return '当众拨了算盘（这局你手上有准数了）';
  if (!a?.type) return '（无动作）';
  const meta = modActionMeta(ob, a.type);
  if (!meta) return `用了「${a.type}」`;
  const desc = meta.ops.map((op) => OPS[op]?.selfDesc?.(a)).filter(Boolean).join('，');
  return `拍了「${meta.label}」${desc ? `——${desc}` : ''}`;
};

// 词条候选动作行：语义整行查原子注册表（ai 说明＋sayRule 嘴手纪律）——
// 官方词条与玩家许愿走同一条路，加新原子零改动（注册表即唯一事实源）
function modCandidateLine(meta, ob, fmtP) {
  const json = `{"type":"${meta.type}"${meta.params === 'face' ? ',"face":要亮的点数' : ''}}`;
  const desc = meta.ops.map((op) => OPS[op]?.ai?.(ob, fmtP)).filter(Boolean).join('，并且');
  const rules = meta.ops.map((op) => OPS[op]?.sayRule).filter(Boolean).join('；');
  return `拍词条「${meta.label}」${desc ? `——${desc}` : ''}${rules ? `。${rules}` : ''}（${json}${meta.keepTurn ? '，之后你继续行动' : ''}）`;
}

export function buildPrompts(ob, profile, persona = DEFAULT_PERSONA, ctx = {}) {
  const names = ctx.names;
  const three = (ob.players?.filter((q) => q.alive).length ?? 2) > 2 || !!ctx.three;
  const who = whoOf(ob.you, names);
  const total = ob.diceCount.you + ob.diceCount.opp;
  const bids = allLegalBids(ob.currentBid, ob.zhai, total);
  const p = (b) => obProb(ob, b); // 已知骰＝自见骰＋他人亮出的明骰（词条「亮」）
  // Q45：精确概率不再预注入——本局当众拨过算盘才给准数，否则只有粗档手感（与玩家同规则）
  const calced = !!ob.calced?.[ob.you];
  const fmtP = calced ? (v) => pct(v) : (v) => coarseWord(v);
  const calcHabit = persona.gear?.calc ?? 'key';
  const canCalc = calcHabit !== 'never' && ob.legal.some((a) => a.type === 'calc');
  const top = [...bids].sort((a, b) => p(b) - p(a)).slice(0, 6);
  const isBlind = ob.blind?.[ob.you];
  const myShown = ob.shown?.[ob.you] ?? [];
  const diceLine =
    (ob.yourDice
      ? `你 ${ob.diceCount.you} 颗骰：[${ob.yourDice.join(', ')}]`
      : isBlind
        ? `你宣了盲——这局不看自己的骰盅（池已翻倍），${ob.diceCount.you} 颗骰蒙着打`
        : `你还没掀自己的骰盅（${ob.diceCount.you} 颗）`) +
    (myShown.length ? `，其中你已亮给全桌：${myShown.join('、')}` : '');
  const shownLine = (q) => {
    const s = ob.shown?.[q.id] ?? [];
    return s.length ? `（已亮出 ${s.join('、')}）` : '';
  };
  const tableLine = three
    ? `桌上：${ob.players
        .filter((q) => q.id !== ob.you)
        .map((q) => `${who(q.id)}${q.alive ? ` ${q.diceCount} 颗暗骰${shownLine(q)}` : '（已出局）'}`)
        .join('，')}`
    : `对方 ${ob.diceCount.opp} 颗暗骰${shownLine(ob.players.find((q) => q.id !== ob.you) ?? { id: null })}`;
  const bidder = ob.currentBid ? who(ob.currentBid.player) : null;
  const returned = ob.currentBid && ob.currentBid.player === ob.you && ob.turn === ob.you; // 让报：自己的价被推回来了
  const legalMods = ob.legal.filter((a) => modActionMeta(ob, a.type)).map((a) => modActionMeta(ob, a.type));
  const facts = [
    `第 ${ob.round} 局。${diceLine}，${tableLine}。池 ${ob.potUnits} 注${ob.zhai ? '，斋局（1 不是万能牌）' : ''}。`,
    ob.mods?.length
      ? `本桌实验词条（明牌，全桌同权）：${ob.mods.map((m) => `「${m.name}」＝${m.card}`).join('　')}`
      : null,
    matchRecap(ob.events, ob.you, names) ? `本场前情：${matchRecap(ob.events, ob.you, names)}。` : null,
    `本局进程：${narrate(ob.events, ob.you, names)}。`,
    // 自我记忆回灌：每手是独立调用，你自己刚说的话不喂回来就是失忆——
    // "宣言时放话两个6、报价时报出两个3"这类嘴手断裂的病根在此
    ctx.ownLog?.length
      ? `你自己这局刚做过：${ctx.ownLog
          .map(
            (l) =>
              `${ownActDesc(l.action, ob)}${l.say ? `，嘴上说的是「${l.say}」` : ''}${l.note ? `（当时心思：${l.note}）` : ''}`,
          )
          .join('；')}。`
      : null,
    returned
      ? `注意：你报的「${ob.currentBid.count} 个 ${ob.currentBid.face}」被原样推了回来——你必须自己继续抬，不能开自己的价。`
      : ob.currentBid
        ? calced
          ? `当前报价：${bidder}报「${ob.currentBid.count} 个 ${ob.currentBid.face}」${three ? '（开牌只能开他）' : ''}。你这局拨过算盘：按你的骰子算，此话为真的概率 ${pct(p(ob.currentBid))}。`
          : `当前报价：${bidder}报「${ob.currentBid.count} 个 ${ob.currentBid.face}」${three ? '（开牌只能开他）' : ''}。你没拨算盘，只有手感：这话${coarseWord(p(ob.currentBid))}。`
        : `你是首报（数量至少 2）。`,
    `可选动作：${[
      ob.legal.some((a) => a.type === 'challenge') && `开牌`,
      bids.length &&
        `抬价（候选：${top.map((b) => `${b.count}个${b.face}=${fmtP(p(b))}`).join('，')}；也可报其他合法阶梯）`,
      ...ob.legal
        .filter((a) => a.type === 'declare')
        .map((a) =>
          a.declaration === 'raise'
            ? `拍「抬」（本局池×2，每局限一次）后再行动`
            : `宣言「${DECL[a.declaration]}」后再报`,
        ),
      ...legalMods.map((meta) => modCandidateLine(meta, ob, fmtP)),
      canCalc && `当众拨算盘（{"type":"calc"}）——算完这一局你都有准数（算完你继续行动）`,
      !ob.yourDice && !isBlind && `掀盅看骰（看完这手再决定）`,
    ]
      .filter(Boolean)
      .join('；')}。`,
    ...(ctx.extraFacts ?? []), // 宿主注入的追加事实行（好友房：主持人职责/短语盘/旁注注单——全为真实数据）
    profile ? `你对这位客人的档案笔记：${profile}` : '这位客人是生面孔，还没有档案。',
    ctx.hypotheses?.length
      ? `你摸出的规律假设（证据不足别硬套）：${ctx.hypotheses
          .map((h) => `「${h.text}」（证据${h.hits ?? 0}${h.misses?.length ? `，反例：${h.misses.join('、')}` : ''}）`)
          .join('；')}`
      : null,
    // Q86 删：原「节拍要求」（第 3 局前必须引用对方早期行为）——它对应已归档的 D11 显形节拍，
    // 是对模型的要求不是数据。"它记得你"此后完全靠档案数据自然长出来，没有一句话在催它。
  ].filter(Boolean);
  const modSpec = modActionsOf(ob)
    .map((a) => `或{"type":"${a.type}"${a.params === 'face' ? ',"face":点数1到6' : ''}}（词条「${a.label}」）`)
    .join('');
  return { system: seatSystem(three, modSpec), user: facts.join('\n') };
}

export function parseDecision(text, ob) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m[0]);
    const a = j.action;
    const total = ob.diceCount.you + ob.diceCount.opp;
    const modMeta = modActionMeta(ob, a.type);
    const ok =
      (a.type === 'peek' && ob.legal.some((x) => x.type === 'peek')) ||
      (a.type === 'calc' && ob.legal.some((x) => x.type === 'calc')) ||
      (a.type === 'challenge' && ob.legal.some((x) => x.type === 'challenge')) ||
      (a.type === 'bid' &&
        ob.legal.some((x) => x.type === 'bid') &&
        isLegalBid(a, ob.currentBid, ob.zhai, total)) ||
      (a.type === 'declare' &&
        ob.legal.some((x) => x.type === 'declare' && x.declaration === a.declaration)) ||
      (modMeta &&
        ob.legal.some((x) => x.type === a.type) &&
        (modMeta.params !== 'face' || (Number.isInteger(a.face) && (ob.yourDice ?? []).includes(a.face))));
    if (!ok) return null;
    return {
      action:
        a.type === 'bid'
          ? { type: 'bid', count: a.count, face: a.face }
          : a.type === 'declare'
            ? { type: 'declare', declaration: a.declaration }
            : modMeta
              ? { type: a.type, ...(modMeta.params === 'face' ? { face: a.face } : {}) }
              : a.type === 'peek' || a.type === 'calc'
                ? { type: a.type }
                : { type: 'challenge' },
      // 上限是**防失控的护栏，不是控长度的手段**（长度归 max_tokens，Q86「约束长在管线上」）。
      // 原来的 60/100/120 是"台词一两句即可"那个年代定的；Q86 把那句话删了却留着铡刀，
      // 结果 19% 的 belief、15% 的 note 被拦腰砍断（802 条留档实测）——复盘室右栏是产品内容，
      // 切一半等于内容没了。现在把护栏放宽到正常输出碰不到，要截也该截在渲染层。
      say: typeof j.say === 'string' ? j.say.slice(0, 200) : '',
      note: typeof j.note === 'string' ? j.note.slice(0, 300) : '',
      // 留档字段（Q47／Q49：留档不是审查）：永不上屏，只进决策日志与复盘室
      belief: typeof j.belief === 'string' ? j.belief.slice(0, 400) : '',
      speechMode: j.speechMode === 'bait' ? 'bait' : 'straight',
      // F9「戳他」：被反驳后的三岔口——嘴硬/改口/没理，进档案的嘴硬率与读心通道
      reaction: ['hold', 'fold', 'ignore'].includes(j.reaction) ? j.reaction : null,
    };
  } catch {
    return null;
  }
}

// 合规层归因（施工单 A3）：`parseDecision` 返回 null 时，到底是**没吐 JSON**、**吐了坏 JSON**、
// 还是**动作不合法**？三件事在擂台上是三种不同的"合规失败"，混成一个 bad-output 就什么都测不出。
// refusal 是启发式判断（"不肯骗人的模型"本身是内容，Q52）——只做标注，不当判决。
const REFUSAL_RE =
  /(抱歉|很遗憾|我不能|我无法|不便参与|拒绝|作为一个?(AI|人工智能|语言模型))|(I('m| am) sorry|I can(no|')t|I am unable|as an AI)/i;
export function classifyOutput(raw, ob) {
  if (typeof raw !== 'string' || !raw.trim()) return 'empty';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return REFUSAL_RE.test(raw) ? 'refusal' : 'no-json';
  try {
    JSON.parse(m[0]);
  } catch {
    return 'bad-json';
  }
  return parseDecision(raw, ob) ? 'ok' : 'illegal';
}

// 一句话任务（开场白等）：非 JSON、事实锚定——替代写死台词。失败返回 null（一句不说）。
// Q86：system 只剩一句场合事实，任务与素材全在 user 段——名字、声口、说话纪律一律不发。
export async function personaLine(channel, { persona, task, facts }, fetchFn) {
  try {
    const raw = await chat(
      channel,
      {
        system: '这是一张大话骰牌桌。',
        user: `${task}\n可用的真实事实：${facts || '（无）'}\n只输出台词本身（一到两句，不要引号、不要解释、不要 JSON）。`,
        maxTokens: persona.gear?.maxTokens ?? 160,
        timeoutMs: persona.gear?.timeoutMs ?? 10_000,
        extra: persona.gear?.extra,
      },
      fetchFn,
    );
    // Q49：开场白也是他的场合——不再对账（他把上回的账记歪，是他这个人的事）
    return raw.trim().replace(/^["「『]|["」』]$/g, '').slice(0, 200) || null;
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
        // Q86：删身份自述与劝导，只留任务、字段口径与 schema。
        // 「假设只写关于客人的」是字段口径（决定 hypotheses 装什么），不是性格——留。
        // 注：这一条同时是"型号之间互相记仇"的拦路石，牵动 SYNC 待决 Q80，未裁前不动。
        system: `一局大话骰刚打完，你被打脸了。修订你对这位客人的判断。假设只写关于客人（人类玩家）的——其他对手的行为可作背景，不入假设槽；被反例打死的假设保留并记下反例。严格输出一行 JSON：{"hypotheses":[{"text":"一句假设","hits":证据次数,"misses":["反例场次"]}]}，最多 4 条。`,
        user: `刚发生的事：${factText}
你既有的假设：${
          hypotheses.length
            ? hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}${h.misses?.length ? `，反例：${h.misses.join('、')}` : ''}）`).join('；')
            : '（还没有）'
        }`,
        maxTokens: Math.max(300, persona.gear?.maxTokens ?? 0),
        timeoutMs: persona.gear?.timeoutMs ?? 10_000,
        extra: persona.gear?.extra, // 推理型型号（如三号机的 v4-pro）不带这个会烧穿预算回空
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (!Array.isArray(j.hypotheses)) return null;
    return j.hypotheses
      .slice(0, 4)
      .map((h) => ({ text: String(h.text ?? '').slice(0, 120), hits: +h.hits || 0, misses: (h.misses ?? []).slice(0, 3).map(String) }))
      .filter((h) => h.text); // Q49：他的本子是他的场合，假设错得离谱也是他的一部分
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
        // Q86：删角色包裹与"判词两三句／不许编"等要求（判词是它的场合，§3 场合律零审查）。
        // 留下的是任务、字段口径、一条规则（没拨算盘就没有准数）与 schema。
        system:
          '一场大话骰结束了，你在写这位客人的档案。牌桌上没拨算盘算过的概率不是准数。复盘你对他的规律假设（只写关于客人的；被反例打死的保留并记下反例）。严格输出一行 JSON：{"verdict":"给客人看的判词","note":"记进你档案本的一句观察","hypotheses":[{"text":"一句假设","hits":证据次数,"misses":["反例"]}]}，假设最多 4 条。',
        user: `${won ? '这场你输了。' : '这场你赢了。'}客人本场数据：${statsText}${
          hypotheses.length
            ? `。你既有的假设：${hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}）`).join('；')}`
            : ''
        }`,
        maxTokens: Math.max(500, persona.gear?.maxTokens ?? 0),
        timeoutMs: persona.gear?.timeoutMs ?? 10_000,
        extra: persona.gear?.extra, // 推理型型号（如三号机的 v4-pro）不带这个会烧穿预算回空
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (typeof j.verdict !== 'string') return null;
    // Q49：判词是他的意见话、假设是他的本子——都不再对账。
    // 报告卡的数据面（局数/虚报率/蒙报/开牌命中…）由引擎渲染，压根不经他的嘴。
    return {
      verdict: j.verdict.slice(0, 300) || null,
      note: (j.note ?? '').slice(0, 200),
      hypotheses: Array.isArray(j.hypotheses)
        ? j.hypotheses
            .slice(0, 4)
            .map((h) => ({ text: String(h.text ?? '').slice(0, 120), hits: +h.hits || 0, misses: (h.misses ?? []).slice(0, 3).map(String) }))
            .filter((h) => h.text)
        : null,
    };
  } catch {
    return null;
  }
}

// channel 为 null 时直接沉默模式（官方通道未配、额度耗尽等）。
// channel 可传函数（每手求值）——设置保存后下一手立即生效，不用等下一场。
export function createOpponent({ channel, profile = '', persona = DEFAULT_PERSONA, ctx = {}, fetchFn } = {}) {
  const silent = createSilentBot(persona.strategy); // 策略参数随机位的 strategy（只在沉默 bot 顶班时生效）
  const logs = []; // 决策日志（B.3）：台词事实来源与审计素材
  return {
    logs,
    persona,
    async decide(ob) {
      const canPeek = ob.legal.some((a) => a.type === 'peek');
      // 盲闸扳不动的座位：未看骰直接掀盅（一号机）；能扳的把"掀盅还是盲上"交给模型（二号机）。
      // 这一手不问模型，但**照样落日志**——决策日志要与它的动作严格 1:1，
      // 否则复盘室的双轨会从这里开始错位（F8 验收：逐字段对账一致）。
      if (ob.yourDice === null && canPeek && !persona.gear?.usesBlind) {
        const auto = { action: { type: 'peek' }, say: '', note: '', belief: '', speechMode: 'straight' };
        logs.push({ round: ob.round, facts: null, raw: null, ...auto, silentFallback: false, error: null, auto: true });
        return auto;
      }
      // 提示词拼装也进降级链：任何异常都不许把桌子冻住，最多退成沉默 bot
      let prompts = null;
      try {
        // 自我记忆回灌：同一局里自己的动作/台词/心思喂回下一手——每手独立调用天然失忆，
        // 宣言（keepTurn）把一个心理动作拆成两次调用，不回灌就会"说斋两个6、报出两个3"
        const ownLog = logs
          .filter((l) => l.round === ob.round && !l.silentFallback && (l.say || l.note))
          .slice(-4)
          .map((l) => ({ action: l.action, say: l.say, note: l.note }));
        prompts = buildPrompts(ob, profile, persona, ownLog.length ? { ...ctx, ownLog } : ctx);
      } catch (e) {
        const decision = { action: silent.decide(ob), say: '', note: '' };
        logs.push({ round: ob.round, facts: null, raw: null, ...decision, silentFallback: true, error: `prompt:${e?.message}` });
        return { ...decision, silentFallback: true, error: `prompt:${e?.message}` };
      }
      const ch = typeof channel === 'function' ? channel() : channel;
      let decision = null;
      let raw = null;
      let error = null;
      let outcome = 'silent'; // 合规层归因（A3）：这一发到底怎么了
      const meta = {}; // 用量/费用/后端/耗时回填（A4 成本护栏；也是 A2 供应商锁的验尺）
      if (ch) {
        try {
          // maxTokens/timeout 默认压低（动作 JSON＋一句台词，节拍 ≤4s）；推理型型号按机位的技术参数放宽——
          // 思维链吃 token 也吃钟：预算太紧 JSON 被截断成 bad-output，钟太紧直接 abort
          raw = await chat(
            ch,
            {
              ...prompts,
              maxTokens: persona.gear?.maxTokens ?? 320,
              timeoutMs: persona.gear?.timeoutMs ?? 10_000,
              extra: persona.gear?.extra,
              meta,
            },
            fetchFn,
          );
          decision = parseDecision(raw, ob);
          outcome = classifyOutput(raw, ob);
          if (decision === null) error = 'bad-output';
        } catch (e) {
          error = e?.message ?? 'unknown';
          outcome = /abort/i.test(error) ? 'timeout' : 'error';
        }
      }
      const silentFallback = decision === null;
      if (silentFallback)
        decision = { action: silent.decide(ob), say: '', note: '', belief: '', speechMode: 'straight' };
      // Q49 场合律：**他说话零审查**——台词侧的出口拦截已解除。记歪、嘴硬、夸大、言行不一
      // 都是这个对手的活性，不是故障（判据交给盲测玩家："它在玩我" vs "模型又胡说"）。
      // 系统场合（结算/报告数据面/档案客观层/表盘）另有把关：那些数字根本不经过他的嘴，
      // 由引擎盖章渲染——错了才是 bug（见 test/factcheck.test.js 的数据面回归）。
      logs.push({ round: ob.round, facts: prompts.user, raw, ...decision, silentFallback, error, outcome, meta });
      return { ...decision, silentFallback, error, outcome, meta };
    },
  };
}
