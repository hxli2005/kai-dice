// 对手名册（DESIGN §1.6）：**一张卡＝一个型号。**
//
// 这个文件里没有角色，也没有机号了（Q89，2026-08-10）。清完之后只剩两样东西：
//   ① **型号**——卡面就是模型名，事实性标注（Q51 法务线：不画 logo、不借吉祥物、不暗示背书）；
//   ② **技术参数**——每个型号自己需要的 token 上限／超时／厂商开关。那是接口的事，不是人的事。
//
// 依次清掉的：嘴臭度／腔调／身份自述／性格缺陷（Q51）→ 说话纪律与内容底线（Q85）→
// 提示词里一切非规则内容（Q86）→ 催话台词／声口／pace／blurb 散文／分档身家（Q87·Q88）→
// **一号机·二号机·三号机这三个机号本身（Q89）**。
//
// 为什么连机号也删：一号机与二号机钉的是同一个型号，差别只有"桌上给不给算盘"。
// 那是 Q51 写明的**兜底手段**（"分化不足时的最小区分"）——而证据闸门还没跑。
// 在测出模型分不分得开之前就先用兜底，等于用我们造的差异去掩盖我们要测的问题。
// 工具可用性的机制**没有删**（gear.calc／gear.usesBlind 照常生效），只是不再拿它捏对手。
//
// **户头按型号记**（DESIGN §1.2）——这条宪法到 Q89 才真正做到：以前 seat1／seat2 钉同一个
// 型号却各开一本账，本身就违反它。老档的合并迁移见 src/ui/profile.js。

// 挂机提示（DESIGN §1.4：>30 秒，纯提示，无机制后果）。全席共用，无声口。
export const IDLE_LINES = ['轮到你了。', '还在？', '该你出手了。'];

export const HOSTED_MODEL = 'deepseek-v4-flash'; // 托管席（零配置免费档）；服务端白名单须同名，见 infra/pages/_worker.js

// 官方通道钉的型号（Q51：只保 1–2 个控成本，其余走 BYOK）。顺序即卡序。
export const OFFICIAL_MODELS = [HOSTED_MODEL, 'deepseek-v4-pro'];

// 每个型号自己的接口参数。**这是技术参数，不是性格**——
// v4-pro 不关思维链会吃空 token 预算回空（2026-08-09 实测），所以它得多给一点、多等一会儿。
const TECH = {
  'deepseek-v4-pro': { maxTokens: 500, timeoutMs: 15_000, extra: { thinking: { type: 'disabled' } } },
};

// 一个型号 ＝ 一张卡 ＝ 一个户头。
//   hosted：走官方托管通道（零配置、免费额度），仅托管那一个；
//   official：走官方通道（需暗号）；
//   两者皆非＝客席（自带钥匙，BYOK）。
export function modelPersona(model, { hosted = false, official = false } = {}) {
  if (!model) return null;
  return {
    id: `model:${model}`, // 户头＝型号名：托管、暗号、自带钥匙用同一个型号时，本来就是同一个人
    name: model.slice(0, 24),
    seal: (model.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '模').toUpperCase(),
    tag: hosted ? '托管 · 一键可玩' : official ? '官方通道 · 需暗号' : '客席 · 自带钥匙',
    blurb: hosted
      ? `真身：${model}。这一席的账由官方通道出，你什么都不用配。`
      : official
        ? `真身：${model}。走官方通道，需要暗号。`
        : `真身：${model}。你的钥匙，浏览器直连，key 不出这台设备。`,
    bare: true,
    hosted,
    official: hosted || official,
    // 工具全开：算不算、看不看骰，都由它自己决定——那是原生 tell，不是我们配的
    gear: { calc: 'free', usesBlind: true, model, ...(TECH[model] ?? {}) },
    strategy: { challengeThreshold: 0.3 }, // 只在通道断了、沉默 bot 顶班时才用得上
    bankroll: 0, // Q88：身家＝净转移，谁都没有发下来的本金
  };
}

// 官方名册：id → 卡。profile.js 的账本自愈与 balanceOf 都按这张表遍历。
export const OFFICIAL = Object.fromEntries(
  OFFICIAL_MODELS.map((m) => {
    const per = modelPersona(m, { hosted: m === HOSTED_MODEL, official: true });
    return [per.id, per];
  }),
);

// 兼容名：老调用点仍写 PERSONAS（含义已从"人设表"变成"官方名册"）
export const PERSONAS = OFFICIAL;
export const DEFAULT_PERSONA = OFFICIAL[`model:${HOSTED_MODEL}`];

// 好友房主持与掉线代打用的那一席：托管型号。
export const defaultAiPersona = () => DEFAULT_PERSONA;
