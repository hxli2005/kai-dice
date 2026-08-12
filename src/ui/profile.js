// 本地档案（DESIGN §3.3 双层制、§5.1 明牌档案）与 BYOK 配置（§3.4）。
// 全部 localStorage，无账号（§7.2）。key 不出设备。

import { PERSONAS, HOSTED_MODEL } from '../ai/personas.js';
import { bigPotBrief } from './report.js';
//
// 档案双层（Q19）：
// - 客观层（全席共享）：matches/wins/resets/stats——公共账本，换对手不冷启动。
// - 主观层（minds[型号id] 私有）：notes 观察笔记＋hypotheses 规律假设——各型号各记各的。

const PROFILE_KEY = 'kai.profile.v1';
const BYOK_KEY = 'kai.byok.v1';

function emptyMind() {
  // baits/dead/peeks/pokes：诈的留档、假设的尸体、玩家翻本子的次数（反身彩蛋）、被戳后的三岔口（F9）
  return {
    notes: [], hypotheses: [], dead: [], baits: [], peeks: 0,
    pokes: { count: 0, hold: 0, fold: 0, ignore: 0 },
    stats: [], record: { plays: 0, beat: 0, wins: 0 },
  };
}

function emptyProfile() {
  return { matches: 0, wins: 0, resets: 0, stats: [], minds: {} };
}

// 旧机位 → 型号户头（Q87 改名、Q89 折成型号）。D4 规矩：改存储键必须带迁移方案。
// **这张表永久保留**，删了就是让老存档凭空少几本账。
//
// 注意这不是改名是**合并**：老李头/一号机与阿飞/二号机钉的是同一个型号，
// 按 DESIGN §1.2「户头按型号记」本来就该是一本账——以前分着记才是 bug。
export const LEGACY_SEAT_MODEL = {
  laolitou: 'model:deepseek-v4-flash',
  afei: 'model:deepseek-v4-flash',
  xiansheng: 'model:deepseek-v4-pro',
  seat1: 'model:deepseek-v4-flash',
  seat2: 'model:deepseek-v4-flash',
  seat3: 'model:deepseek-v4-pro',
};

// 数值账：老机位的余额是"本金＋净转移"，折进型号户头时要**先减本金再相加**——
// 否则两本账并一本会把本金也加两遍。折完把新户头的基准钉成 0（Q88），免得自愈再补一次。
export function foldLegacyLedger(personas, applied = {}) {
  if (!personas) return personas;
  for (const [old, next] of Object.entries(LEGACY_SEAT_MODEL)) {
    if (!Number.isFinite(personas[old])) {
      delete personas[old];
      delete applied[old];
      continue;
    }
    const basis = applied[old] ?? 100; // 老档没记基准时的隐含值
    personas[next] = (personas[next] ?? 0) + personas[old] - basis;
    applied[next] = 0;
    delete personas[old];
    delete applied[old];
  }
  return personas;
}

// 主观档案：合并要**逐字段并**（笔记接起来、假设按文本去重取证据多的那条、计数相加）
export function foldLegacyMinds(minds) {
  if (!minds) return minds;
  for (const [old, next] of Object.entries(LEGACY_SEAT_MODEL)) {
    const src = minds[old];
    if (!src) continue;
    delete minds[old];
    const dst = (minds[next] ??= emptyMind());
    dst.notes = [...(dst.notes ?? []), ...(src.notes ?? [])].slice(-30);
    const byText = new Map((dst.hypotheses ?? []).map((h) => [h.text, h]));
    for (const h of src.hypotheses ?? [])
      if (!byText.has(h.text) || (byText.get(h.text).hits ?? 0) < (h.hits ?? 0)) byText.set(h.text, h);
    dst.hypotheses = [...byText.values()].slice(-8);
    dst.dead = [...(dst.dead ?? []), ...(src.dead ?? [])].slice(-12);
    dst.baits = [...(dst.baits ?? []), ...(src.baits ?? [])].slice(-8);
    dst.stats = [...(dst.stats ?? []), ...(src.stats ?? [])].slice(-20);
    dst.peeks = (dst.peeks ?? 0) + (src.peeks ?? 0);
    for (const k of ['count', 'hold', 'fold', 'ignore'])
      dst.pokes[k] = (dst.pokes[k] ?? 0) + (src.pokes?.[k] ?? 0);
    for (const k of ['plays', 'beat', 'wins'])
      dst.record[k] = (dst.record[k] ?? 0) + (src.record?.[k] ?? 0);
  }
  return minds;
}

