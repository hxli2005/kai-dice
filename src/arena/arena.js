// 素颜擂台（施工单 A2，凭 Q51 证据闸门／Q52 受控实验）。
//
// 这不是表演赛，是一个实验：**"不同模型＝不同对手"到底成不成立**。
// 成立的判据在 metrics.js（只有风味层的分化才算数）；本文件负责把实验做干净：
//
//   1. **全席系统提示词逐字相同**——擂台席（ARENA_SEAT）没有名字、没有身份、没有腔调，
//      连模型名都不进提示词。任何"按模型微调"都让实验作废，所以这里连一个可调的钩子都不留。
//   2. **镜像种子**——同一副骰种打两遍、第二遍互换座位。先手与运气被对冲掉，
//      剩下的差异才是模型的。
//   3. **采样参数钉死**（各家默认不同，不钉就是在比"谁的默认更冲"）。
//   4. **供应商路由锁定**——同一个模型 ID 会落到不同后端与量化档；锁了还要**验**：
//      回包里 provider 变过，这一批就标污染（承诺不算数，回执才算）。
//
// 编码侧自决（记 SYNC 变更日志）：
//   · **不喂用时**：引擎的 elapsedMs 一律传 null。真实延迟会被对手读成"他停了很久"，
//     那是模型速度不是性格——延迟另记在 latencyMs 里，不许进牌桌叙事污染读心。
//   · **每场独立、无跨场档案**：v1 只测行为分化，跨场记忆会带来顺序效应。
//     档案槽位仍在（提示词里是"生面孔"），不是把接口拆了。

import { createMatch } from '../engine.js';
import { createOpponent } from '../ai/agent.js';
import { createSilentBot } from '../ai/silent.js';
import { isOpenRouter, providerLock } from '../ai/openrouter.js';

// 钉死的采样参数（纪律③）。**这不是调参，是钉子**：改了它，跨批次的数就不能比了。
// max_tokens 单独走 gear（chat 的 maxTokens 参数），别在这儿重复下发。
export const SAMPLING = Object.freeze({
  temperature: 0.8,
  top_p: 1,
  // 思考型模型：统一关掉思维链再比（省钱也省钟，且避免"谁的思维链更长"混进方差）。
  // reasoning.mandatory 的模型关不掉——那就让它的格式失败率如实见榜（A3 合规层）。
  reasoning: { enabled: false },
});

// 每手输出＝小 JSON ＋ 一句台词（A4 降本二：收紧 max_tokens）。
// 别再紧了：紧到截断，测出来的"格式失败"就成了我们自己的手笔。
export const MAX_TOKENS = 400;
export const TIMEOUT_MS = 30_000; // 擂台是离屏跑的，不吃 §2.5-bis 的 ≤4s 节拍预算

// 擂台席位：一个没有脸的座位。三个 gear 的取值都必须是"中性"的——
// calc:'free'＝给算盘但不给算频剧本（算不算是模型自己的 tell，Q45 的原生分化）；
// usesBlind:true＝掀盅还是盲上交给模型（揭盅时机是阅读材料，§2.3）。
export const ARENA_SEAT = Object.freeze({
  id: 'arena',
  name: '',
  arena: true,
  bare: true,
  gear: Object.freeze({ calc: 'free', usesBlind: true, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS }),
  strategy: Object.freeze({ challengeThreshold: 0.25 }), // 降级顶班时全席同参数
});

// 把钉子钉进通道（通道级 extra；人设级 extra 不再存在——擂台席没有装备）
export function pinSampling(channel) {
  if (!channel) return null;
  return {
    ...channel,
    extra: {
      ...SAMPLING,
      ...providerLock(channel.providerTag),
      // OpenRouter：请求带这个才回报真实花费（A4 用实收账目，不用估算糊弄）
      ...(isOpenRouter(channel.baseUrl) ? { usage: { include: true } } : {}),
      ...channel.extra,
    },
  };
}

