// 出口校验（DESIGN §3.5 事实转写禁令，Q46／Q47 修正；施工单 F0b）。
//
// 教义：**模型写意见，引擎写事实**。LLM 的输出是不可信输入——动作过 schema，事实过本模块，内心过留档。
// 校验对象按**命题对象**划分，不按语气：
//   - 可核验公共事实（报价史/骰数/局数/档案数字）→ 零容忍，说错就掐掉（明牌使谎言自毁）；
//   - 它自己的手牌与内心（判断、把握、意图）→ 自由表演区，一个字不管（"你停顿就是诈"是合法诱导）。
// 一句话边界：**可以骗玩家它怎么想，不能骗玩家发生过什么。**
//
// 判据统一为"这句话里的数，在发给它的事实里吗／在事件流里吗"——
// 所以档案数字（虚报率 43%）照引不误，凭空长出来的报价、局号、骰数一律掐。

const CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const NUM = '[0-9]+|[零一二两三四五六七八九十]{1,3}';

// 中文/阿拉伯数字 → 数（只需覆盖到二十几：场上最多十五颗骰）
export function toNum(s) {
  if (/^\d+$/.test(s)) return +s;
  if (s === '十') return 10;
  let m = s.match(/^十(.)$/);
  if (m) return 10 + (CN[m[1]] ?? NaN);
  m = s.match(/^(.)十(.)?$/);
  if (m) return (CN[m[1]] ?? NaN) * 10 + (m[2] ? (CN[m[2]] ?? NaN) : 0);
  return CN[s] ?? NaN;
}

const bidKey = (b) => `${b.count}个${b.face}`;

// 公共事实台账：从公开事件流复算（引擎才是事实的来源）
export function buildLedger(ob) {
  const bids = [];
  let start = null;
  const lost = {};
  for (const e of ob?.events ?? []) {
    if (e.type === 'roundStart' && !start) start = { ...e.diceCount };
    if (e.type === 'bid') bids.push({ count: e.count, face: e.face, player: e.player });
  }
  for (const q of ob?.players ?? []) lost[q.id] = (start?.[q.id] ?? q.diceCount) - q.diceCount;
  return { round: ob?.round ?? 0, bids, lost, seq: bids.map(bidKey) };
}

// 手牌语境：说自己手里有几个几＝牌手层，允许虚张（Q47 自由表演区）
const HAND_CTX = /(有|手里|拿着|攥着|捏着|这把是|就是)\s*$/;

// 抽出文本里所有"N 个 F"形态的报价引用（跳过手牌语境）
function bidRefs(text) {
  const re = new RegExp(`(${NUM})\\s*个\\s*([1-6]|[一二两三四五六])`, 'g');
  const out = [];
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    if (HAND_CTX.test(before)) continue;
    const count = toNum(m[1]);
    const face = toNum(m[2]);
    if (!Number.isInteger(count) || !(face >= 1 && face <= 6)) continue;
    const times = before.match(new RegExp(`(${NUM})\\s*[次回]\\s*$`));
    out.push({ key: `${count}个${face}`, raw: m[0], times: times ? toNum(times[1]) : null });
  }
  return out;
}

// 没拨算盘就说准数＝编（Q45）。判据同上：这个数在发给它的事实里吗。
// 「三成」这类中文说法是本桌概率的成语，未算即视为编；粗话（基本稳/五五开/悬/纯扯）永远免检。
export function hasFakePrecision(text, allowedFrom = '') {
  const s = String(text ?? '');
  if (/[一二两三四五六七八九]\s*成(?!立|不|功|交|群)/.test(s) || /百分之/.test(s)) return true;
  return [...s.matchAll(/(\d+)\s*[%％]/g)].some(
    (m) => !new RegExp(`${m[1]}\\s*[%％]`).test(String(allowedFrom)),
  );
}

// 出口校验主函数：返回违规清单（空数组＝可以出口）。
// ledger 缺省为空台账（如开场白：此时桌上还没有事实，一切引用都得来自 allowedFrom）。
// allowedFrom＝发给它的事实全文：出现在里面的数字算"给过的真数据"，免检。
export function checkFacts(text, ledger = { round: 0, bids: [], lost: {}, seq: [] }, opts = {}) {
  const { ownBid = null, allowedFrom = '', calced = true } = opts;
  const s = String(text ?? '');
  if (!s) return [];
  const bad = [];
  const allowed = String(allowedFrom);
  const own = ownBid ? bidKey(ownBid) : null;
  const seq = [...ledger.seq, ...(own ? [own] : [])];

  // ① 报价引用：只许引用真发生过的价（或它此刻正要报的那口）
  const refs = bidRefs(s);
  for (const r of refs) {
    if (r.key === own || ledger.seq.includes(r.key)) continue;
    if (allowed.includes(r.key) || allowed.includes(r.raw)) continue;
    bad.push(`bid-not-in-history:${r.key}`);
  }
  // ② 次数：说"两次九个六"就得真有两次
  for (const r of refs) {
    if (r.times == null) continue;
    const n = ledger.seq.filter((k) => k === r.key).length;
    if (n !== r.times) bad.push(`bid-count:${r.key}×${r.times}≠${n}`);
  }
  // ③ 顺序：多口价一起说，必须是真实序列的子序列（转写整段报价史的高发区）
  const keys = refs.map((r) => r.key).filter((k) => seq.includes(k));
  if (keys.length >= 2) {
    let i = 0;
    for (const k of keys) {
      const at = seq.indexOf(k, i);
      if (at < 0) {
        bad.push(`bid-order:${keys.join('→')}`);
        break;
      }
      i = at + 1;
    }
  }
  // ④ 掉骰：一局只掉一颗（掐对才回一颗）——"掉两颗"除非说的是累计
  const cum = new Set([0, 1, ...Object.values(ledger.lost)]);
  for (const m of s.matchAll(new RegExp(`掉(?:了)?\\s*(${NUM})\\s*[颗个]`, 'g'))) {
    const n = toNum(m[1]);
    if (Number.isInteger(n) && !cum.has(n) && !allowed.includes(m[0])) bad.push(`dice-loss:${n}`);
  }
  // ⑤ 局号：不许引用还没发生的局
  for (const m of s.matchAll(new RegExp(`第\\s*(${NUM})\\s*局`, 'g'))) {
    const n = toNum(m[1]);
    if (Number.isInteger(n) && ledger.round > 0 && n > ledger.round && !allowed.includes(m[0]))
      bad.push(`round:${n}>${ledger.round}`);
  }
  // ⑥ 没算过不许报准数（Q45）
  if (!calced && hasFakePrecision(s, allowed)) bad.push('fake-precision');
  return bad;
}