// 旧结构迁移：① 顶层 notes 数组归托管型号的主观层；② 旧机位折成型号户头。均无损。
function migrate(p) {
  if (!p) return emptyProfile();
  if (!p.minds) p.minds = {};
  foldLegacyMinds(p.minds);
  if (Array.isArray(p.notes)) {
    const k = 'model:deepseek-v4-flash';
    p.minds[k] ??= emptyMind();
    p.minds[k].notes = [...p.notes, ...p.minds[k].notes].slice(-30);
    delete p.notes;
  }
  p.resets ??= 0;
  p.stats ??= [];
  return p;
}

export function loadProfile(storage = localStorage) {
  try {
    return migrate(JSON.parse(storage.getItem(PROFILE_KEY)));
  } catch {
    return emptyProfile();
  }
}

export function mindOf(profile, personaId) {
  profile.minds[personaId] ??= emptyMind();
  const m = profile.minds[personaId];
  m.stats ??= [];
  m.record ??= { plays: 0, beat: 0, wins: 0 };
  m.record.wins ??= 0; // 旧档补位：场胜数（榜的胜率列）
  m.dead ??= []; // 旧档补位（F8）：假设的坟场
  m.baits ??= []; // 旧档补位（F7）：诈的留档
  m.peeks ??= 0; // 旧档补位（F8）：他知道你翻过几回本子
  m.pokes ??= { count: 0, hold: 0, fold: 0, ignore: 0 }; // 旧档补位（F9）：戳他之后他怎么接
  return m;
}

// F8 假设的一生：立案（since）→ 证据累积 → 反例 → 死亡（消失即放弃，留尸体）。
// 档案是活文档不是快照——被自己撤下的假设也是学问（"我曾以为你只在斋局说真话"）。
export function mergeHypotheses(mind, next, matchNo) {
  if (!Array.isArray(next)) return;
  const prev = mind.hypotheses ?? [];
  const bySince = new Map(prev.map((h) => [h.text, h.since]));
  mind.hypotheses = next.map((h) => ({ ...h, since: bySince.get(h.text) ?? matchNo }));
  const alive = new Set(mind.hypotheses.map((h) => h.text));
  const dead = prev.filter((h) => !alive.has(h.text)).map((h) => ({ ...h, died: matchNo }));
  mind.dead = [...(mind.dead ?? []), ...dead].slice(-12);
}

// F7 揭诈时刻：把本场"说一套想一套"的时刻留下来，供复盘室与下场开场引用。
// 只收留了档的（speechMode=bait 且 belief 有内容）——没留档的不算诈，算故障（Q47）。
export function recordBaits(mind, logs, matchNo) {
  const fresh = (logs ?? [])
    .filter((l) => l.speechMode === 'bait' && l.say && l.belief)
    .map((l) => ({ round: l.round, say: l.say, belief: l.belief, matchNo }));
  if (fresh.length) mind.baits = [...(mind.baits ?? []), ...fresh].slice(-8);
  return fresh.length;
}

