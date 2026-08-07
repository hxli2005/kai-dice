// 事实工具：概率计算器（DESIGN 附B.1）。
// 只回答"世界是什么样"：给定自有骰与报价，报价为真的精确概率。
// 双发红线：本模块同时供 AI 客户端与玩家 UI 表盘使用。

import { countBid } from './rules.js';

function binomTail(n, k, p) {
  // P(X ≥ k), X ~ Bin(n, p)
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    sum += c * p ** i * (1 - p) ** (n - i);
  }
  return sum;
}

// 对面 oppCount 颗未知骰视为均匀随机时，"至少 count 个 face"为真的概率
export function probBidTrue(bid, myDice, oppCount, zhai) {
  const need = bid.count - countBid(bid, myDice, zhai);
  const pMatch = !zhai && bid.face !== 1 ? 2 / 6 : 1 / 6; // 飞局癞子加成
  return binomTail(oppCount, need, pMatch);
}
