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

// 把钉子钉进通道（通道级 extra；机位级 extra 不再存在——擂台席没有装备）
export function pinSampling(channel) {
  if (!channel) return null;
  const or = isOpenRouter(channel.baseUrl);
  return {
    ...channel,
    // 降本一（A4）：给系统提示词打缓存断点。**只在 OpenRouter 上开**——
    // 它会把数组式 content 按各家格式转发，而多数裸的 OpenAI 兼容端点吃不下数组，
    // 开了会把整条通道打死（这批实测过一次类似的"测得通、打起来全静默"）。
    //
    // 我们的 system 是理想缓存形态：全席逐字相同、每手不变（Q86 二准入之后更短更稳）。
    // ⚠️ 但**短前缀会静默失效**：各家有最小可缓存长度（Haiku 4.5 要 4096 token）。
    // 所以开了不等于省了钱——`cacheReport()` 用回执里的 cache_read 验，命中为 0 就照实说。
    cacheSystem: or,
    extra: {
      ...SAMPLING,
      ...providerLock(channel.providerTag),
      // OpenRouter：请求带这个才回报真实花费（A4 用实收账目，不用估算糊弄）
      ...(or ? { usage: { include: true } } : {}),
      ...channel.extra,
    },
  };
}

// 一场：两个 AI 客户端坐同一张引擎桌（§4 结构红利——引擎不知道对面是谁）。
// seats: {A:{channel,label}, B:{channel,label}}；budget 可选（A4：跑爆就当场收手）
export async function playMatch({ seed, seats, fetchFn, maxSteps = 3000, budget, relaySpeech = true } = {}) {
  const ids = ['A', 'B'];
  const m = await createMatch({ seed, config: { players: ids } });
  // 让它们互相听得见（2026-08-10 修）。此前擂台没传 ctx，两个模型从头到尾收不到对方一个字——
  // 于是「牌手层允许诈」（DESIGN §3）在擂台上完全空转，bait 率数的是**对着不存在的听众演戏**。
  //
  // 走宿主转发，**不动引擎**：台词不是动作，不该进事件流（§2.1 引擎只认 observe/act）；
  // 而 extraFacts 本就是宿主往提示词里塞真实事实的既有通道（好友房短语盘、玩家的「戳」同款）。
  // 只转 say，**belief 永不外传**——那是私有留档（§3 三锁）。
  const heard = { A: [], B: [] };
  const ai = {};
  for (const id of ids)
    ai[id] = createOpponent({
      channel: pinSampling(seats[id].channel),
      profile: '',
      persona: ARENA_SEAT,
      ctx: relaySpeech ? { extraFacts: heard[id] } : {},
      fetchFn,
    });
  const backup = createSilentBot(ARENA_SEAT.strategy);
  const rejects = { A: 0, B: 0 }; // 引擎当场打回的动作（parseDecision 之后仍不合法＝我们的 bug，不是模型的）
  let aborted = null;
  // 并发时每场要一份自己的账本，否则单场上限会互相误伤（见 cost.js）
  const bud = budget?.forMatch?.() ?? budget;
  bud?.startMatch?.();

  for (let step = 0; step < maxSteps; step++) {
    const ob0 = m.observe('A');
    if (ob0.over) break;
    const p = ob0.turn;
    const ob = p === 'A' ? ob0 : m.observe(p);
    if (bud?.exceeded?.()) {
      aborted = 'budget';
      break;
    }
    const d = await ai[p].decide(ob);
    bud?.charge?.(d.meta ?? {}, seats[p].price); // 逐发记账（A4）

    // 把这一手说的话递给对家（滚动窗口，只留最近几句——省 token，也省得越滚越长）
    // relaySpeech=false 是**对照臂**：其余全同、只关这一个开关，用来把"格式失败涨了"
    // 归到该归的地方（是转发台词的代价，还是别的）。两臂的数只能这样比才算数。
    if (relaySpeech && d.say && !d.silentFallback) {
      const other = p === 'A' ? 'B' : 'A';
      heard[other].push(`第 ${ob.round} 局，对方${sayContext(d.action)}时说：「${d.say}」`);
      if (heard[other].length > 6) heard[other].shift();
    }
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

// 转发台词时带上它当时在做什么——嘴和手对不对得上，本来就是可读的东西
const sayContext = (a) =>
  a?.type === 'bid' ? `报 ${a.count} 个 ${a.face}`
  : a?.type === 'challenge' ? '开牌'
  : a?.type === 'calc' ? '拨算盘'
  : a?.type === 'peek' ? '掀盅'
  : a?.type === 'declare' ? `宣言「${{ zhai: '斋', blind: '盲', raise: '抬' }[a.declaration] ?? a.declaration}」`
  : '行动';

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
//
// **并发（concurrency）**：一手接一手必须串行（后手要看前手），但**场与场之间没有理由排队**——
// 种子固定、素颜台无跨场记忆（Q90），每场彼此独立。20 场串行跑了 80 分钟，这是纯浪费。
// ⚠️ 但并发不是白拿的：开太高会撞上游限流，而限流会以**超时/格式失败**的形式落到合规层，
// 把"这个模型听不听话"污染成"我们打太急了"。所以默认保守，且并发数要写进战报的实验设置。
export async function runArena({
  pairs, games = 5, seed0 = 1000, fetchFn, budget, onMatch, onPair, concurrency = 1, relaySpeech = true,
} = {}) {
  // 摊平成一个个独立的场（镜像的第二遍＝同种子、互换座位）
  const jobs = [];
  for (const [x, y] of pairs)
    for (let g = 0; g < games; g++) {
      jobs.push({ pair: [x.label, y.label], seed: seed0 + g, seats: { A: x, B: y } });
      jobs.push({ pair: [x.label, y.label], seed: seed0 + g, seats: { A: y, B: x } });
    }

  const out = new Array(jobs.length).fill(null);
  const left = new Map(); // 每对还剩几场没打完 → 打完才回调 onPair
  for (const j of jobs) left.set(j.pair.join('\u0000'), (left.get(j.pair.join('\u0000')) ?? 0) + 1);

  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= jobs.length) return;
      if (budget?.runExceeded?.()) return; // 整批触顶：收摊，别再开新场
      const j = jobs[i];
      const r = await playMatch({ seed: j.seed, seats: j.seats, fetchFn, budget, relaySpeech });
      out[i] = r;
      onMatch?.(r);
      const k = j.pair.join('\u0000');
      const n = left.get(k) - 1;
      left.set(k, n);
      if (n === 0) onPair?.(j.pair);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out.filter(Boolean); // 触顶收摊时后面的槽位是空的
}

// 全对全（模型两两配对，不自己打自己）
export const roundRobin = (entrants) =>
  entrants.flatMap((x, i) => entrants.slice(i + 1).map((y) => [x, y]));
