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
//     素颜默认不变；`playSeries`（文件尾）是另一条**记忆赛道**（Q90 的联赛方向），两本账不混流。

import { createMatch } from '../engine.js';
import { createOpponent, clipHypotheses } from '../ai/agent.js';
import { createSilentBot } from '../ai/silent.js';
import { chat } from '../ai/llm.js';
import { isOpenRouter, providerLock } from '../ai/openrouter.js';
import { DECISION_MAX_TOKENS, DECISION_TIMEOUT_MS } from '../ai/personas.js';
import { seatStats } from './metrics.js';

// 钉死的采样参数（纪律③）。**这不是调参，是钉子**：改了它，跨批次的数就不能比了。
// max_tokens 单独走 gear（chat 的 maxTokens 参数），别在这儿重复下发。
export const SAMPLING = Object.freeze({
  temperature: 0.8,
  top_p: 1,
});

// 每手输出＝小 JSON ＋ 一句台词 ＋ 留档。**别再紧了**——注释早写着这句，我们还是犯了：
// 400 的预算下，deepseek-v4-pro 有 25 手 finish_reason=length（输出中位 231、p90 377、
// 29 手顶到 400），而 gpt-5.6-luna 最大才 213，一次都没碰到。同一个上限，话多的那个被
// 系统性砍断，然后它的"格式失败率"上了榜——那不是它不守契约，是我们的盒子装不下它。
// 真实 OpenRouter 冒烟：默认推理会把 800、1600 乃至裸 4096 全吃光。总信封统一 3072；
// 能力层把其中至多 2048 划给推理、保留约 1024 给 JSON。若仍 length，记在我们头上。
export const MAX_TOKENS = DECISION_MAX_TOKENS;
// 擂台离屏跑，不吃产品内的节拍预算——超时给到产品档（60s）的 2.5 倍：
// 实测 GLM 类长思考型号 p95 越过 60s（12 次超时里重试只救回一半），掐它等于替它降级。
export const TIMEOUT_MS = 150_000;

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
// mods：本桌词条（明牌规则卡，全席对等——引擎 observe().mods 与提示词注入都是现成的，
// 这里只负责把卡摆上桌）。⚠️ 词条改变对局物理，带词条的批次不与基础桌批次比较。
export async function playMatch({ seed, seats, fetchFn, maxSteps = 3000, budget, relaySpeech = true, memory = null, mods = [] } = {}) {
  const ids = ['A', 'B'];
  const m = await createMatch({ seed, config: { players: ids, mods } });
  // 让它们互相听得见（2026-08-10 修）。此前擂台没传 ctx，两个模型从头到尾收不到对方一个字——
  // 于是「牌手层允许诈」（DESIGN §3）在擂台上完全空转，bait 率数的是**对着不存在的听众演戏**。
  //
  // 走宿主的引语分区，**不动引擎**：台词不是动作，不进公开事件流。
  // 引语保留本场全量、标明说话人与当时动作；belief 仍是私有留档，永不外传。
  const dialogue = { A: [], B: [] };
  const ai = {};
  for (const id of ids)
    ai[id] = createOpponent({
      channel: pinSampling(seats[id].channel),
      profile: memory?.[id] ?? '', // 素颜＝''（生面孔）；记忆赛道由 playSeries 递进来
      persona: ARENA_SEAT,
      ctx: relaySpeech ? { dialogue: dialogue[id] } : {},
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

    try {
      await m.act(p, d.action, { elapsedMs: null }); // 不喂用时（见文件头自决）
      // relaySpeech=false 仍是只关引语转发的对照臂。只有已被引擎接受的动作才留台词。
      if (relaySpeech && d.say && !d.silentFallback) {
        const item = { round: ob.round, speaker: p, kind: 'speech', action: { ...d.action }, text: d.say };
        for (const id of ids) dialogue[id].push(structuredClone(item));
      }
    } catch {
      // 走到这儿说明 parseDecision 的合法性校验漏了——记在我们头上（rejects），不算模型的合规失败。
      // 沉默 bot 顶一手把桌子推下去；顶不动就收摊，绝不空转到 maxSteps。
      const last = ai[p].logs.at(-1);
      if (last && !last.auto) last.stale = true; // 幻影记忆防线：被引擎拒绝的那手不进自我回灌
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
export async function playMirrorPair({ seed, x, y, fetchFn, budget, mods = [] } = {}) {
  const first = await playMatch({ seed, seats: { A: x, B: y }, fetchFn, budget, mods });
  const second = await playMatch({ seed, seats: { A: y, B: x }, fetchFn, budget, mods });
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
  pairs, games = 5, seed0 = 1000, fetchFn, budget, onMatch, onPair, concurrency = 1, relaySpeech = true, mods = [],
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
      const r = await playMatch({ seed: j.seed, seats: j.seats, fetchFn, budget, relaySpeech, mods });
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

// ==================== 记忆赛道（Q90 的另一条轨：联赛/夜场方向） ====================
//
// 三局两胜式系列赛：同一对模型连打多场，场间各自带走两样东西——
//   ① **裁判层系列事实**（比分与上一场引擎侧统计，程序算的，错即 bug）；
//   ② **自己的主观假设**（场间一次蒸馏调用；蒸馏失败原样带旧假设，不阻塞系列）。
// 提示词机制零新增：两样都走既有的【档案】分区（核验统计＋主观假设），全席 system 仍逐字相同。
//
// ⚠️ 纪律（Q90 两本账不混流）：有记忆＝顺序效应。系列赛的数字**不可**进素颜榜、
// 不可作统计断言——它回答的是"当宿敌分不分得开"，是内容不是实验。

// 一场的裁判层小结（从事件流复算，不问模型）——系列档案与场间反思共用
export function seriesGameFact(match, seat, index) {
  const opp = seat === 'A' ? 'B' : 'A';
  const st = seatStats(match, seat);
  const so = seatStats(match, opp);
  const res = match.winner == null ? '未终局' : match.winner === seat ? '你胜' : '你负';
  return (
    `第${index + 1}场${res}（${st.rounds}局）：你开牌${st.myChallenges}次中${st.myChallengeHits}次；` +
    `对手开牌${so.myChallenges}次中${so.myChallengeHits}次；对手看骰后报价${so.seenBids}口、其中虚报${so.myBluffs}口；` +
    `对手拨算盘${so.myCalcs}次、宣盲${so.myBlinds}次、扳抬${so.myRaises}次`
  );
}

// 场间蒸馏：把这场的裁判层事实＋自己的留档收敛成对对手的假设（一次调用，失败返回 null）。
// Q86 口径：system 只有任务与 schema，不教它怎么读、不催它记仇。
export async function seriesReflect(channel, { ownLog = [], factText, hypotheses = [], price, budget } = {}, fetchFn) {
  const said = ownLog
    .filter((l) => !l.auto && !l.silentFallback && (l.say || l.belief))
    .slice(-12)
    .map((l) => `第${l.round}局${l.say ? `说「${l.say}」` : ''}${l.belief ? `（当时判断「${l.belief}」）` : ''}`)
    .join('；');
  const meta = {};
  try {
    const raw = await chat(
      channel,
      {
        system:
          '系列赛两场之间，你在整理对同一个对手的判断。只依据给你的事实与留档。' +
          '严格输出一行 JSON：{"hypotheses":[{"text":"一句关于对手的假设","hits":证据次数,"misses":["反例"]}]}，最多 4 条。',
        user: `刚打完的一场：${factText}
你本场的留档：${said || '（无）'}
你既有的假设：${
          hypotheses.length
            ? hypotheses.map((h) => `「${h.text}」（证据${h.hits ?? 0}${h.misses?.length ? `，反例：${h.misses.join('、')}` : ''}）`).join('；')
            : '（还没有）'
        }`,
        maxTokens: MAX_TOKENS,
        timeoutMs: TIMEOUT_MS,
        meta,
      },
      fetchFn,
    );
    budget?.charge?.(meta, price);
    return clipHypotheses(JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).hypotheses);
  } catch {
    budget?.charge?.(meta, price);
    return null;
  }
}

// 系列赛主循环：先到 need 胜为止（最多 bestOf 场）。每场换骰种（seed0+g），座位不换——
// 换座会把"记忆里的对手"换成另一副骰运，先手差留给镜像系列（调用方跑两个方向）。
//
// openBook（用户裁决 2026-08-11）：**场间互相明牌**——每场结束后双方的假设本对翻，
// 下一场你能看到对手的本子上怎么写你（他也知道你看得到）。这是 §2.4 明牌档案
// （"看过档案的你会试图反装，而反装也是它的阅读材料"）在 AI 对 AI 上的对称应用；
// 喂的是数据、机制在数据标签里如实说明，Q86 合规。--no-openbook 为对照臂。
export async function playSeries({ seed0 = 1, bestOf = 3, seats, fetchFn, budget, relaySpeech = true, openBook = true, mods = [], onGame = null } = {}) {
  const need = (bestOf >> 1) + 1;
  const ids = ['A', 'B'];
  const wins = { A: 0, B: 0 };
  const hypotheses = { A: [], B: [] };
  const games = [];
  const trail = { A: [], B: [] }; // 每场之后的假设快照——"它学到了什么"的观察窗
  const bud = budget?.forMatch?.() ?? budget;
  while (games.length < bestOf && wins.A < need && wins.B < need && !bud?.runExceeded?.()) {
    const g = games.length;
    const memory = {};
    for (const id of ids) {
      const opp = id === 'A' ? 'B' : 'A';
      memory[id] = {
        verified: [
          `系列赛（${bestOf}场${need}胜，同一对手连打）：当前比分 你${wins[id]}胜、对手${wins[opp]}胜，即将开第${g + 1}场`,
          ...games.map((r, i) => seriesGameFact(r, id, i)),
        ],
        subjective: { notes: [], hypotheses: hypotheses[id] },
        ...(openBook ? { rivalHypotheses: hypotheses[opp] } : {}),
      };
    }
    const r = await playMatch({ seed: seed0 + g, seats, fetchFn, budget, relaySpeech, memory, mods });
    games.push(r);
    onGame?.(r); // 逐场回调（CLI 增量落盘）——bo5 一跑一两个小时，中途得能翻牌
    if (r.winner) wins[r.winner] += 1;
    if (r.aborted) break;
    if (!(games.length < bestOf && wins.A < need && wins.B < need)) break; // 没有下一场就不必反思
    bud?.startMatch?.();
    for (const id of ids) {
      const next = await seriesReflect(
        pinSampling(seats[id].channel),
        { ownLog: r.logs[id], factText: seriesGameFact(r, id, g), hypotheses: hypotheses[id], price: seats[id].price, budget: bud },
        fetchFn,
      );
      if (next) hypotheses[id] = next;
      trail[id].push(structuredClone(hypotheses[id]));
    }
  }
  const winner = wins.A >= need ? 'A' : wins.B >= need ? 'B' : null;
  return { bestOf, seed0, seats: { A: seats.A.label, B: seats.B.label }, games, wins: { ...wins }, winner, hypothesesTrail: trail };
}