export function saveProfile(profile, storage = localStorage) {
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// 每场结束追加：客观统计入共享层，观察笔记入该型号的主观层
export function appendMatch(profile, { won, stats, notes, personaId }, storage = localStorage) {
  profile.matches += 1;
  if (won) profile.wins += 1;
  const mind = mindOf(profile, personaId ?? `model:${HOSTED_MODEL}`);
  mind.notes = [...mind.notes, ...notes.filter(Boolean)].slice(-30);
  profile.stats = [...profile.stats, { ...stats, won }].slice(-20);
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

// 档案摘要（明牌，双方看同一份）。客观段全席一致；笔记段取该型号自己的本子。
// withNotes=true 给 AI 的 prompt 用；档案页传 false（页面上笔记单独成列表）
export function profileBrief(p, personaId = `model:${HOSTED_MODEL}`, withNotes = true) {
  if (!p.matches) return '';
  const last = p.stats.at(-1);
  const resets = p.resets ?? 0;
  const head = `交手${p.matches}场，客人赢${p.wins}场${resets ? `，中途翻篇 ${resets} 次` : ''}。`;
  const habits = last
    ? `上一场客人虚报率${Math.round(last.bluffRate * 100)}%（其中明知站不住 ${last.myKnowingBluffs ?? 0} 口、只是估悬了 ${last.myThinBluffs ?? 0} 口），开牌${last.myChallenges}次命中${last.myChallengeHits}次，平均思考${(last.avgTimeMs / 1000).toFixed(1)}秒。`
    : '';
  // F6 算盘依赖度：他信数还是信人——AI 的剥削通道（"你只信档位，我把谎放在'大概'里"）
  const calc =
    last && last.myCalcs != null
      ? last.myCalcs === 0
        ? '上一场他一次算盘都没拨（要么心里有数，要么根本不算）。'
        : `上一场他拨了${last.myCalcs}次算盘${
            last.calcFollowRate != null ? `，其中${Math.round(last.calcFollowRate * 100)}%照着数走` : ''
          }。`
      : '';
  const bigPot = last && bigPotBrief(last) ? `上一场最肥的一池：${bigPotBrief(last)}。` : ''; // F5 记忆加权
  const mind = p.minds?.[personaId];
  const notes = withNotes && mind ? mind.notes.slice(-5).join('；') : '';
  return head + habits + calc + bigPot + (notes ? `你的旧笔记：${notes}` : '');
}

// 决策提示词专用的分桶档案：程序统计与模型自记分开，不再拼成一段无来源文本。
// profileBrief 仍供页面和其他人话场景使用；这个函数只负责数据契约。
export function profilePromptData(p, personaId = `model:${HOSTED_MODEL}`) {
  const mind = p.minds?.[personaId];
  const verified = [];
  if (p.matches) {
    verified.push({
      scope: 'career',
      matches: p.matches,
      wins: p.wins,
      resets: p.resets ?? 0,
    });
    const last = p.stats.at(-1);
    if (last) {
      verified.push({
        scope: 'lastMatch',
        bluffRate: last.bluffRate,
        // G7：两笔分开的账。明知＝自见概率不足 15% 还报（他看过骰）；
        // 估悬＝15%–50%，读得出概率读不出居心，别当成同一件事
        knowingBluffs: last.myKnowingBluffs ?? null,
        thinBluffs: last.myThinBluffs ?? null,
        challenges: last.myChallenges,
        challengeHits: last.myChallengeHits,
        calcs: last.myCalcs ?? null,
        calcFollowRate: last.calcFollowRate ?? null,
        bigPot: bigPotBrief(last) || null,
      });
    }
  }
  return {
    verified,
    subjective: {
      notes: [...(mind?.notes ?? [])].slice(-5),
      hypotheses: structuredClone(mind?.hypotheses ?? []),
    },
  };
}

// 次场开场白的事实素材（§5.3-bis／Q14 硬节拍）：全部裁判层中性口径，主家 LLM 亲口引用。
// 抽成纯函数是为了可测（Q43 编码侧自查项：这条节拍到底有没有真落地）。
export function openerFacts(profile, ledger) {
  const facts = [];
  const last = profile.stats.at(-1);
  facts.push(profile.matches ? `这是他第 ${profile.matches + 1} 场` : '客人是生面孔，第一次上桌');
  if (ledger.you <= 0) facts.push(`他账上欠着 ${-ledger.you}`);
  if ((profile.resets ?? 0) > 0) facts.push(`他把账翻篇过 ${profile.resets} 次`);
  if (!last) return facts;
  if (last.myChallenges > 0) facts.push(`上一场他开了 ${last.myChallenges} 次牌，中了 ${last.myChallengeHits} 次`);
  // G7：开场白是裁判层，只许说"没站住"这件已发生的事；
  // 「明知」（自见概率不足 15%）才是他自己看过骰还报的，那一句才配点名
  if (last.myKnowingBluffs >= 2) facts.push(`上一场他有 ${last.myKnowingBluffs} 口价是看过骰、明知站不住还报的`);
  else if (last.bluffRate > 0.5) facts.push('上一场他一半以上的报价没站住（多半是估错，不是有意的）');
  if (last.timesChallenged >= 2) facts.push(`上一场他被掀了 ${last.timesChallenged} 回`);
  if (last.myBlinds >= 2) facts.push(`上一场他盲了 ${last.myBlinds} 把`);
  if (last.myCalcs === 0) facts.push('上一场他一次算盘都没拨');
  else if (last.myCalcs >= 2) facts.push(`上一场他拨了 ${last.myCalcs} 次算盘`);
  if (last.blindBids >= 2) facts.push(`上一场他有 ${last.blindBids} 口价是没看骰就报的`); // F0c
  if (bigPotBrief(last)) facts.push(`上一场${bigPotBrief(last)}`); // F5：×4 以上的池必须被记住
  if (last.slowest && last.slowest.ms > 8000)
    facts.push(`上一场第 ${last.slowest.round} 局他停了半天才报 ${last.slowest.bid.count} 个 ${last.slowest.bid.face}`);
  facts.push(last.won ? '上一场是他赢了' : '上一场他输了');
  return facts;
}

// Q12：翻篇免费，但记进档案——名声是唯一的利息
export function bumpResets(profile, storage = localStorage) {
  profile.resets = (profile.resets ?? 0) + 1;
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

// 跨场账本（Q12）：身家不重置——这回打剩多少，下回带多少上桌；可为负（赊账）。
// v3：{you, personas:{id:n}} 按机位开户，机位可增不改结构；兼容旧平铺结构迁移。
// v5（Q88，2026-08-10）：**所有人从 0 起**——身家就是净转移，榜上不预置任何数字。
// bankrollApplied 记录每个户头按哪个基准入的账，基准变了给存量户头补差额（你已赢走的净额不动）——
// 自愈式迁移：老档里 770（基准 800）会自动变成 −30，也就是"你从它身上赢走 30"，一分不差。
const LEDGER_KEY = 'kai.ledger.v1';
export function loadLedger(storage = localStorage) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(LEDGER_KEY));
  } catch {}
  let l = { you: 0, personas: {}, bankrollApplied: {} };
  let had = false;
  if (raw && Number.isFinite(raw.you)) {
    had = true;
    if (raw.personas) {
      l = { you: raw.you, personas: { ...raw.personas }, bankrollApplied: { ...(raw.bankrollApplied ?? {}) } };
    } else {
      // 更早的平铺结构（v2）：键就是旧机位名
      const personas = {};
      if (Number.isFinite(raw.laolitou)) personas.laolitou = raw.laolitou;
      else if (Number.isFinite(raw.opp)) personas.laolitou = raw.opp;
      if (Number.isFinite(raw.afei)) personas.afei = raw.afei;
      l = { you: raw.you, personas, bankrollApplied: {} };
    }
    // Q87／Q89 迁移：旧机位的身家**合并**进型号户头（同型号本就该一本账）；
    // 入账基准直接丢掉——新基准一律 0，留着反而会被当成"基准变了"再补一次。
    foldLegacyLedger(l.personas, l.bankrollApplied);
  }
  let shifted = false;
  // 玩家也走同一套自愈：老档的 you 是从 100 起的，基准归 0 后要减掉那 100
  const youBase = l.bankrollApplied.__you ?? (had ? 100 : 0);
  if (youBase !== 0) {
    l.you -= youBase;
    l.bankrollApplied.__you = 0;
    shifted = true;
  } else if (l.bankrollApplied.__you !== 0) {
    l.bankrollApplied.__you = 0;
    shifted = true;
  }
  for (const [id, per] of Object.entries(PERSONAS)) {
    const bank = per.bankroll ?? 0;
    const base = l.bankrollApplied[id] ?? 100; // 老档的隐含基准是 100
    if (l.personas[id] != null && base !== bank) {
      l.personas[id] += bank - base;
      shifted = true;
    }
    if (l.bankrollApplied[id] !== bank) {
      l.bankrollApplied[id] = bank;
      shifted = true;
    }
  }
  if (had && shifted) storage.setItem(LEDGER_KEY, JSON.stringify(l)); // 立即落盘防重复补差
  return l;
}
// Q88：没打过就是 0——身家是净转移，不是发下来的本金
export function balanceOf(ledger, personaId) {
  return ledger.personas[personaId] ?? PERSONAS[personaId]?.bankroll ?? 0;
}
export function saveLedger(l, storage = localStorage) {
  storage.setItem(LEDGER_KEY, JSON.stringify(l));
}

