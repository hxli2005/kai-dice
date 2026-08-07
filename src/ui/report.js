// 结算报告卡数据面（DESIGN §5.2）：从事件流复算，判词素材同源（不许编）。
// TODO(Q5) 统计口径占位：虚报=报数时刻 P(为真|自见骰面)<0.5；人格映射用简单阈值规则。

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
      oppCount = e.diceCount[you === 'A' ? 'B' : 'A'];
    }
    if (e.type === 'declare' && e.declaration === 'zhai') zhai = true;
    if (e.type === 'declare' && e.declaration === 'blind' && e.player === you) s.myBlinds++;
    if (e.type === 'bid') {
      depth++;
      if (e.player === you) {
        s.myBids++;
        const mine = myDiceByRound[round];
        if (mine && probBidTrue({ count: e.count, face: e.face }, mine, oppCount, zhai) < 0.5)
          s.myBluffs++;
        if (e.elapsedMs != null) {
          s.myTimes.push(e.elapsedMs);
          if (!s.slowest || e.elapsedMs > s.slowest.ms)
            s.slowest = { round, bid: { count: e.count, face: e.face }, ms: e.elapsedMs };
        }
      }
    }
    if (e.type === 'reveal') {
      s.ladderDepths.push(depth);
      const challenger = e.stands ? e.loser : e.loser === 'A' ? 'B' : 'A';
      if (challenger === you) {
        s.myChallenges++;
        if (!e.stands) s.myChallengeHits++;
      } else if (e.bid.player === you) {
        s.timesChallenged++;
      }
    }
  }
  const div = (a, b) => (b ? a / b : 0);
  return {
    ...s,
    bluffRate: div(s.myBluffs, s.myBids),
    challengedRate: div(s.timesChallenged, s.myBids),
    hitRate: div(s.myChallengeHits, s.myChallenges),
    avgDepth: div(s.ladderDepths.reduce((a, b) => a + b, 0), s.ladderDepths.length),
    avgTimeMs: div(s.myTimes.reduce((a, b) => a + b, 0), s.myTimes.length),
  };
}

// 酒桌人格（§5.2）。TODO(Q5) 映射规则占位
export function persona(st) {
  if (st.myBlinds >= 2) return '盲侠';
  if (st.bluffRate > 0.5) return '赌徒';
  if (st.bluffRate < 0.15 && st.myBids >= 3) return '老实人';
  if (st.myChallenges === 0 && st.rounds >= 3) return '缩头鹌鹑';
  if (st.hitRate >= 0.7 && st.avgTimeMs > 8000) return '会计';
  return '半张脸';
}

// 模板判词（无 LLM 通道时的降级；引用具体局面，素材来自真实事件流）
export function templateVerdict(st, won) {
  const bits = [];
  if (st.slowest && st.slowest.ms > 6000)
    bits.push(
      `第${st.slowest.round}局你想了${(st.slowest.ms / 1000).toFixed(0)}秒才报${st.slowest.bid.count}个${st.slowest.bid.face}——那一手我记下了`,
    );
  if (st.bluffRate > 0.5) bits.push(`十句里${Math.round(st.bluffRate * 10)}句是空的，胆子不小`);
  else if (st.bluffRate < 0.15 && st.myBids >= 3) bits.push('你几乎不说谎，所以你一抬价我就信');
  if (st.myChallenges > 0 && st.hitRate < 0.34)
    bits.push(`你开我${st.myChallenges}次错${st.myChallenges - st.myChallengeHits}次，手比脑子快`);
  if (st.myChallenges === 0 && st.rounds >= 3) bits.push('一次都不敢开，我报什么你都得受着');
  bits.push(won ? '这局算你的，账还长' : '骰子不会骗人，你会');
  return bits.slice(0, 3).join('。') + '。';
}
