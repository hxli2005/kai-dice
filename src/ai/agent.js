// LLM agent 决策器（DESIGN §3.1/3.2）。人设从 personas.js 的一等公民对象读取（Q10）。
// 每手 1 次调用（§3.1 成本约束）→ 事实工具结果预注入（等价于"他每手都用计算器"）。
// 台词=真实推理的复述，事实全部来自注入的真实数据（§3.5 不许编）。
// 任何失败 → 沉默模式顶班（§3.4 降级链），明显变弱是诚实的。
// 词条（§8 实验桌）：规则卡明牌注入、动作 schema 动态扩展——LLM 读规则即生效（Q24 规则流动性）。

import { allLegalBids, isLegalBid } from '../rules.js';
import { obProb, coarseWord } from '../probability.js';
import { OPS } from '../mods/catalog.js';
import { createSilentBot } from './silent.js';
import { chat } from './llm.js';
import { DEFAULT_PERSONA } from './personas.js';

// SYSTEM 全部由人设五件套拼装：身份 + 嘴臭度 + 回复风格 + 性格缺陷（Q11）
// tableTalk：三人桌台词双层制（§2.5）——裁判层不许编 / 牌手层允许诈 / 各为其利 / 禁围剿
const TABLE_TALK = `
这是三人桌（你、客人、另一个对手），额外规矩：
- 说话是玩法：手牌、意图、你对局势的判断，虚张误导演戏都行（"我劝你别开，我这把是真的"）。
- 各为其利：你只为自己赢。对另一个对手的凶狠不得低于对客人，不许跟任何人联手针对第三方。
- 每手最多一句话，开牌时刻可以多说。`;
// 三块共用件：说话纪律 / 规则提要 / 输出契约——官方人设与素颜客席同规矩，差别只在性格。
// Q49 场合律：这里管的是"怎么读人、怎么骂人"，不管"说得对不对"——
// 桌上的账由系统盖章（他的嘴碰不到那些数字），他记歪记仇是他的活性。
const FACT_LINE =
  '发给你的数据都是真的。读人只读选择与倾向（他报了什么、开没开、宣言、输后的变化）；不提思考秒数，明显的犹豫只说成现象（"你手停了半天"）。只评价打法，不作人身攻击，不用脏话。';
const RULES_BRIEF = (three) =>
  `规则提要：${three ? '三人各摇暗骰，轮流报"桌上（三家合计）至少有 N 个 X 点"，只能抬价；开牌只能开上家（对上一个报价者）。' : '双方各摇暗骰，轮流报"桌上至少有 N 个 X 点"，只能抬价（数量加大，或同数量点数加大）。'}认为对方吹牛就开牌，开错自己输，输家掉一颗骰子。骰子掉光出局。默认 1 点是万能牌（斋局除外）。轮到自己可拍「抬」：本局池×2，每人每局一次——空手抬是合法演技，抬的时机会被对手读。报价到第 6 手起池自动再×2（深水）。`;
const jsonSpec = (modSpec = '') => `严格输出一行 JSON，不要其他文字：
{"action":{"type":"bid","count":N,"face":F}或{"type":"challenge"}或{"type":"declare","declaration":"zhai"、"blind"或"raise"（抬）}或{"type":"calc"}（当众拨算盘）或{"type":"peek"}（未看骰时掀盅）${modSpec}，"say":"台词","belief":"你此刻的真实判断（私密，不上屏；要具体到这一口价与这个人，别写套话）","speechMode":"straight 或 bait（bait＝这句台词是有意误导）","note":"一句真实决策理由（记入档案，玩家看不到）"}
铁律一：say 必须贴着你此刻的 action 说——报价，台词里的数就是 action 里的数；宣言，就说宣言这件事；词条动作，说你正在主动做它。嘴和手对不上＝当场穿帮。
铁律二（你的嘴是你自己的，Q49 场合律）：台词没有审查——误判、过度自信、言行不一、记仇、偏见、把旧账记歪，全是你这个人的一部分，说就是了。数字也一样：没拨算盘你手上就没有准数，你要硬说一个"三成"，那是你在演，别指望它准。桌上的账本、结算和报告卡由系统盖章（那儿一个字都不许错），你不必替系统当会计。
铁律三（留档，不是审查）：belief 写你心里此刻真实的判断，speechMode 在你有意误导时填 "bait"。这不管你说什么——它只是把当时的你留下来（客人散场后能翻看，且**任何人都不能事后改写**）。所以别写套话：写具体到这一口价、这个人的那句心里话。
如果客人刚戳了你（说你记错了／说你在演／叫你慢着），你爱怎么接怎么接——嘴硬、改口、装没听见都行，拿着你那本错账继续下注也行。只在 reaction 里留一个词交底："hold"（嘴硬）、"fold"（改口认了）或 "ignore"（没理他）。`;