// 一场：两个 AI 客户端坐同一张引擎桌（§4 结构红利——引擎不知道对面是谁）。
// seats: {A:{channel,label}, B:{channel,label}}；budget 可选（A4：跑爆就当场收手）
export async function playMatch({ seed, seats, fetchFn, maxSteps = 3000, budget } = {}) {
  const ids = ['A', 'B'];
  const m = await createMatch({ seed, config: { players: ids } });
  const ai = {};
  for (const id of ids)
    ai[id] = createOpponent({ channel: pinSampling(seats[id].channel), profile: '', persona: ARENA_SEAT, fetchFn });
  const backup = createSilentBot(ARENA_SEAT.strategy);
  const rejects = { A: 0, B: 0 }; // 引擎当场打回的动作（parseDecision 之后仍不合法＝我们的 bug，不是模型的）
  let aborted = null;
  budget?.startMatch?.();

  for (let step = 0; step < maxSteps; step++) {
    const ob0 = m.observe('A');
    if (ob0.over) break;
    const p = ob0.turn;
    const ob = p === 'A' ? ob0 : m.observe(p);
    if (budget?.exceeded?.()) {
      aborted = 'budget';
      break;
    }
    const d = await ai[p].decide(ob);
    budget?.charge?.(d.meta ?? {}, seats[p].price); // 逐发记账（A4）
    try {
      await m.act(p, d.action, { elapsedMs: null }); // 不喂用时（见文件头自决）
    } catch {
      // 走到这儿说明 parseDecision 的合法性校验漏了——记在我们头上（rejects），不算模型的合规失败。
      // 沉默 bot 顶一手把桌子推下去；顶不动就收摊，绝不空转到 maxSteps。
      rejects[p]++;
      const fb = backup.decide(ob);
      const safe = ob.legal.some((a) => a.type === fb.type)
        ? fb
        : (ob.legal.find((a) => a.type === 'peek') ?? ob.legal.find((a) => a.type === 'challenge'));
      if (!safe) {
        aborted = 'stuck';
        break;
      }
      try {
        await m.act(p, safe, { elapsedMs: null });
      } catch {
        aborted = 'stuck';
        break;
      }
    }
  }
  const final = m.observe('A');
  return {
    seed,
    seats: { A: seats.A.label, B: seats.B.label },
    events: final.events,
    over: final.over,
    winner: final.events.at(-1)?.type === 'matchEnd' ? final.events.at(-1).winner : null,
    logs: { A: ai.A.logs, B: ai.B.logs },
    rejects,
    aborted,
  };
}

// 镜像对（纪律②）：同一副骰种打两遍，第二遍互换座位。
// 座位 A 的骰子序列只由 seed 决定，所以两遍里"A 手上的那副牌"是同一副——
// 先手权与运气各吃一遍，剩下的才是模型差异。
export async function playMirrorPair({ seed, x, y, fetchFn, budget } = {}) {
  const first = await playMatch({ seed, seats: { A: x, B: y }, fetchFn, budget });
  const second = await playMatch({ seed, seats: { A: y, B: x }, fetchFn, budget });
  return [first, second];
}

// 一批对局：pairs 里每对打 games 场（每场＝一对镜像局，故实际对局数 = games×2）。
// onMatch 回调用于 CLI 逐场落盘与打点（跑一半断了也不至于全丢）。
export async function runArena({ pairs, games = 5, seed0 = 1000, fetchFn, budget, onMatch, onPair } = {}) {
  const matches = [];
  for (const [x, y] of pairs) {
    if (budget?.runExceeded?.()) break;
    for (let g = 0; g < games; g++) {
      if (budget?.runExceeded?.()) break; // 单场触顶只收那一场，整批触顶才收摊
      const pair = await playMirrorPair({ seed: seed0 + g, x, y, fetchFn, budget });
      for (const r of pair) {
        matches.push(r);
        onMatch?.(r);
      }
    }
    onPair?.([x.label, y.label]);
  }
  return matches;
}

// 全对全（模型两两配对，不自己打自己）
export const roundRobin = (entrants) =>
  entrants.flatMap((x, i) => entrants.slice(i + 1).map((y) => [x, y]));
