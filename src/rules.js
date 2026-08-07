// 规则纯函数：报数阶梯与开牌判定（DESIGN §2）

// TODO(Q1) 占位：飞局可报点数 2–6，斋局 1–6；点数自然序比大小
export function legalFaces(zhai) {
  return zhai ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6];
}

// 阶梯：数量加大，或同数量下点数加大（§2.1）
export function beats(next, prev) {
  if (!prev) return true;
  return next.count > prev.count || (next.count === prev.count && next.face > prev.face);
}

// 报数合法性：首报数量 ≥ 2；数量不超过场上总骰数（TODO(Q1)）；点数在许可范围
export function isLegalBid(bid, prev, zhai, totalDice) {
  if (!Number.isInteger(bid.count) || !Number.isInteger(bid.face)) return false;
  if (!legalFaces(zhai).includes(bid.face)) return false;
  if (bid.count < 2 || bid.count > totalDice) return false;
  return beats(bid, prev);
}

// 全部合法报数，升序（数量优先，同数量按点数）；首项即超时时的"最小抬价"（§2.4）
export function allLegalBids(prev, zhai, totalDice) {
  const out = [];
  for (let count = 2; count <= totalDice; count++)
    for (const face of legalFaces(zhai))
      if (isLegalBid({ count, face }, prev, zhai, totalDice)) out.push({ count, face });
  return out;
}

// 开牌清点：报数成立与否。飞局 1 为万能（§2.1），斋局关闭（§2.3）
export function countBid(bid, allDice, zhai) {
  return allDice.filter((d) => d === bid.face || (!zhai && d === 1)).length;
}

export function bidStands(bid, allDice, zhai) {
  return countBid(bid, allDice, zhai) >= bid.count;
}