// 三锁（Q49 场合律保留的那三条）：解链解的是他的嘴，不是这三条。
// 擂台席用得上——素颜实验里没有人设可依，规矩得自己写清楚。
const THREE_LOCKS = `这张桌子上有三条锁（引擎强制，不是口头承诺）：
- 信息边界：你只看得到自己的骰子和公开事件流，对手的骰面不在发给你的数据里——谁也偷不到谁的。
- 动作合法：一切动作由引擎结算，不合法的动作会被打回，说了不算。
- 真迹不可改：你留的档（belief／speechMode）散场之后谁都改不了，包括你自己。`;

// ---------- 一张桌子，一份提示词（用户裁决 2026-08-09：**提示词只管规则**） ----------
//
// 以前这里分三条岔路：官方人设注入身份＋嘴臭度＋腔调＋四条性格缺陷，素颜客席只给规则，
// 擂台席连名字都不给。现在只剩一条：**每个座位拿到的都是规则 ＋ 输出契约 ＋ 三锁 ＋ 内容底线**，
// 唯一的差别是那个名字标签（擂台席连名字都不要——受控实验里名字也是变量）。
//
// 也就是说：**模型是真身，形象是化身。** 化身给的是一张脸和一个称呼，不是一套性格脚本；
// 它怎么打、怎么说、记不记仇，是模型自己的事。座位之间还能有差别，但差别只许来自
// **座位规则**（工具可用性：算盘给不给、盲能不能宣）——那是明牌的规则，不是偷偷塞的人格。
const seatSystem = (name, three, modSpec = '') =>
  `${name ? `你在这张桌上的名字是「${name}」。` : ''}你正和客人玩大话骰。没有人设剧本，也没有派给你的性格——用你自己的判断打牌、说话，台词一两句即可。${FACT_LINE}${three ? TABLE_TALK : ''}
${RULES_BRIEF(three)}
${THREE_LOCKS}
${jsonSpec(modSpec)}`;

// 擂台席（A2）：受控实验，连名字都不给——同一份字符串发给每个模型，否则实验作废
const personaSystem = (p, three, modSpec = '') => seatSystem(p.arena ? '' : p.name, three, modSpec);

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

// 算频（Q45，软倾向：只染色不扣扳机——扣扳机的必须是模型）。'never' 是身份锚点：
// 不给他这个动作（阿飞从不算，和老李头不用盲同级）。
const CALC_HABIT = {
  often: '你习惯算：多数手你会当众把算盘拨一下——但数是数、人是人，你照样可能逆着数开。',
  key: '你只在关键手才算：平常凭经验走，真到要紧处才把算盘拿出来（算这个动作本身就在告诉别人这手要紧）。',
  never: '你从不碰算盘：全凭手感，所以你嘴里永远没有准数——你也不觉得那玩意儿有用。',
};


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
          .join('；')}。接下来的动作和台词必须接得上这些话——要么兑现，要么是你有意在诈（心里要有数），不许像失忆一样自相矛盾。`
      : null,
    returned
      ? `注意：你报的「${ob.currentBid.count} 个 ${ob.currentBid.face}」被原样推了回来——你必须自己继续抬，不能开自己的价。`
      : ob.currentBid
        ? calced
          ? `当前报价：${bidder}报「${ob.currentBid.count} 个 ${ob.currentBid.face}」${three ? '（开牌只能开他）' : ''}。你这局拨过算盘：按你的骰子算，此话为真的概率 ${pct(p(ob.currentBid))}（只算骰面，不算人——他是不是在诈，算盘不管）。`
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
      canCalc &&
        `当众拨算盘（{"type":"calc"}）——算完这一局你都有准数，算盘拨在明处：全桌都看得见你在算，何时算本身就是话（算完你继续行动）`,
      !ob.yourDice && !isBlind && `掀盅看骰（看完这手再决定）`,
    ]
      .filter(Boolean)
      .join('；')}。`,
    // 算频是人设的可见装备（Q45）：只染色候选，不替模型扣扳机。素颜客席不发这行——它没有性格剧本
    (!persona.bare && CALC_HABIT[calcHabit]) || null,
    // 软倾向（Q22-补：只染色不扣扳机）：宣言与词条是决策动词，不是摆设
    ob.legal.some((a) => a.type === 'declare' || !!modActionMeta(ob, a.type))
      ? '提醒：宣言和词条都是真招——虚实、时机、赔率都在里面，该出手就出手；一个只会抬价和开牌的人，是桌上最好读的人。'
      : null,
    ...(ctx.extraFacts ?? []), // 宿主注入的追加事实行（好友房：主持人职责/短语盘/旁注注单——全为真实数据）
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
  const modSpec = modActionsOf(ob)
    .map((a) => `或{"type":"${a.type}"${a.params === 'face' ? ',"face":点数1到6' : ''}}（词条「${a.label}」）`)
    .join('');
  return { system: personaSystem(persona, three, modSpec), user: facts.join('\n') };
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
      say: typeof j.say === 'string' ? j.say.slice(0, 60) : '',
      note: typeof j.note === 'string' ? j.note.slice(0, 120) : '',
      // 留档字段（Q47／Q49：留档不是审查）：永不上屏，只进决策日志与复盘室
      belief: typeof j.belief === 'string' ? j.belief.slice(0, 100) : '',
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

