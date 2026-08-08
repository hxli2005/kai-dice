// 结算报告卡数据面（DESIGN §5.2）：从事件流复算，判词素材同源（不许编）。
// 统计口径（附:待定参数表）：虚报＝报数时刻 P(为真|自见骰面)<50%。

import { probBidTrue } from '../probability.js';

// myDiceByRound: {round: dice[]}，由 UI 在每局看骰时记录
export function computeStats(events, you, myDiceByRound) {
  const s = {
    rounds: 0,
    myBids: 0,
    myBluffs: 0,
    timesChallenged: 0,
    myChallenges: 0,
    myChallengeHits: 0,
    myBlinds: 0,
    ladderDepths: [],
    myTimes: [],
    slowest: null, // {round, bid, ms}
  };
  // 条件对比（Q15/T5）：连败后虚报、大池 vs 小池开牌、被开后的首报保守度
  const cond = {
    afterLossBids: 0, afterLossBluffs: 0,
    bigPotOpps: 0, bigPotOpens: 0, smallPotOpps: 0, smallPotOpens: 0,
    postChalFirstPs: [], allFirstPs: [],
  };
  let prevRoundLost = false;
  let prevRoundChallenged = false;
  let myFirstBidThisRound = true;
  let round = 0;
  let zhai = false;
  let oppCount = 0;
  let depth = 0;
  for (const e of events) {
    if (e.type === 'roundStart') {
      round = e.round;
      s.rounds = e.round;
      zhai = false;
      depth = 0;
      myFirstBidThisRound = true;
      oppCount = Object.entries(e.diceCount)
        .filter(([k]) => k !== you)
        .reduce((a, [, v]) => a + v, 0);
    }
    if (e.type === 'declare' && e.declaration === 'zhai') zhai = true;
    if (e.type === 'declare' && e.declaration === 'blind' && e.player === you) s.myBlinds++;
    if (e.type === 'bid') {
      depth++;
      if (e.player === you) {
        s.myBids++;
        // 面对已有报价而选择抬（没开）＝一次放过的开牌机会
        if (depth > 1) {
          if (depth >= 4) cond.bigPotOpps++;
          else cond.smallPotOpps++;
        }
        const mine = myDiceByRound[round];
        const pv = mine ? probBidTrue({ count: e.count, face: e.face }, mine, oppCount, zhai) : null;
        if (pv != null && myFirstBidThisRound) {
          cond.allFirstPs.push(pv);
          if (prevRoundChallenged) cond.postChalFirstPs.push(pv);
        }
        myFirstBidThisRound = false;
        if (prevRoundLost) {
          cond.afterLossBids++;
          if (pv != null && pv < 0.5) cond.afterLossBluffs++;
        }
        if (pv != null && pv < 0.5) s.myBluffs++;
        if (e.elapsedMs != null) {
          s.myTimes.push(e.elapsedMs);
          if (!s.slowest || e.elapsedMs > s.slowest.ms)
            s.slowest = { round, bid: { count: e.count, face: e.face }, ms: e.elapsedMs };
        }
      }
    }
    if (e.type === 'reveal') {
      s.ladderDepths.push(depth);
      const challenger = e.challenger ?? (e.stands ? e.loser : e.loser === 'A' ? 'B' : 'A');
      if (challenger === you) {
        s.myChallenges++;
        if (!e.stands) s.myChallengeHits++;
        if (depth >= 4) cond.bigPotOpens++;
        else cond.smallPotOpens++;
        if (depth >= 4) cond.bigPotOpps++;
        else cond.smallPotOpps++;
      } else if (e.bid.player === you) {
        s.timesChallenged++;
      }
      prevRoundLost = e.loser === you;
      prevRoundChallenged = e.bid.player === you && e.loser === you; // 我被开且输了
    }
  }
  const div = (a, b) => (b ? a / b : 0);
  const avg = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null);
  return {
    ...s,
    conditional: {
      afterLossBluffRate: cond.afterLossBids >= 2 ? div(cond.afterLossBluffs, cond.afterLossBids) : null,
      afterLossBids: cond.afterLossBids,
      bigPotOpenRate: cond.bigPotOpps >= 2 ? div(cond.bigPotOpens, cond.bigPotOpps) : null,
      smallPotOpenRate: cond.smallPotOpps >= 2 ? div(cond.smallPotOpens, cond.smallPotOpps) : null,
      postChalFirstP: avg(cond.postChalFirstPs),
      baseFirstP: avg(cond.allFirstPs),
    },
    bluffRate: div(s.myBluffs, s.myBids),
    challengedRate: div(s.timesChallenged, s.myBids),
    hitRate: div(s.myChallengeHits, s.myChallenges),
    avgDepth: div(s.ladderDepths.reduce((a, b) => a + b, 0), s.ladderDepths.length),
    avgTimeMs: div(s.myTimes.reduce((a, b) => a + b, 0), s.myTimes.length),
  };
}

