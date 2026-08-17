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
// **户头按型号记**（DESIGN §1.2）——这条宪法到 Q89 才真正做到：以前 seat1／seat2 钉同一个
// 型号却各开一本账，本身就违反它。老档的合并迁移见 src/ui/profile.js。

import { isEnglish } from '../ui/i18n.js';

// 挂机提示（DESIGN §1.4：>30 秒，纯提示，无机制后果）。全席共用，无声口。
export const IDLE_LINES = isEnglish()
  ? ['Your move.', 'Still there?', 'Your move.']
  : ['轮到你了。', '还在？', '该你出手了。'];

// 托管席（零配置免费档）；服务端白名单须同名，见 infra/pages/_worker.js
//
// **2026-08-14 定回 flash**（用户裁决「换 flash 作为托管」）。当日曾短暂换成 v4-pro，同日改回。
// 这是**成本压倒棋力**的取舍，两边的账都摆在这儿，别当成"flash 更好"：
//   · 成本（胜出的一边）：flash ¥1/¥2 对 v4-pro ¥3/¥6，**单价三分之一**。Q92 之后免费档不设
//     单设备日限，全局月熔断是唯一的闸，所以单价直接决定 ¥500 红线能撑多少手（DESIGN §5.3）；
//     熔断触发那天全体玩家的对手一起变哑巴，这个代价比"对手偶尔送一颗骰"难看得多。
//   · 棋力（认输的一边，**明示接受**）：同一批 21 个「自己的骰子已经让这口价成立」的局面上
//     （开牌必输、零解释空间），flash 误开 **22%**、判别力仅 +2pt；v4-pro 误开 6%、判别力 +16pt。
//     **免费档玩家因此约有四分之一的概率遇到对手在残局白送一颗骰。** 判别力＝「该开的局面开、
//     必输的局面不开」的分辨力（对照率−靶心率），全部数据见 SYNC Q103。
// ⚠️ 这条取舍的有效期绑在价格与配额上：**若 flash 降价／出更强的同价位型号／或免费档重新设限，
// 应当重算**，别把它当成永久结论。
export const HOSTED_MODEL = 'deepseek-v4-flash';

// 官方通道钉的型号（Q51：只保 1–2 个控成本，其余走 BYOK）。**顺序即卡序，排头即托管席。**
// v4-pro 留在名册上当暗号档：它棋力明显更好但贵三倍，交给愿意配暗号的人自己选。
export const OFFICIAL_MODELS = [...new Set([HOSTED_MODEL, 'deepseek-v4-pro'])];

// 决策调用的完成信封：推理 token 与最终 JSON 共用 `max_tokens`。
// 真实 OpenRouter 冒烟表明，800/1600/4096 的裸上限都可能被默认推理全部吃完；
// 通用信封给 3072，OpenRouter 能力层再把其中至多 2048 划给推理，至少留约 1024 落答案。
export const DECISION_MAX_TOKENS = 3072;
export const DECISION_TIMEOUT_MS = 60_000;

// 每个型号自己的完成信封。**这是技术参数，不是性格**：
// 不再强制关闭推理，只给推理型型号足够的 token 和时间把结果写完。
const TECH = {
  // DeepSeek V4 defaults to thinking mode. On this turn-based table that made
  // an ordinary reply consume the full 60 s product timeout. The official API
  // exposes an explicit non-thinking mode; use it for live play. Reasoning
  // experiments remain available in the arena, where latency is itself data.
  'deepseek-v4-flash': {
    maxTokens: DECISION_MAX_TOKENS,
    timeoutMs: DECISION_TIMEOUT_MS,
    extra: { thinking: { type: 'disabled' } },
  },
  'deepseek-v4-pro': {
    maxTokens: DECISION_MAX_TOKENS,
    timeoutMs: DECISION_TIMEOUT_MS,
    extra: { thinking: { type: 'disabled' } },
  },
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
    tag: hosted
      ? (isEnglish() ? 'HOSTED · PLAY NOW' : '托管 · 一键可玩')
      : official
        ? (isEnglish() ? 'OFFICIAL CHANNEL · CODE REQUIRED' : '官方通道 · 需暗号')
        : (isEnglish() ? 'GUEST SEAT · BYOK' : '客席 · 自带钥匙'),
    blurb: hosted
      ? (isEnglish() ? `Model: ${model}. This hosted seat needs no setup.` : `真身：${model}。这一席的账由官方通道出，你什么都不用配。`)
      : official
        ? (isEnglish() ? `Model: ${model}. Uses the official channel and requires an access code.` : `真身：${model}。走官方通道，需要暗号。`)
        : (isEnglish() ? `Model: ${model}. Uses your key in a direct browser connection; the key stays on this device.` : `真身：${model}。你的钥匙，浏览器直连，key 不出这台设备。`),
    bare: true,
    hosted,
    official: hosted || official,
    gear: {
      usesBlind: true,
      model,
      maxTokens: DECISION_MAX_TOKENS,
      timeoutMs: DECISION_TIMEOUT_MS,
      ...(TECH[model] ?? {}),
    },
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
