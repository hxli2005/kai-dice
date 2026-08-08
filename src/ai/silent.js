// 沉默模式（DESIGN §3.4 降级链末端）：纯数学行棋，不说话。
// 明显变弱是诚实的（§3.1）。决策只用双发过的事实工具（概率计算器）。

import { allLegalBids } from '../rules.js';
import { probBidTrue } from '../probability.js';

// challengeThreshold 为行为参数（§3.2），非失误注入
export function createSilentBot({ challengeThreshold = 0.25 } = {}) {
  return {
    decide(ob) {
      if (ob.yourDice === null && ob.legal.some((a) => a.type === 'peek'))
        return { type: 'peek' };
      const myDice = ob.yourDice ?? []; // 盲局顶班：按零已见算
      const total = ob.diceCount.you + ob.diceCount.opp;
      const bids = allLegalBids(ob.currentBid, ob.zhai, total);
      const pTrue = (b) => probBidTrue(b, myDice, ob.diceCount.opp, ob.zhai);
      if (ob.currentBid && (bids.length === 0 || pTrue(ob.currentBid) < challengeThreshold))
        return { type: 'challenge' };
      let best = bids[0];
      for (const b of bids) if (pTrue(b) > pTrue(best) + 1e-12) best = b;
      return { type: 'bid', ...best };
    },
  };
}
