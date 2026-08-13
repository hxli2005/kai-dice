// 内部概率函数：只供沉默降级策略与离线指标复算，不构成玩家或模型可调用的桌面工具。
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

// 从 observe() 折算已知/未知：自见骰＋他人亮出的明骰为已知，其余为未知。
// 盲局/未看骰时 yourDice 为 null——自己那几颗也是未知（它们仍在桌上参与清点，
// 漏算会把盲局的概率系统性算低）。未知数一律 = 场上总骰 − 已知骰。
export function obKnown(ob) {
  const othersShown = Object.entries(ob.shown ?? {})
    .filter(([q]) => q !== ob.you)
    .flatMap(([, faces]) => faces);
  const known = [...(ob.yourDice ?? []), ...othersShown];
  return { known, unknown: ob.diceCount.you + ob.diceCount.opp - known.length };
}

export function obProb(ob, bid) {
  const { known, unknown } = obKnown(ob);
  return probBidTrue(bid, known, unknown, ob.zhai);
}

// 沉默降级台词只用粗档，不展示内部数值。
export function coarseWord(p) {
  return p >= 0.7 ? '基本稳' : p >= 0.4 ? '五五开' : p >= 0.15 ? '悬' : '纯扯';
}