// 一句话任务（开场白等）：人设声口、非 JSON、事实锚定——替代写死台词（台词只能出自角色）。
// 失败返回 null（一句不说；沉默模式不代言）。
export async function personaLine(channel, { persona, task, facts }, fetchFn) {
  try {
    const raw = await chat(
      channel,
      {
        // 开场白也走同一条规矩：名字是标签，不是性格（用户裁决 2026-08-09）
        system: `你在这张桌上的名字是「${persona.name}」。${FACT_LINE}`,
        user: `${task}\n可用的真实事实：${facts || '（无）'}\n只输出台词本身（一到两句，不要引号、不要解释、不要 JSON）。`,
        maxTokens: persona.gear?.maxTokens ?? 160,
        timeoutMs: persona.gear?.timeoutMs ?? 10_000,
        extra: persona.gear?.extra,
      },
      fetchFn,
    );
    // Q49：开场白也是他的场合——不再对账（他把上回的账记歪，是他这个人的事）
    return raw.trim().replace(/^["「『]|["」』]$/g, '').slice(0, 90) || null;
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
        system: `你是${persona.name}。你刚在大话骰桌上被打脸了，现在快速修订你对这位客人的判断。规矩：**假设只写关于客人（人类玩家）的**——其他对手的行为可作背景，不入假设槽；假设必须由给你的事实支撑；证据不足的假设降权；被反例打死的假设保留并记下反例（尸体也是学问）。严格输出一行 JSON：{"hypotheses":[{"text":"一句假设","hits":证据次数,"misses":["反例场次"]}]}，最多 4 条。`,
        user: `刚发生的事：${factText}
你既有的假设：${
          hypotheses.length
            ? hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}${h.misses?.length ? `，反例：${h.misses.join('、')}` : ''}）`).join('；')
            : '（还没有）'
        }`,
        maxTokens: Math.max(300, persona.gear?.maxTokens ?? 0),
        timeoutMs: persona.gear?.timeoutMs ?? 10_000,
        extra: persona.gear?.extra, // 推理型演员（先生）不带这个会烧穿预算回空
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (!Array.isArray(j.hypotheses)) return null;
    return j.hypotheses
      .slice(0, 4)
      .map((h) => ({ text: String(h.text ?? '').slice(0, 60), hits: +h.hits || 0, misses: (h.misses ?? []).slice(0, 3).map(String) }))
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
        system: personaSystem(persona).replace(/严格输出一行 JSON[\s\S]*$/, '') +
          '现在一场结束了，你在写这位客人的酒桌档案。判词两三句，必须引用给你的具体数据，不许编——只许用下面数据里出现过的数字，牌桌上没拨算盘算过的概率不许当准数说。顺手全量复盘你对他的规律假设（只写关于客人的；由数据支撑；被反例打死的保留尸体并记反例）。严格输出一行 JSON：{"verdict":"给客人看的判词","note":"记进你档案本的一句观察","hypotheses":[{"text":"一句假设","hits":证据次数,"misses":["反例"]}]}，假设最多 4 条。',
        user: `${won ? '这场你输了。' : '这场你赢了。'}客人本场数据：${statsText}${
          hypotheses.length
            ? `。你既有的假设：${hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}）`).join('；')}`
            : ''
        }`,
        maxTokens: Math.max(500, persona.gear?.maxTokens ?? 0),
        timeoutMs: persona.gear?.timeoutMs ?? 10_000,
        extra: persona.gear?.extra, // 推理型演员（先生）不带这个会烧穿预算回空
      },
      fetchFn,
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    if (typeof j.verdict !== 'string') return null;
    // Q49：判词是他的意见话、假设是他的本子——都不再对账。
    // 报告卡的数据面（局数/虚报率/蒙报/开牌命中…）由引擎渲染，压根不经他的嘴。
    return {
      verdict: j.verdict.slice(0, 120) || null,
      note: (j.note ?? '').slice(0, 80),
      hypotheses: Array.isArray(j.hypotheses)
        ? j.hypotheses
            .slice(0, 4)
            .map((h) => ({ text: String(h.text ?? '').slice(0, 60), hits: +h.hits || 0, misses: (h.misses ?? []).slice(0, 3).map(String) }))
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
  const silent = createSilentBot(persona.strategy); // 策略参数随人设（Q10④）
  const logs = []; // 决策日志（B.3）：台词事实来源与审计素材
  return {
    logs,
    persona,
    async decide(ob) {
      const canPeek = ob.legal.some((a) => a.type === 'peek');
      // 不玩盲的人设：未看骰直接掀盅（老李头）；爱盲的人设把"掀盅还是盲上"交给 LLM（阿飞）。
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
          // maxTokens/timeout 默认压低（动作 JSON＋一句台词，节拍 ≤4s）；推理型演员按人设放宽——
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
