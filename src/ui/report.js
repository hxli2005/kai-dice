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
    // F0c 蒙报类目（Q46）：没看骰就报的价单列——它和"虚报"不是一回事，
    // 混在一起会把"故意闭着眼报到天上"算成老实人（用户实测 bug）
    seenBids: 0, // 看过骰之后报的手数（虚报率的分母）
    blindBids: 0, // 未看骰就报的手数
    blindBluffs: 0, // 其中零信息概率也 <50% 的（明知没底还往上抬）
    blindWildest: null, // {round, bid, p} 蒙报极限度：最离谱的那一口
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
  let myCount = 0; // 我这一局有几颗骰（蒙报的零信息概率要用全场骰数）
  let seenNow = false; // 报这一口时我到底看没看骰——按事件时序判，不按"这局最后有没有看"
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
      seenNow = false;
      myFirstBidThisRound = true;
      myCount = e.diceCount?.[you] ?? 0;
      oppCount = Object.entries(e.diceCount)
        .filter(([k]) => k !== you)
        .reduce((a, [, v]) => a + v, 0);
    }
    if (e.type === 'peek' && e.player === you) seenNow = true;
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
        // 蒙报单列（F0c）：没看骰的报价按"零信息"重算——全场骰子都未知，
        // 这样"闭着眼报十个六"才会显出它的离谱，而不是因为算不出概率被当成没说谎
        const mine = seenNow ? myDiceByRound[round] : null;
        if (!mine) {
          const bp = probBidTrue({ count: e.count, face: e.face }, [], myCount + oppCount, zhai);
          s.blindBids++;
          if (bp < 0.5) s.blindBluffs++;
          if (!s.blindWildest || bp < s.blindWildest.p)
            s.blindWildest = { round, bid: { count: e.count, face: e.face }, p: bp };
        } else s.seenBids++;
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
    // 虚报率的分母改为"看过骰的报价"（F0c）：没看骰的手不进这笔账——
    // 旧口径下故意不看骰的人虚报率恒为 0，档案会把他写成老实人
    bluffRate: div(s.myBluffs, s.seenBids),
    blindBidRate: div(s.blindBids, s.myBids),
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
  // F0c 蒙报：连骰都不看就往上抬，是最响的一种信号
  if (st.blindBids >= 2)
    bits.push(
      `有 ${st.blindBids} 口价是没看骰就报的${
        st.blindWildest ? `（最狠一口：第 ${st.blindWildest.round} 局 ${st.blindWildest.bid.count} 个 ${st.blindWildest.bid.face}）` : ''
      }`,
    );
  // F6 算盘依赖度：他信数还是信人——这是 Q45 新开的读心通道
  if (st.myCalcs >= 2 && st.calcFollowRate != null) {
    if (st.calcFollowRate >= 0.8)
      bits.push(`算了 ${st.myCalcs} 次，几乎次次照着数走（他在跟算盘打牌，不是跟人）`);
    else if (st.calcFollowRate <= 0.4)
      bits.push(`算了 ${st.myCalcs} 次，多半没照数走（算给人看的，算完还是照自己的性子来）`);
  }
  return bits.join('；');
}

// ---------- F8 复盘室「他的小本子」（Q48）：双轨时间轴的数据层 ----------
// 左轨＝桌面公开史实（引擎盖章），右轨＝当时的内心留档（belief/bait/算的私有结果）。
// 硬法：**禁事后供词**——右轨只许来自决策日志，散场后不许再问模型"你当时怎么想"。
// 纯函数，零调用：UI 只负责画，账在这里对。

const ACT_EVENTS = new Set(['peek', 'calc', 'bid', 'declare', 'challenge', 'modAction']);
const DECL_CN = { zhai: '斋', blind: '盲', raise: '抬' };

// 决策日志与事件按时序 1:1 配对（同一席位的第 n 个动作 ↔ 第 n 条日志）
function logQueues(logsBySeat) {
  const q = {};
  for (const [seat, logs] of Object.entries(logsBySeat ?? {})) q[seat] = [...(logs ?? [])];
  return q;
}

// 算的私有结果：从当时喂给它的事实里取回它手上真有的那个数（不重算、不编）
const calcPOf = (log) => log?.facts?.match(/为真的概率 (\d+%)/)?.[1] ?? null;

