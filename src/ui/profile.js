// 本地档案（DESIGN §3.3 双层制、§5.1 明牌档案）与 BYOK 配置（§3.4）。
// 全部 localStorage，无账号（§7.2）。key 不出设备。
//
// 档案双层（Q19）：
// - 客观层（全人设共享）：matches/wins/resets/stats——酒馆的公共账本，换人设不冷启动。
// - 主观层（minds[personaId] 私有）：notes 观察笔记＋hypotheses 规律假设——各记各的仇。

const PROFILE_KEY = 'kai.profile.v1';
const BYOK_KEY = 'kai.byok.v1';

function emptyMind() {
  return { notes: [], hypotheses: [] };
}

function emptyProfile() {
  return { matches: 0, wins: 0, resets: 0, stats: [], minds: {} };
}

// 旧结构（顶层 notes 数组）迁移：笔记归老李头主观层，无损
function migrate(p) {
  if (!p) return emptyProfile();
  if (!p.minds) p.minds = {};
  if (Array.isArray(p.notes)) {
    p.minds.laolitou = p.minds.laolitou ?? emptyMind();
    p.minds.laolitou.notes = [...p.notes, ...p.minds.laolitou.notes].slice(-30);
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
  return profile.minds[personaId];
}

export function saveProfile(profile, storage = localStorage) {
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// 每场结束追加：客观统计入共享层，观察笔记入该人设的主观层
export function appendMatch(profile, { won, stats, notes, personaId }, storage = localStorage) {
  profile.matches += 1;
  if (won) profile.wins += 1;
  const mind = mindOf(profile, personaId ?? 'laolitou');
  mind.notes = [...mind.notes, ...notes.filter(Boolean)].slice(-30);
  profile.stats = [...profile.stats, { ...stats, won }].slice(-20);
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

// 档案摘要（明牌，双方看同一份）。客观段全人设一致；笔记段取该人设自己的本子。
// withNotes=true 给 AI 的 prompt 用；档案页传 false（页面上笔记单独成列表）
export function profileBrief(p, personaId = 'laolitou', withNotes = true) {
  if (!p.matches) return '';
  const last = p.stats.at(-1);
  const resets = p.resets ?? 0;
  const head = `交手${p.matches}场，客人赢${p.wins}场${resets ? `，中途翻篇 ${resets} 次` : ''}。`;
  const habits = last
    ? `上一场客人虚报率${Math.round(last.bluffRate * 100)}%，开牌${last.myChallenges}次命中${last.myChallengeHits}次，平均思考${(last.avgTimeMs / 1000).toFixed(1)}秒。`
    : '';
  const mind = p.minds?.[personaId];
  const notes = withNotes && mind ? mind.notes.slice(-5).join('；') : '';
  return head + habits + (notes ? `你的旧笔记：${notes}` : '');
}

// Q12：翻篇免费，但记进档案——名声是唯一的利息
export function bumpResets(profile, storage = localStorage) {
  profile.resets = (profile.resets ?? 0) + 1;
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

// 跨场账本（Q12）：身家不重置——这回打剩多少，下回带多少上桌；可为负（赊账）。
// v2：按人设分户头（三人桌各记各的）；旧 {you,opp} 迁移为 opp→laolitou
const LEDGER_KEY = 'kai.ledger.v1';
export function loadLedger(storage = localStorage) {
  try {
    const l = JSON.parse(storage.getItem(LEDGER_KEY));
    if (l && Number.isFinite(l.you)) {
      if (Number.isFinite(l.opp) && !Number.isFinite(l.laolitou)) {
        return { you: l.you, laolitou: l.opp, afei: 100 };
      }
      return { you: l.you, laolitou: l.laolitou ?? 100, afei: l.afei ?? 100 };
    }
  } catch {}
  return { you: 100, laolitou: 100, afei: 100 };
}
export function saveLedger(l, storage = localStorage) {
  storage.setItem(LEDGER_KEY, JSON.stringify(l));
}

export function loadByok(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(BYOK_KEY));
  } catch {
    return null;
  }
}

// 只填 key（暗号）也可存——零配置走同域官方通道（§9.2）
export function saveByok(cfg, storage = localStorage) {
  if (!cfg || !cfg.apiKey) storage.removeItem(BYOK_KEY);
  else storage.setItem(BYOK_KEY, JSON.stringify(cfg));
}
