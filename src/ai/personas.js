// 化身（DESIGN §3.2 的人设对象，2026-08-09 用户裁决后大改）：
//
// **模型是真身，形象是化身，提示词只管规则。**
// 这里剩下的东西只有两类：
//   ① **形象**——名字、名章、身家、催话、沉默模式的口。全是表现层，一个字都不进提示词。
//   ② **座位规则**——gear 里的工具可用性（算盘给不给、盲能不能宣）与钉的模型。明牌，不是偷塞的人格。
// 删掉的是**性格脚本**：嘴臭度（TONES）、腔调（style）、身份自述（identity）、
// 四条会改变出牌的性格缺陷（flaws）。座位之间还有差别，但差别得自己长出来。
//
// 内容边界（Q6）不在这里——它在 agent.js 的 FACT_LINE 里，对每个座位一视同仁：
// 只评打法、不碰人身、不用脏话。那是安全线，不是人格线，任何身份都不豁免。
//
// blurb 只给 UI（玩家页），永不进提示词。

export const PERSONAS = {
  laolitou: {
    id: 'laolitou',
    name: '老李头',
    seal: '李',
    tag: '化身 · 常拨算盘 · 不用盲',
    blurb: '一张脸和一个称呼。真身是官方通道上的模型，提示词里只有规则——他怎么打、怎么说，是他自己的事。座位规则：常有算盘可拨，不宣盲。',
    // 座位规则（Q45／Q51 的"工具可用性最小区分"）：算盘常在手边；不宣盲
    gear: { calc: 'often', usesBlind: false, revealBait: 0.3 }, // revealBait＝揭诈频率 TODO(Q49 参数表)
    // 沉默模式的口（F2）：无通道时也要说出"我为什么开你"，全部由事实模板拼
    voice: { challenge: (f) => `${f.coarse}。${f.clause ? `${f.clause}。` : ''}开。` },
    strategy: { challengeThreshold: 0.25 }, // 沉默模式顶班时沿用的行为参数
    bankroll: 800, // Q25 已裁：三十年家底——玩家的钱从他们身上赢
    // §2.4 催话（2026-08-08 换血：带阴力）
    idle: ['骰子又不咬人。', '茶凉了。第三回。', '我等过十年的账，不差你这一手。', '你这么怕错，怪不得本子上全是你的名字。'],
    pace: 'slow', // 表现层节奏：老李头想得慢
  },

  afei: {
    id: 'afei',
    name: '阿飞',
    seal: '飞',
    tag: '化身 · 从不碰算盘 · 可宣盲',
    blurb: '一张脸和一个称呼。真身是官方通道上的模型，提示词里只有规则。座位规则：桌上没有他的算盘（连这个动作都不给），但他可以不看骰就宣盲。',
    // 座位规则：从不碰算盘（连候选都不给——这是明牌的工具差异，不是性格设定）、可宣盲
    gear: { calc: 'never', usesBlind: true, revealBait: 0.45 },
    voice: { challenge: (f) => `${f.clause ? `${f.clause}，` : ''}就这？开！` },
    strategy: { challengeThreshold: 0.35 }, // 沉默顶班：更冲动，容忍度低就开
    bankroll: 300, // Q25 已裁：街口薄底，仍比客人厚
    // §2.4 催话（2026-08-08 换血：更闹）
    idle: ['喂喂喂，睡了？', '你这一手琢磨出花了？', '开不开报不报，给个响！', '怂就说怂，我不笑你。……噗。'],
    pace: 'fast', // 近乎秒出
  },
};

// 先生（Q17 花名册第三席）：这一席的差别现在只剩两件明牌的事——**钉的是另一个模型**
// （deepseek-v4-pro，关思维链：素颜测试实证默认档会吃空 token 预算致 bad-output），
// 以及关键手才有算盘。换了真身，打法自然不一样——这正是"模型即对手"要验的东西。
PERSONAS.xiansheng = {
  id: 'xiansheng',
  name: '先生',
  seal: '账',
  tag: '化身 · 另一个真身（v4-pro）· 关键手才算',
  blurb: '一张脸和一个称呼。他的真身与老李头、阿飞不是同一个模型（deepseek-v4-pro），提示词同样只有规则。座位规则：关键手才有算盘，不宣盲。',
  // 座位规则：关键手才给算盘；不宣盲；钉另一个模型＋关思维链＋预算放宽
  gear: {
    calc: 'key',
    usesBlind: false,
    revealBait: 0.15, // 账房不爱把牌摊开：一季揭一次

    model: 'deepseek-v4-pro',
    maxTokens: 500,
    timeoutMs: 15_000,
    extra: { thinking: { type: 'disabled' } },
  },
  strategy: { challengeThreshold: 0.2 }, // 精确阈值：沉默顶班也冷
  bankroll: 500, // 先生数额报设计追认（Q25"后续人设各配各的"）：账房的钱不多不少，都在账上
  voice: { challenge: (f) => `${f.clause ? `${f.clause}。` : ''}这口价我不接。开。` },
  idle: ['账不等人。', '（拨了一下算盘）', '客人，钟在走。', '您想。我对账。'],
  pace: 'slow', // 迟，冷——停顿本身是人设
};

export const DEFAULT_PERSONA = PERSONAS.laolitou;

// ---------- 模型席：真身上桌（用户裁决 2026-08-09；Q51「客席升正席」的落地） ----------
//
// 这一席**不是人设**：没有身份、没有腔调、没有性格缺陷剧本，提示词里只有规则与输出契约
// （复用 agent.js 的 bare 分支）。身份就是模型名——换模型＝换人，各记各的账（id 即户头）。
//
// 法务线（Q51 条件一）：**模型名仅作事实性标注**，不画、不借、不复刻任何一家的吉祥物与 logo，
// 不暗示背书。所以这里连头像都不给，只有一个取自模型名的字——形象暂缓是最安全的形态。
export const HOSTED_MODEL = 'deepseek-v4-flash'; // 托管席用的模型（服务端白名单须同名，见 infra/pages/_worker.js）

export function modelPersona(model, { hosted = false } = {}) {
  if (!model) return null;
  return {
    id: `model:${model}`, // 户头＝模型名：托管席与自带钥匙用同一个模型时，本来就该是同一个人
    name: model.slice(0, 24),
    seal: (model.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '模').toUpperCase(),
    tag: hosted ? '托管 · 一键可玩' : '客席 · 自带钥匙',
    blurb: `真身：${model}。${hosted ? '这一席的账由官方通道出，你什么都不用配。' : '你的钥匙，浏览器直连，key 不出这台设备。'}提示词里只有规则——它怎么打、怎么说，是它自己的事。`,
    bare: true, // 素颜：提示词只给规则，不给性格（现在所有座位都是这样）
    hosted, // 走官方托管通道（零配置），而不是自带钥匙
    gear: { calc: 'free', usesBlind: true, model }, // 算不算、看不看骰，都由它自己决定——那是原生 tell
    strategy: { challengeThreshold: 0.3 }, // 只在通道断了、沉默 bot 顶班时才用得上
    idle: ['……'],
    pace: 'fast',
    bankroll: 300, // Q25：客人从他们身上赢钱，街口价
  };
}
