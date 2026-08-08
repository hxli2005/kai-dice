// 沉默模式（DESIGN §3.4 降级链末端）：纯数学行棋，不说话。
// 明显变弱是诚实的（§3.1）。决策只用双发过的事实工具（概率计算器）。
// 词条纪律：沉默 bot 不使用任何词条动作（宣言/词条的扣扳机必须是模型，Q22-补反脚本红线）；
// 但要在词条改变的局面下守法——「让报」会把你自己的价推回来，此时开牌不合法，只能继续抬。

import { allLegalBids } from '../rules.js';
import { obProb } from '../probability.js';

// challengeThreshold 为行为参数（§3.2），非失误注入
export function createSilentBot({ challengeThreshold = 0.25 } = {}) {
  return {
    decide(ob) {
      if (ob.yourDice === null && ob.legal.some((a) => a.type === 'peek'))
        return { type: 'peek' };
      const total = ob.diceCount.you + ob.diceCount.opp;
      const bids = allLegalBids(ob.currentBid, ob.zhai, total);
      const canChallenge = ob.legal.some((a) => a.type === 'challenge');
      if (
        ob.currentBid &&
        canChallenge &&
        (bids.length === 0 || obProb(ob, ob.currentBid) < challengeThreshold)
      )
        return { type: 'challenge' };
      // 防御性兜底（让报把路堵死的边角）：兜底也不拨算盘——它的数一直在心里（Q45 沉默 bot 豁免）
      if (!bids.length)
        return canChallenge
          ? { type: 'challenge' }
          : (ob.legal.filter((a) => a.type !== 'calc').at(-1) ?? ob.legal.at(-1));
      let best = bids[0];
      for (const b of bids) if (obProb(ob, b) > obProb(ob, best) + 1e-12) best = b;
      return { type: 'bid', ...best };
    },
  };
}
