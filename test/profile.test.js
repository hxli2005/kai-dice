// 档案双层制（§3.3 Q19，T2 验收）：客观层共享、主观层私有、旧档迁移无损。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, appendMatch, profileBrief, mindOf } from '../src/ui/profile.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

const STATS = { bluffRate: 0.4, myChallenges: 2, myChallengeHits: 1, timesChallenged: 1, avgTimeMs: 5000, myBids: 5, myBlinds: 0, rounds: 6 };

test('旧档迁移：顶层 notes 无损归入老李头主观层', () => {
  const s = memStorage({
    'kai.profile.v1': JSON.stringify({ matches: 3, wins: 1, notes: ['他手抖', '秒点真话'], stats: [STATS] }),
  });
  const p = loadProfile(s);
  assert.equal(p.matches, 3);
  assert.equal(p.notes, undefined);
  assert.deepEqual(p.minds.laolitou.notes, ['他手抖', '秒点真话']);
  assert.deepEqual(p.minds.laolitou.hypotheses, []);
});

test('双层：客观统计全人设共享，笔记各记各的', () => {
  const s = memStorage();
  let p = loadProfile(s);
  p = appendMatch(p, { won: true, stats: STATS, notes: ['李记：爱虚报'], personaId: 'laolitou' }, s);
  p = appendMatch(p, { won: false, stats: STATS, notes: ['飞记：这人稳'], personaId: 'afei' }, s);
  // 客观层：两场都计入，谁看都一样
  assert.equal(p.matches, 2);
  assert.equal(p.stats.length, 2);
  const headLi = profileBrief(p, 'laolitou', false);
  const headFei = profileBrief(p, 'afei', false);
  assert.equal(headLi, headFei, '客观段必须全人设一致');
  // 主观层：笔记互不可见
  assert.match(profileBrief(p, 'laolitou'), /李记：爱虚报/);
  assert.doesNotMatch(profileBrief(p, 'laolitou'), /飞记/);
  assert.match(profileBrief(p, 'afei'), /飞记：这人稳/);
  assert.doesNotMatch(profileBrief(p, 'afei'), /李记/);
  // 重载后结构保持
  const p2 = loadProfile(s);
  assert.deepEqual(mindOf(p2, 'afei').notes, ['飞记：这人稳']);
});

// 账本 v4（TODO(Q25) 占位数值）：AI 是独立玩家，各有初始身家；旧账自愈迁移
import { loadLedger, balanceOf } from '../src/ui/profile.js';
import { PERSONAS } from '../src/ai/personas.js';

test('账本 v4：新户头按人设 bankroll 起步，客人 100', () => {
  const s = memStorage();
  const led = loadLedger(s);
  assert.equal(led.you, 100);
  assert.equal(balanceOf(led, 'laolitou'), PERSONAS.laolitou.bankroll);
  assert.equal(balanceOf(led, 'afei'), PERSONAS.afei.bankroll);
});

test('账本 v4：旧账补差额——你已赢走的净额不变，且二次读取不重复补', () => {
  const s = memStorage({
    'kai.ledger.v1': JSON.stringify({ you: 130, personas: { laolitou: 70 } }), // 你从老李头赢走 30
  });
  const led = loadLedger(s);
  assert.equal(led.you, 130);
  assert.equal(led.personas.laolitou, PERSONAS.laolitou.bankroll - 30);
  const again = loadLedger(s);
  assert.equal(again.personas.laolitou, PERSONAS.laolitou.bankroll - 30);
});

test('mindOf 补齐 record.wins（旧档无损，胜率列可用）', () => {
  const p = { matches: 0, wins: 0, resets: 0, stats: [], minds: { laolitou: { notes: [], hypotheses: [], stats: [], record: { plays: 3, beat: 1 } } } };
  const m = mindOf(p, 'laolitou');
  assert.equal(m.record.wins, 0);
  assert.equal(m.record.plays, 3);
});
