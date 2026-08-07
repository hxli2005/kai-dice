// 本地档案（DESIGN §3.3 跨场记忆、§5.1 明牌档案）与 BYOK 配置（§3.4）。
// 全部 localStorage，无账号（§7.2）。key 不出设备。

const PROFILE_KEY = 'kai.profile.v1';
const BYOK_KEY = 'kai.byok.v1';

export function loadProfile(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(PROFILE_KEY)) ?? emptyProfile();
  } catch {
    return emptyProfile();
  }
}

function emptyProfile() {
  return { matches: 0, wins: 0, notes: [], stats: [] };
}

// 每场结束追加：老周的观察笔记（决策日志 note）＋本场统计摘要
export function appendMatch(profile, { won, stats, notes }, storage = localStorage) {
  profile.matches += 1;
  if (won) profile.wins += 1;
  profile.notes = [...profile.notes, ...notes.filter(Boolean)].slice(-30);
  profile.stats = [...profile.stats, { ...stats, won }].slice(-20);
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

// 给老周的档案摘要（buildPrompts 的 profile 参数；明牌，玩家随时可看同一份）
export function profileBrief(p) {
  if (!p.matches) return '';
  const last = p.stats.at(-1);
  const head = `交手${p.matches}场，客人赢${p.wins}场。`;
  const habits = last
    ? `上一场客人虚报率${Math.round(last.bluffRate * 100)}%，开牌${last.myChallenges}次命中${last.myChallengeHits}次，平均思考${(last.avgTimeMs / 1000).toFixed(1)}秒。`
    : '';
  const notes = p.notes.slice(-5).join('；');
  return head + habits + (notes ? `你的旧笔记：${notes}` : '');
}

// 跨场账本（TODO(Q12) 占位）：身家不重置——这回打剩多少，下回带多少上桌；可为负（赊账）
const LEDGER_KEY = 'kai.ledger.v1';
export function loadLedger(storage = localStorage) {
  try {
    const l = JSON.parse(storage.getItem(LEDGER_KEY));
    if (l && Number.isFinite(l.you) && Number.isFinite(l.opp)) return l;
  } catch {}
  return { you: 100, opp: 100 };
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