export function reviewTracks(events, { logsBySeat = {}, nameOf = (s) => s, you = 'A' } = {}) {
  const queues = logQueues(logsBySeat);
  const rounds = [];
  let cur = null;
  const push = (row) => cur?.rows.push(row);
  for (const e of events) {
    if (e.type === 'roundStart') {
      cur = { round: e.round, rows: [], outcome: null, mult: 1, spotlight: false };
      rounds.push(cur);
      continue;
    }
    if (!cur) continue;
    if (ACT_EVENTS.has(e.type)) {
      const mine = e.player === you;
      const log = mine ? null : queues[e.player]?.shift();
      const bait = log?.speechMode === 'bait';
      if (bait || e.type === 'challenge') cur.spotlight = true;
      push({
        seat: e.player,
        who: nameOf(e.player),
        kind: e.type,
        text: publicText(e, nameOf),
        inner: mine
          ? null
          : {
              say: log?.say ?? '',
              belief: log?.belief ?? '',
              note: log?.note ?? '',
              bait,
              calcP: e.type === 'calc' ? null : calcPOf(log),
              silent: !!log?.silentFallback,
              auto: !!log?.auto, // 不问模型的固定动作（扳不动盲闸的座位先掀盅）
              reaction: log?.reaction ?? null, // F9：被戳之后他怎么接
            },
      });
      continue;
    }
    if (e.type === 'reveal') {
      cur.reveal = {
        bid: e.bid,
        challenger: e.challenger,
        actual: e.actual,
        stands: e.stands,
        calza: !!e.calza,
        exact: !!e.exact,
        dice: e.dice,
      };
    }
    if (e.type === 'roundEnd') {
      cur.mult = e.mult ?? 1;
      cur.outcome = { loser: e.loser, winner: e.winner, transfer: e.transfer, mult: e.mult ?? 1 };
      // 戏眼（复用 F5 加权）：开牌、诈、高倍池、玩家被打脸——默认只展开这些
      if ((e.mult ?? 1) >= 4 || e.loser === you) cur.spotlight = true;
    }
  }
  return rounds;
}

function publicText(e, nameOf) {
  const who = nameOf(e.player);
  switch (e.type) {
    case 'peek':
      return `${who}掀盅看骰`;
    case 'calc':
      return `${who}当众拨算盘`;
    case 'bid':
      return `${who}报 ${e.count} 个 ${e.face}`;
    case 'declare':
      return `${who}宣言「${DECL_CN[e.declaration] ?? e.declaration}」`;
    case 'challenge':
      return `${who}拍桌开牌`;
    case 'modAction':
      return `${who}用了词条${e.face ? ` · 亮 ${e.face}` : ''}`;
    default:
      return who;
  }
}

// F5 记忆加权：一场里最肥的那个池（≥×4）——这种局不许被忘掉
export function bigPotBrief(st) {
  const top = (st.bigPots ?? []).reduce((a, b) => (!a || b.mult > a.mult ? b : a), null);
  if (!top) return '';
  return `第 ${top.round} 局那个 ×${top.mult} 的池：他${top.won ? `收走了 ${top.transfer}` : `赔了 ${top.transfer}`}`;
}

// 酒桌人格（§5.2，附:待定参数表）：按序优先匹配
// F0c：宣言「盲」与"事实上没看骰"是两件事——前者是盲侠（下了注的），后者是蒙眼虎（连注都不下就敢喊）。
// 「老实人」必须以看过骰为前提：闭着眼报到天上，不叫老实。
export function persona(st) {
  if (st.myBlinds >= 2) return '盲侠';
  if (st.blindBids >= 3 && st.blindBidRate > 0.5) return '蒙眼虎';
  if (st.bluffRate > 0.5) return '赌徒';
  if (st.bluffRate < 0.15 && (st.seenBids ?? st.myBids) >= 3) return '老实人';
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
  if (st.blindBids >= 2 && st.blindWildest)
    bits.push(
      `你有${st.blindBids}口价是闭着眼报的——第${st.blindWildest.round}局那个${st.blindWildest.bid.count}个${st.blindWildest.bid.face}，你自己都不知道手里是什么`,
    );
  if (st.bluffRate > 0.5) bits.push(`看过骰的十句里${Math.round(st.bluffRate * 10)}句是空的，胆子不小`);
  else if (st.bluffRate < 0.15 && (st.seenBids ?? st.myBids) >= 3)
    bits.push('你看过骰之后几乎不说谎，所以你一抬价我就信');
  if (st.myChallenges > 0 && st.hitRate < 0.34)
    bits.push(`你开我${st.myChallenges}次错${st.myChallenges - st.myChallengeHits}次，手比脑子快`);
  if (st.myChallenges === 0 && (st.roundsAlive ?? st.rounds) >= 3)
    bits.push('一次都不敢开，我报什么你都得受着');
  // 判词只许说有数据撑的话（F0b 同一条纪律）：没判定过的手不许被说成"照着数走"
  if (st.myCalcs >= 2 && st.calcFollowRate != null && st.calcFollowRate >= 0.8)
    bits.push(`算了${st.myCalcs}次，次次照着数走——你在跟算盘打牌，我把谎放在"大概"里就够了`);
  else if (st.myCalcs >= 2 && st.calcFollowRate != null && st.calcFollowRate <= 0.4)
    bits.push(`算了${st.myCalcs}次，算完照样由着性子来——那算盘是拨给我看的`);
  if (bigPotBrief(st)) bits.push(bigPotBrief(st).replace('他', '你'));
  if (st.slowest && st.slowest.ms > 8000)
    bits.push(`第${st.slowest.round}局你停了半天才报${st.slowest.bid.count}个${st.slowest.bid.face}——不是在算数，是在攒胆子`);
  bits.push(won ? '这局算你的，账还长' : '骰子不会骗人，你会');
  return bits.slice(0, 3).join('。') + '。';
}
