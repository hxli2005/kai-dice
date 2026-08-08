// 事实工具：概率计算器（DESIGN 附B.1）。
// 只回答"世界是什么样"：给定已知骰与报价，报价为真/恰好为真的精确概率。
// 双发红线：本模块同时供 AI 客户端与玩家 UI 表盘使用。
// 词条「亮一颗」引入公开明骰后，"已知骰"＝自见骰＋他人亮出的骰（obKnown 统一折算）。

import { countBid } from './rules.js';

function binomPmf(n, k, p) {
  // P(X = k), X ~ Bin(n, p)
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let j = 0; j < k; j++) c = (c * (n - j)) / (j + 1);
  return c * p ** k * (1 - p) ** (n - k);
}

function binomTail(n, k, p) {
  // P(X ≥ k), X ~ Bin(n, p)
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  for (let i = k; i <= n; i++) sum += binomPmf(n, i, p);
  return sum;
}

const pMatch = (bid, zhai) => (!zhai && bid.face !== 1 ? 2 / 6 : 1 / 6); // 飞局癞子加成

// unknownCount 颗未知骰视为均匀随机时，"至少 count 个 face"为真的概率
export function probBidTrue(bid, knownDice, unknownCount, zhai) {
  const need = bid.count - countBid(bid, knownDice, zhai);
  return binomTail(unknownCount, need, pMatch(bid, zhai));
}

// "恰好 count 个 face"的概率（词条「掐」的表盘双发，Q37）
export function probBidExact(bid, knownDice, unknownCount, zhai) {
  const need = bid.count - countBid(bid, knownDice, zhai);
  return binomPmf(unknownCount, need, pMatch(bid, zhai));
}

// 从 observe() 折算已知/未知：自见骰＋他人亮出的明骰为已知，其余为未知。
// 盲局/未看骰时 yourDice 为 null——按零已见算，这就是他的真实认知。
export function obKnown(ob) {
  const othersShown = Object.entries(ob.shown ?? {})
    .filter(([q]) => q !== ob.you)
    .flatMap(([, faces]) => faces);
  return {
    known: [...(ob.yourDice ?? []), ...othersShown],
    unknown: ob.diceCount.opp - othersShown.length,
  };
}

export function obProb(ob, bid) {
  const { known, unknown } = obKnown(ob);
  return probBidTrue(bid, known, unknown, ob.zhai);
}

export function obProbExact(ob, bid) {
  const { known, unknown } = obKnown(ob);
  return probBidExact(bid, known, unknown, ob.zhai);
}
