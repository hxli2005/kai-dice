// 词条定义层（DESIGN §8 实验桌 Q32/Q34/Q36/Q37/Q39）。
// 词条＝纯数据 AST：{name, actions:[{type,label,window,params,keepTurn,terminal,effect}]}。
// 官方词条与玩家许愿共用同一语法；本文件的原子注册表是唯一事实源——
// 静态校验（validateMod）、回译（renderCard）、编译器提示词（atomsDoc）、三门体检全部由此生成。

// ---------- 原子注册表 ----------

import { obProbExact } from '../probability.js';

// 效果原子（引擎侧预实现，Q38"原子预审预实现"）。
// tension（Q35 张力守恒律）：moves=搬运不确定性（合格）；kills=出售确定性（不许上桌）。
//
// 每个原子是"全息条目"——除引擎/编译面（doc/card/tension/needs）外，还带五个语义槽，
// AI 客户端与 UI 只查表零分支，官方词条与玩家许愿自动同权（都是这些原子的组合）：
//   ai(ob, fmtP)  候选动作说明（含语义钉死：点数不是第几颗、恰好概率双发等）
//   sayRule       嘴手纪律（台词必须怎么贴住这个动作——方向锚、点数一致等）
//   narrate(e, who) 公开事件叙事（喂进全桌 AI 的局面叙事）
//   selfDesc(a)   自我记忆回灌里对这动作的描述（防跨调用失忆）
//   stamp(a, label) 盖章演出的字（裁判层视觉永远说真话）
export const OPS = {
  revealOwnDie: {
    doc: '亮出自己选定的一颗骰给全桌看（永久公开，仍算你手里的骰）。需要 window.requiresPeeked=true、params="face"、keepTurn=true',
    card: '翻开自己选定的一颗骰给全桌看（亮出的骰算数、收不回）',
    tension: 'moves', // 付信息买歧义：亮的是饵还是实话，对面读不透
    needs: { requiresPeeked: true, params: 'face', keepTurn: true },
    ai: () => `亮出自己的一颗骰给全桌看。face 填骰子的点数（1–6，必须真在你手里），不是第几颗`,
    sayRule: '亮出的骰全桌都看得见——台词里若提点数，必须就是 face 里的数，说错当场穿帮',
    narrate: (e, who) => `${who(e.actor)}亮出自己一颗 ${e.face}`,
    selfDesc: (a) => `亮出了一颗 ${a.face}（全桌可见）`,
    stamp: (a, label) => `${label} ${a.face}`,
  },
  calzaResolve: {
    doc: '宣布"当前报价恰好为真"并当场开牌：恰好→你赢回一颗骰（唯一回骰通道）并收池；不恰→你掉一颗骰、报价者收池；被掐的报价者永不掉骰。需要 window.needBid=true、notOwnBid=true、terminal=true，且必须是唯一效果',
    card: '宣布报价恰好为真并开牌——恰好则你收池并拿回一颗骰，不恰则你掉一颗骰、池归报价者（报价者不掉骰）',
    tension: 'moves', // 在开/跟之间劈出第三条分叉
    needs: { needBid: true, notOwnBid: true, terminal: true, sole: true },
    // fmtP 为 null＝本局未拨算盘：**一个数都不给**（与玩家侧的被动零显示对齐，B.1 双发）
    ai: (ob, fmtP) =>
      `宣布"这口价恰好为真"当场开牌${fmtP ? `：恰好的概率按你的骰子算是 ${fmtP(obProbExact(ob, ob.currentBid))}` : ''}；掐对你收池并拿回一颗骰，掐错你掉一颗骰`,
    sayRule: '方向别搞反：是你主动出手掐对方的报价——台词是"我掐你"，不是"我被掐"',
    narrate: null, // 终局动作：摊牌事件自带叙事（matchRecap 的掐分支）
    selfDesc: () => '主动掐了对方的报价',
    stamp: (a, label) => label,
  },
  returnBid: {
    doc: '把当前报价原样推回给报价者，他必须自己继续抬（不能开自己的价）。需要 window.needBid=true、notOwnBid=true、needRaisableByBidder=true，且必须是唯一效果',
    card: '把当前报价原样推回去，对方必须自己接着抬',
    tension: 'moves', // 让节奏换池深与开牌权
    needs: { needBid: true, notOwnBid: true, needRaisableByBidder: true, sole: true },
    ai: () => `把这口价原样推回给报价者，他必须自己接着抬`,
    sayRule: '你是把价推回去的人——话顺着"这价还给你"说，不是你在接价',
    narrate: (e, who) => `${who(e.actor)}把报价原样推了回去`,
    selfDesc: () => '把对方的报价原样推了回去',
    stamp: (a, label) => label,
  },
  potMult: {
    doc: '本局池倍率 ×x（x 只许 2 或 3；与盲/斋/抬/深水相乘）。需要 window.oncePer、keepTurn=true',
    card: null, // 动态：`本局池 ×${x}`
    tension: 'moves', // 与「抬」同族：注型即信号
    needs: { keepTurn: true, oncePerRequired: true },
    ai: () => `本局池翻倍`,
    sayRule: '你在主动把赌注抬大——话要压得住这个注',
    narrate: (e, who) => `${who(e.actor)}把本局池抬到 ×${e.x}`,
    selfDesc: () => '把本局池翻了倍',
    stamp: (a, label) => label,
  },
};

