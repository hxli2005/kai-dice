// 本地档案（DESIGN §3.3 双层制、§5.1 明牌档案）与 BYOK 配置（§3.4）。
// 全部 localStorage，无账号（§7.2）。key 不出设备。

import { PERSONAS } from '../ai/personas.js';
//
// 档案双层（Q19）：
// - 客观层（全人设共享）：matches/wins/resets/stats——酒馆的公共账本，换人设不冷启动。
// - 主观层（minds[personaId] 私有）：notes 观察笔记＋hypotheses 规律假设——各记各的仇。

const PROFILE_KEY = 'kai.profile.v1';
const BYOK_KEY = 'kai.byok.v1';

function emptyMind() {
  return { notes: [], hypotheses: [], stats: [], record: { plays: 0, beat: 0, wins: 0 } };
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
  const m = profile.minds[personaId];
  m.stats ??= [];
  m.record ??= { plays: 0, beat: 0, wins: 0 };
  m.record.wins ??= 0; // 旧档补位：场胜数（榜的胜率列）
  return m;
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
// v3：{you, personas:{id:n}} 按人设开户，人设可增不改结构；兼容旧平铺结构迁移。
// v4（TODO(Q25) 数值占位）：AI 是独立玩家，各有初始身家 bankroll（比客人厚——客人的钱从他们身上赢）；
// bankrollApplied 记录每个户头按哪个基准入的账，基准变了给存量户头补差额（你已赢走的净额不动）——自愈式迁移。
const LEDGER_KEY = 'kai.ledger.v1';
export function loadLedger(storage = localStorage) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(LEDGER_KEY));
  } catch {}
  let l = { you: 100, personas: {}, bankrollApplied: {} };
  let had = false;
  if (raw && Number.isFinite(raw.you)) {
    had = true;
    if (raw.personas) {
      l = { you: raw.you, personas: { ...raw.personas }, bankrollApplied: { ...(raw.bankrollApplied ?? {}) } };
    } else {
      const personas = {};
      if (Number.isFinite(raw.laolitou)) personas.laolitou = raw.laolitou;
      else if (Number.isFinite(raw.opp)) personas.laolitou = raw.opp;
      if (Number.isFinite(raw.afei)) personas.afei = raw.afei;
      l = { you: raw.you, personas, bankrollApplied: {} };
    }
  }
  let shifted = false;
  for (const [id, per] of Object.entries(PERSONAS)) {
    const bank = per.bankroll ?? 100;
    const base = l.bankrollApplied[id] ?? 100;
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
export function balanceOf(ledger, personaId) {
  // 客席（model:xxx）默认身家 300——TODO(Q25/Q28④) 占位，与官方人设一并裁
  return (
    ledger.personas[personaId] ??
    PERSONAS[personaId]?.bankroll ??
    (personaId.startsWith('model:') ? 300 : 100)
  );
}
export function saveLedger(l, storage = localStorage) {
  storage.setItem(LEDGER_KEY, JSON.stringify(l));
}

// 钥匙分流（Q28 用户裁决）：暗号（官方通道，只喂官方人设）与客席钥匙（BYOK，只喂客席模型）分开存。
// 旧 kai.byok.v1 迁移：只填 key＝暗号；三格全填＝客席钥匙。
const PASS_KEY = 'kai.pass.v1';
const GUEST_KEY = 'kai.guest.v1';
function migrateByok(storage) {
  try {
    const legacy = JSON.parse(storage.getItem(BYOK_KEY));
    if (legacy?.apiKey) {
      if (legacy.baseUrl) storage.setItem(GUEST_KEY, JSON.stringify(legacy));
      else storage.setItem(PASS_KEY, legacy.apiKey);
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
