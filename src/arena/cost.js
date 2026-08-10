// 成本护栏（施工单 A4，凭 Q52④／Q53 降本三件）。
//
// 三件事：**开跑前估**（不知道要花多少钱就别按回车）、**跑的时候刹**（单场上限＋整批上限）、
// **跑完了对账**（用回执里的真花费，不用自己的估算糊弄自己）。
//
// A4 红线（Q53）：**禁止把消费级订阅（Claude Max 等）桥接成 API 后端**——违反其服务条款、
// 有封号风险（触 Q7 保命三律"别被抓"），且与 BYOK 架构不兼容（玩家没法人手一个桥接器）。
// 官方与推荐路径只走正规 API。这条不是成本问题，是活着的问题。
//
// 量级参考（Q53 实测口径）：每手约 3k 输入/150 输出、每场 40 手 →
// 便宜档 ≈¥1/场，中档 ≈¥2/场，贵档 ≈¥5/场。风味层实验（8 模型×10 场）总计几十元——
// **不必为省这点 API 费去动订阅的脑筋。**

export const SUBSCRIPTION_RED_LINE =
  '禁止把消费级订阅（Claude Max 等）桥接为 API 后端：违反服务条款＋封号风险（Q7 别被抓），且与 BYOK 不兼容。';

// 每手用量的估算口径（保守偏高：宁可估贵了不按回车，也别跑到一半发现超支）
export const HAND_ESTIMATE = Object.freeze({ handsPerMatch: 40, inTokens: 2500, outTokens: 200 });

// 单次调用的真实花费。优先用回执里的账单（OpenRouter 带 usage:{include:true} 才有），
// 拿不到才按 token×单价自己算——**并且如实标记这是估的**（见 metrics 的 usdFromApi）。
export function callCost(meta = {}, price = {}) {
  if (typeof meta.cost === 'number') return meta.cost;
  const inTok = meta.inTokens ?? 0;
  const outTok = meta.outTokens ?? 0;
  const cached = Math.min(meta.cacheRead ?? 0, inTok);
  const pIn = price.promptPrice ?? 0;
  const pOut = price.completionPrice ?? 0;
  const pCache = price.cacheReadPrice ?? pIn;
  return (inTok - cached) * pIn + cached * pCache + outTok * pOut;
}

// 单场估价（两席各出一半手数）
export function estimateMatch(priceA, priceB, o = HAND_ESTIMATE) {
  const half = o.handsPerMatch / 2;
  const one = (p) => half * (o.inTokens * (p?.promptPrice ?? 0) + o.outTokens * (p?.completionPrice ?? 0));
  return one(priceA) + one(priceB);
}

// 整批估价。pairs＝[[x,y],…]，每对打 games 场，每场是一对镜像局（×2）。
export function estimateRun({ pairs, games = 5, opts = HAND_ESTIMATE } = {}) {
  let usd = 0;
  const perPair = [];
  const unpriced = new Set();
  for (const [x, y] of pairs) {
    for (const e of [x, y]) if (e.price && e.price.priceKnown === false) unpriced.add(e.label);
    const one = estimateMatch(x.price, y.price, opts) * games * 2;
    usd += one;
    perPair.push({ pair: [x.label, y.label], usd: +one.toFixed(4) });
  }
  const matches = pairs.length * games * 2;
  return {
    usd: +usd.toFixed(4),
    matches,
    calls: matches * opts.handsPerMatch,
    perPair,
    // 价格不定的参赛者会让估算凭空少算——必须点名，不许悄悄按 0 算
    unpriced: [...unpriced],
    note:
      '估算口径：每手 ' + opts.inTokens + ' 输入/' + opts.outTokens + ' 输出，每场 ' + opts.handsPerMatch + ' 手（偏高估）' +
      (unpriced.size ? `；**${[...unpriced].join('、')} 价格不定，这份估算少算了它们**` : ''),
  };
}

// 刹车（A4：设单场上限）。charge 逐发记账；两级停：
// **单场触顶只收这一场**（下一场 startMatch 自动解除），**整批触顶收全场**。
export function createBudget({ capUsd = null, perMatchUsd = null } = {}) {
  let spent = 0;
  let runStop = null;

  // 整批的账是共用的；**单场的账必须各记各的**——并发跑的时候，
  // 一个共享的 matchSpent 会让 A 场的花费触发 B 场的单场刹车（或反过来漏刹）。
  const chargeRun = (meta, price) => {
    const c = callCost(meta, price);
    spent += c;
    if (capUsd != null && spent >= capUsd) runStop = `整批上限 $${capUsd} 已用尽（实花 $${spent.toFixed(4)}）`;
    return c;
  };
  const shared = {
    runExceeded: () => runStop != null,
    spent: () => +spent.toFixed(4),
  };

  // 一场一份账本：playMatch 拿到的是这个，不是全局的那个
  const forMatch = () => {
    let matchSpent = 0;
    let matchStop = null;
    return {
      ...shared,
      forMatch,
      startMatch() {
        matchSpent = 0;
        matchStop = null;
      },
      charge(meta, price) {
        const c = chargeRun(meta, price);
        matchSpent += c;
        if (perMatchUsd != null && matchSpent >= perMatchUsd) matchStop = `单场上限 $${perMatchUsd} 触顶`;
        return c;
      },
      exceeded: () => runStop != null || matchStop != null,
      reason: () => runStop ?? matchStop,
      matchSpent: () => +matchSpent.toFixed(4),
    };
  };

  // 顶层对象自己也是一份账本（串行调用方照旧能用）
  return { ...forMatch(), reason: () => runStop ?? null };
}

// 缓存验收（Q53 的坑）：**可缓存的最小前缀是分档的**（各家不同，短前缀会静默失效）。
// 我们的擂台系统提示词本来就不长，所以这里只报事实：命中了多少、有没有命中。
// 报"没省到"比报一个想当然的省钱数诚实。
export function cacheReport(rows) {
  const out = rows.map((r) => ({
    label: r.label,
    inTokens: r.cost.inTokens,
    cacheRead: r.cost.cacheRead,
    hitRate: r.cost.inTokens ? +(r.cost.cacheRead / r.cost.inTokens).toFixed(3) : null,
  }));
  const anyHit = out.some((o) => o.cacheRead > 0);
  return {
    rows: out,
    anyHit,
    note: anyHit
      ? '缓存有命中：稳定前缀（系统提示词）确实被复用了'
      : '缓存命中为 0——要么前缀短于该家的最小可缓存长度（静默失效），要么这条后端不缓存。**别当成已经省了钱。**',
  };
}

// 思考型标注（A4：慢且贵）——旗子来自模型清单自己，不靠我们猜
export const thinkingNote = (model) =>
  model?.reasoningMandatory
    ? '思考型（强制，关不掉）：慢且贵，且会吃掉 max_tokens 预算'
    : model?.reasoning
      ? '思考型（默认开，擂台已统一关闭）'
      : '';