// 窗口谓词（触发条件）。所有词条动作都只在自己回合可用（turn 必须为 true）。
export const WINDOWS = {
  turn: '必须为 true——词条动作只在轮到你时可用',
  needBid: 'true=场上必须已有报价',
  noBid: 'true=本局还没有任何报价',
  notOwnBid: 'true=当前报价不是你自己报的',
  requiresPeeked: 'true=你必须已看过自己的骰',
  oncePer: '"round"=每人每局限一次；"match"=每人每场限一次；省略=不限',
  minBids: '本局报价数下限（整数，可省略）',
  maxBids: '本局报价数上限（整数，可省略）',
  needRaisableByBidder: 'true=要求报价者仍有合法抬价（防死局，returnBid 必带）',
};

const RESERVED_TYPES = ['peek', 'bid', 'challenge', 'declare'];
const DECLARE_OPS = ['revealOwnDie', 'potMult']; // 声明式效果：不结束回合、不移交行动权

// ---------- 静态校验（三门之前的门零：schema 与语义） ----------

export function validateMod(ast, { existingTypes = [] } = {}) {
  const errs = [];
  const missing = []; // 缺失原子/钩子——许愿失败日志的原料（Q39：拒绝信指明缺什么）
  if (!ast || typeof ast !== 'object') return { ok: false, errors: ['产物不是对象'], missing };
  if (typeof ast.name !== 'string' || !ast.name.trim() || ast.name.trim().length > 6)
    errs.push('name 需为 1–6 字的词条名');
  const actions = Array.isArray(ast.actions) ? ast.actions : null;
  if (!actions || actions.length < 1 || actions.length > 2) {
    errs.push('actions 需为 1–2 个动作的数组');
    return { ok: false, errors: errs, missing };
  }
  const seen = new Set();
  for (const a of actions) {
    const at = `动作「${a?.type ?? '?'}」`;
    if (typeof a?.type !== 'string' || !/^[a-z][a-z0-9]{1,11}$/.test(a.type))
      errs.push(`${at}：type 需为 2–12 位小写字母数字 slug`);
    else if (RESERVED_TYPES.includes(a.type)) errs.push(`${at}：type 与基础动作重名`);
    else if (existingTypes.includes(a.type) || seen.has(a.type)) errs.push(`${at}：type 与现有词条撞名`);
    seen.add(a?.type);
    if (typeof a?.label !== 'string' || !a.label.trim() || a.label.trim().length > 2)
      errs.push(`${at}：label 需为 1–2 字按钮名`);
    const w = a?.window;
    if (!w || typeof w !== 'object' || w.turn !== true) errs.push(`${at}：window.turn 必须为 true`);
    for (const k of Object.keys(w ?? {}))
      if (!(k in WINDOWS)) {
        errs.push(`${at}：未知窗口谓词「${k}」`);
        missing.push(`窗口谓词 ${k}`);
      }
    if (w?.oncePer != null && !['round', 'match'].includes(w.oncePer))
      errs.push(`${at}：oncePer 只许 "round" 或 "match"`);
    for (const k of ['minBids', 'maxBids'])
      if (w?.[k] != null && !(Number.isInteger(w[k]) && w[k] >= 0 && w[k] <= 30))
        errs.push(`${at}：${k} 需为 0–30 的整数`);
    const fx = Array.isArray(a?.effect) ? a.effect : null;
    if (!fx || fx.length < 1 || fx.length > 2) {
      errs.push(`${at}：effect 需为 1–2 个效果原子`);
      continue;
    }
    const ops = fx.map((e) => e?.op);
    if (new Set(ops).size !== ops.length) errs.push(`${at}：效果原子重复`);
    for (const ef of fx) {
      const spec = OPS[ef?.op];
      if (!spec) {
        errs.push(`${at}：未知效果原子「${ef?.op}」`);
        missing.push(`效果原子 ${ef?.op}`);
        continue;
      }
      const need = spec.needs ?? {};
      if (need.sole && fx.length > 1) errs.push(`${at}：${ef.op} 必须是唯一效果，不许与其他原子组合`);
      if (need.terminal && a.terminal !== true) errs.push(`${at}：${ef.op} 要求 terminal=true（当场开牌结束本局）`);
      if (!need.terminal && a.terminal) errs.push(`${at}：只有 calzaResolve 允许 terminal=true`);
      for (const k of ['needBid', 'notOwnBid', 'requiresPeeked', 'needRaisableByBidder'])
        if (need[k] && w?.[k] !== true) errs.push(`${at}：${ef.op} 要求 window.${k}=true`);
      if (need.params && a.params !== need.params) errs.push(`${at}：${ef.op} 要求 params="${need.params}"`);
      if (need.keepTurn && a.keepTurn !== true) errs.push(`${at}：${ef.op} 要求 keepTurn=true`);
      if (need.oncePerRequired && w?.oncePer == null) errs.push(`${at}：${ef.op} 必须配 oncePer 限次（防滥用成噪声）`);
      if (ef.op === 'potMult' && ![2, 3, undefined].includes(ef.x))
        errs.push(`${at}：potMult 的 x 只许 2 或 3`);
    }
    // 纯声明式动作必须 keepTurn：亮完/翻倍完照常行动，否则白白让出行动权、报数流会空转
    if (ops.every((op) => DECLARE_OPS.includes(op)) && a.keepTurn !== true)
      errs.push(`${at}：纯声明式效果（${ops.join('+')}）要求 keepTurn=true`);
    if (a.params != null && a.params !== 'face') errs.push(`${at}：params 只支持 "face" 或省略`);
  }
  return { ok: errs.length === 0, errors: errs, missing: [...new Set(missing)] };
}

