// 结算报告卡数据面（DESIGN §5.2）：从事件流复算，判词素材同源（不许编）。
// 统计口径（附:待定参数表）：虚报＝报数时刻 P(为真|自见骰面)<50%。

import { probBidTrue } from '../probability.js';

// 从摊牌事件回溯某席位每局骰面（公开信息）——行为统计复算的输入；
// UI 侧给 AI 席用，好友房服务端给双人对比卡用
export function diceByRoundOf(events, seat) {
  const map = {};
  let round = 0;
  for (const e of events) {
    if (e.type === 'roundStart') round = e.round;
    if (e.type === 'reveal' && e.dice[seat]) map[round] = e.dice[seat];
  }
  return map;
}

// myDiceByRound: {round: dice[]}，由 UI 在每局看骰时记录
export function computeStats(events, you, myDiceByRound) {
  const s = {
    rounds: 0, // 全桌局数
    roundsAlive: 0, // 你参战的局数（出局后桌子还在打——F0：两个数不许混成一个）
    myBids: 0,
    myBluffs: 0,
    timesChallenged: 0,
    myChallenges: 0,
    myChallengeHits: 0,
    myCalzas: 0,
    myCalzaHits: 0,
    myBlinds: 0,
    myRaises: 0,
    myCalcs: 0, // Q45/F6：拨算盘的次数
    calcDecisions: 0, // 算完后可判定的决策手数
    calcFollows: 0, // 其中"照着数走"的手数
    vs: {}, // F0 归属拆分：{对手座位: {iOpened, iOpenedHit, theyOpenedMe}}
    bigPots: [], // F5 记忆加权：≥×4 的高倍局
    ladderDepths: [],
    myTimes: [],
    slowest: null, // {round, bid, ms}
  };
  const vs = (seat) => (s.vs[seat] ??= { iOpened: 0, iOpenedHit: 0, theyOpenedMe: 0 });
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
  let curBid = null; // 当前报价（算盘依赖度要判"算完这一手照没照着数走"）
  let calcPending = false;
  // 算完的下一手照没照着数走：开牌看当前报价站不站得住（低概率就开＝照走），
  // 抬价看自己接下来这口价（或仍在桌上的那口）站不站得住。ref 为空（盲局没记骰）就不判。
  const judgeCalc = (kind, bid) => {
    if (!calcPending) return;
    calcPending = false;
    const mine = myDiceByRound[round];
    const ref = curBid ?? bid;
    if (!mine || !ref) return;
    const pv = probBidTrue({ count: ref.count, face: ref.face }, mine, oppCount, zhai);
    s.calcDecisions++;
    if (kind === 'challenge' ? pv < 0.5 : pv >= 0.5) s.calcFollows++;
  };
  for (const e of events) {
    if (e.type === 'roundStart') {
      round = e.round;
      s.rounds = e.round;
      if ((e.diceCount?.[you] ?? 0) > 0) s.roundsAlive++;
      zhai = false;
      depth = 0;
      curBid = null;
      calcPending = false;
      myFirstBidThisRound = true;
      oppCount = Object.entries(e.diceCount)
        .filter(([k]) => k !== you)
        .reduce((a, [, v]) => a + v, 0);
    }
    if (e.type === 'declare' && e.declaration === 'zhai') zhai = true;
    if (e.type === 'declare' && e.declaration === 'blind' && e.player === you) s.myBlinds++;
    if (e.type === 'declare' && e.declaration === 'raise' && e.player === you) s.myRaises++;
    if (e.type === 'calc' && e.player === you) {
      s.myCalcs++;
      calcPending = true;
    }
    if (e.type === 'bid') {
      depth++;
      if (e.player === you) {
        judgeCalc('bid', { count: e.count, face: e.face });
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
      curBid = { count: e.count, face: e.face, player: e.player };
    }
    if (e.type === 'reveal') {
      s.ladderDepths.push(depth);
      const challenger = e.challenger ?? (e.stands ? e.loser : e.loser === 'A' ? 'B' : 'A');
      if (challenger === you) judgeCalc('challenge', e.bid);
      if (challenger === you && e.calza) {
        // 掐的判定是"恰好"，不是"成不成立"——两笔账分开记
        s.myCalzas++;
        if (e.exact) s.myCalzaHits++;
        vs(e.bid.player).iOpened++;
        if (e.exact) vs(e.bid.player).iOpenedHit++;
      } else if (challenger === you) {
        s.myChallenges++;
        if (!e.stands) s.myChallengeHits++;
        vs(e.bid.player).iOpened++; // F0：这一开算在谁头上，写清楚
        if (!e.stands) vs(e.bid.player).iOpenedHit++;
        if (depth >= 4) cond.bigPotOpens++;
        else cond.smallPotOpens++;
        if (depth >= 4) cond.bigPotOpps++;
        else cond.smallPotOpps++;
      } else if (e.bid.player === you) {
        s.timesChallenged++;
        vs(challenger).theyOpenedMe++;
      }
      prevRoundLost = e.loser === you;
      prevRoundChallenged = e.bid.player === you && e.loser === you; // 我被开且输了
    }
    // F5 筹码记忆加权：≥×4 的池不许被忘掉——判词与下一场开场白优先引用
    if (e.type === 'roundEnd' && (e.mult ?? 1) >= 4)
      s.bigPots.push({ round: e.round, mult: e.mult, won: e.winner === you, transfer: e.transfer });
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
    // F6 算盘依赖度：算完照着数走的比例——纯心算的人这项永远是 0，那是他的隐身衣（Q45 明示接受）
    calcFollowRate: s.calcDecisions ? div(s.calcFollows, s.calcDecisions) : null,
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
  // F6 算盘依赖度：他信数还是信人——这是 Q45 新开的读心通道
  if (st.myCalcs >= 2 && st.calcFollowRate != null) {
    if (st.calcFollowRate >= 0.8)
      bits.push(`算了 ${st.myCalcs} 次，几乎次次照着数走（他在跟算盘打牌，不是跟人）`);
    else if (st.calcFollowRate <= 0.4)
      bits.push(`算了 ${st.myCalcs} 次，多半没照数走（算给人看的，算完还是照自己的性子来）`);
  }
  return bits.join('；');
}

// F5 记忆加权：一场里最肥的那个池（≥×4）——这种局不许被忘掉
export function bigPotBrief(st) {
  const top = (st.bigPots ?? []).reduce((a, b) => (!a || b.mult > a.mult ? b : a), null);
  if (!top) return '';
  return `第 ${top.round} 局那个 ×${top.mult} 的池：他${top.won ? `收走了 ${top.transfer}` : `赔了 ${top.transfer}`}`;
}

// 酒桌人格（§5.2，附:待定参数表）：按序优先匹配
export function persona(st) {
  if (st.myBlinds >= 2) return '盲侠';
  if (st.bluffRate > 0.5) return '赌徒';
  if (st.bluffRate < 0.15 && st.myBids >= 3) return '老实人';
  if (st.myChallenges === 0 && (st.roundsAlive ?? st.rounds) >= 3) return '缩头鹌鹑';
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
  if (st.myChallenges === 0 && (st.roundsAlive ?? st.rounds) >= 3)
    bits.push('一次都不敢开，我报什么你都得受着');
  if (st.myCalcs >= 2 && st.calcFollowRate >= 0.8)
    bits.push(`算了${st.myCalcs}次，次次照着数走——你在跟算盘打牌，我把谎放在"大概"里就够了`);
  else if (st.myCalcs >= 2 && st.calcFollowRate <= 0.4)
    bits.push(`算了${st.myCalcs}次，算完照样由着性子来——那算盘是拨给我看的`);
  if (bigPotBrief(st)) bits.push(bigPotBrief(st).replace('他', '你'));
  if (st.slowest && st.slowest.ms > 8000)
    bits.push(`第${st.slowest.round}局你停了半天才报${st.slowest.bid.count}个${st.slowest.bid.face}——不是在算数，是在攒胆子`);
  bits.push(won ? '这局算你的，账还长' : '骰子不会骗人，你会');
  return bits.slice(0, 3).join('。') + '。';
}