// 条件倾向 → 人话（Q15：二级证据杀伤力最大；样本不足保持沉默）
export function condBrief(st) {
  const c = st.conditional;
  if (!c) return '';
  const bits = [];
  if (c.afterLossBluffRate != null && st.bluffRate != null) {
    const d = c.afterLossBluffRate - st.bluffRate;
    if (d > 0.2) bits.push(`输过一局后虚报明显变多（${Math.round(st.bluffRate * 100)}%→${Math.round(c.afterLossBluffRate * 100)}%，上头型）`);
    else if (d < -0.2) bits.push(`输过一局后明显变老实（虚报${Math.round(st.bluffRate * 100)}%→${Math.round(c.afterLossBluffRate * 100)}%）`);
  }
  if (c.bigPotOpenRate != null && c.smallPotOpenRate != null && c.smallPotOpenRate > 0) {
    if (c.bigPotOpenRate < c.smallPotOpenRate * 0.5)
      bits.push('池一深就不敢开（大池开牌率不到小池一半）');
    else if (c.bigPotOpenRate > c.smallPotOpenRate * 1.8)
      bits.push('池越深越敢开（赌性在大池上）');
  }
  if (c.postChalFirstP != null && c.baseFirstP != null && c.postChalFirstP - c.baseFirstP > 0.18)
    bits.push('被开过一次，下一局的首报就明显缩');
  return bits.join('；');
}

// 酒桌人格（§5.2，附:待定参数表）：按序优先匹配
export function persona(st) {
  if (st.myBlinds >= 2) return '盲侠';
  if (st.bluffRate > 0.5) return '赌徒';
  if (st.bluffRate < 0.15 && st.myBids >= 3) return '老实人';
  if (st.myChallenges === 0 && st.rounds >= 3) return '缩头鹌鹑';
  if (st.hitRate >= 0.7 && st.avgTimeMs > 8000) return '会计';
  return '半张脸';
}

// 模板判词（无 LLM 通道时的降级；引用具体局面，素材来自真实事件流）
// Q15 证据分级：条件倾向（心理侧）最先，决策事实次之；用时不报秒数，只留极端犹豫的现象学一句垫底
export function templateVerdict(st, won) {
  const r = (x) => Math.round(x * 100);
  const c = st.conditional ?? {};
  const bits = [];
  if (c.afterLossBluffRate != null && c.afterLossBluffRate - st.bluffRate > 0.2)
    bits.push(`一输你就浮——虚报${r(st.bluffRate)}%变${r(c.afterLossBluffRate)}%，脾气全写在报价里`);
  else if (c.afterLossBluffRate != null && st.bluffRate - c.afterLossBluffRate > 0.2)
    bits.push(`一输你就缩——虚报${r(st.bluffRate)}%掉到${r(c.afterLossBluffRate)}%，我看得见你怕`);
  if (c.bigPotOpenRate != null && c.smallPotOpenRate > 0 && c.bigPotOpenRate < c.smallPotOpenRate * 0.5)
    bits.push('池一深你就不敢开——小注掀我，大注受着');
  if (c.postChalFirstP != null && c.baseFirstP != null && c.postChalFirstP - c.baseFirstP > 0.18)
    bits.push('被我开过一回，下一局你的首报就缩——这个毛病比虚报值钱');
  if (st.bluffRate > 0.5) bits.push(`十句里${Math.round(st.bluffRate * 10)}句是空的，胆子不小`);
  else if (st.bluffRate < 0.15 && st.myBids >= 3) bits.push('你几乎不说谎，所以你一抬价我就信');
  if (st.myChallenges > 0 && st.hitRate < 0.34)
    bits.push(`你开我${st.myChallenges}次错${st.myChallenges - st.myChallengeHits}次，手比脑子快`);
  if (st.myChallenges === 0 && st.rounds >= 3) bits.push('一次都不敢开，我报什么你都得受着');
  if (st.slowest && st.slowest.ms > 8000)
    bits.push(`第${st.slowest.round}局你停了半天才报${st.slowest.bid.count}个${st.slowest.bid.face}——不是在算数，是在攒胆子`);
  bits.push(won ? '这局算你的，账还长' : '骰子不会骗人，你会');
  return bits.slice(0, 3).join('。') + '。';
}