// ---------- 回译（Q39：引擎确定性模板译回人话，锁编译幻觉） ----------

export function renderCard(ast) {
  return (ast.actions ?? [])
    .map((a) => {
      const w = a.window ?? {};
      const conds = ['轮到你时'];
      if (w.noBid) conds.push('本局还没人报价');
      if (w.needBid) conds.push('面对报价');
      if (w.notOwnBid && w.needBid) conds.push('且价不是你报的');
      if (w.requiresPeeked) conds.push('你已看过骰');
      if (w.minBids != null) conds.push(`本局已报满 ${w.minBids} 手`);
      if (w.maxBids != null) conds.push(`本局报价不超过 ${w.maxBids} 手`);
      const limit = w.oncePer === 'round' ? '（每人每局一次）' : w.oncePer === 'match' ? '（每人每场一次）' : '';
      const fx = (a.effect ?? [])
        .map((e) => (e.op === 'potMult' ? `本局池 ×${e.x ?? 2}` : (OPS[e.op]?.card ?? e.op)))
        .join('，并且');
      return `${conds.join('、')}，可拍「${a.label}」${limit}：${fx}${a.keepTurn ? '。之后你照常行动' : ''}。`;
    })
    .join('');
}

// ---------- 编译器提示词素材（Q39：表达力=原子库闭包，文档即词汇表） ----------

export function atomsDoc() {
  return [
    '效果原子（effect，只有这些，别无其他）：',
    ...Object.entries(OPS).map(([op, s]) => `- ${op}：${s.doc}`),
    '窗口谓词（window）：',
    ...Object.entries(WINDOWS).map(([k, d]) => `- ${k}：${d}`),
  ].join('\n');
}

// ---------- 官方词条（Q37 队列前三；同一 AST 语法，即编译器的金样） ----------

export const CATALOG = [
  {
    id: 'liang',
    name: '亮一颗',
    origin: 'official',
    card: '看过骰后，轮到你时可先拍「亮」（每人每局一次）：翻开自己选定的一颗骰给全桌看，然后照常行动。亮出的骰算数、收不回——是饵还是实话，对面自己猜。',
    actions: [
      {
        type: 'liang',
        label: '亮',
        window: { turn: true, requiresPeeked: true, oncePer: 'round' },
        params: 'face',
        keepTurn: true,
        effect: [{ op: 'revealOwnDie' }],
      },
    ],
  },
  {
    id: 'qia',
    name: '掐',
    origin: 'official',
    // 文案纪律（2026-08-12 用户裁决）：与 v3 世界语义同一口径——平实的桌面话，只写规则事实，
    // 不画重点（"第三条路"这类框架句删除：实验测的是谁自发用掐，卡不许替它做广告）。
    card: '轮到你、面对不是你报的价时可拍「掐」：宣布这口价恰好为真——桌上实有的恰好就是报的数——并当场开牌。若掐对：你收池，并拿回一颗骰（最多回到起始的 5 颗，满骰时只收池）；下一局报价者先报。若掐错：你掉一颗骰，池归报价者；下一局你先报。被掐的报价者不掉骰。骰子没有别的途径拿回来。',
    actions: [
      {
        type: 'qia',
        label: '掐',
        window: { turn: true, needBid: true, notOwnBid: true },
        params: null,
        terminal: true,
        effect: [{ op: 'calzaResolve' }],
      },
    ],
  },
  {
    id: 'rang',
    name: '让报',
    origin: 'official',
    card: '轮到你面对报价时，可拍「让」（每人每场一次）：把这口价原样推回给报价者，他必须自己继续抬——你不接，也不开，让他自己把话说下去。',
    actions: [
      {
        type: 'rang',
        label: '让',
        window: { turn: true, needBid: true, notOwnBid: true, oncePer: 'match', needRaisableByBidder: true },
        params: null,
        effect: [{ op: 'returnBid' }],
      },
    ],
  },
];

export const catalogMap = () => Object.fromEntries(CATALOG.map((m) => [m.id, m]));