// 钥匙分流（Q28 用户裁决）：暗号（官方通道，只喂官方机位）与客席钥匙（BYOK，只喂客席模型）分开存。
// 旧 kai.byok.v1 迁移：只填 key＝暗号；三格全填＝客席钥匙。
const PASS_KEY = 'kai.pass.v1';
const GUEST_KEY = 'kai.guest.v1';
function migrateByok(storage) {
  try {
    const legacy = JSON.parse(storage.getItem(BYOK_KEY));
    if (legacy?.apiKey) {
      if (legacy.baseUrl) {
        storage.setItem(GUEST_KEY, JSON.stringify(legacy));
        storage.setItem('kai.note.v1', 'byok-moved'); // 大厅一次性提示：官方人物从此只认暗号
      } else storage.setItem(PASS_KEY, legacy.apiKey);
    }
    storage.removeItem(BYOK_KEY);
  } catch {}
}
export function loadPass(storage = localStorage) {
  migrateByok(storage);
  return storage.getItem(PASS_KEY) ?? '';
}
export function savePass(pass, storage = localStorage) {
  if (pass) storage.setItem(PASS_KEY, pass);
  else storage.removeItem(PASS_KEY);
}
export function loadGuest(storage = localStorage) {
  migrateByok(storage);
  try {
    return JSON.parse(storage.getItem(GUEST_KEY));
  } catch {
    return null;
  }
}
export function saveGuest(cfg, storage = localStorage) {
  if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) storage.removeItem(GUEST_KEY);
  else storage.setItem(GUEST_KEY, JSON.stringify(cfg));
}
