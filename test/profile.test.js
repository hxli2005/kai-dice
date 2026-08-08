// 档案双层制（§3.3 Q19，T2 验收）：客观层共享、主观层私有、旧档迁移无损。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, appendMatch, profileBrief, mindOf, openerFacts } from '../src/ui/profile.js';

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

// Q14 显形节拍的编码侧自查（Q43 要求补报）：次场开场白必须拿得到上一场的具体事实
test('Q14 自查：生面孔只有招呼素材，回头客的开场白素材必含上一场具体事实', () => {
  const fresh = openerFacts({ matches: 0, wins: 0, resets: 0, stats: [] }, { you: 100 });
  assert.deepEqual(fresh, ['客人是生面孔，第一次上桌']);
  const back = openerFacts(
    {
      matches: 2,
      wins: 1,
      resets: 1,
      stats: [
        {
          ...STATS,
          won: false,
          timesChallenged: 3,
          myCalcs: 4,
          bigPots: [{ round: 4, mult: 8, won: false, transfer: 24 }],
          slowest: { round: 3, bid: { count: 4, face: 5 }, ms: 12000 },
        },
      ],
    },
    { you: -30 },
  );
  const text = back.join('；');
  assert.match(text, /这是他第 3 场/);
  assert.match(text, /他账上欠着 30/);
  assert.match(text, /他把账翻篇过 1 次/);
  assert.match(text, /上一场他开了 2 次牌，中了 1 次/);
  assert.match(text, /上一场他被掀了 3 回/);
  assert.match(text, /上一场他拨了 4 次算盘/); // F6 依赖度进开场白素材
  assert.match(text, /×8 的池/); // F5 高倍局记忆加权
  assert.match(text, /第 3 局他停了半天才报 4 个 5/);
  assert.match(text, /上一场他输了/);
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

// Q28 钥匙分流：旧 kai.byok.v1 迁移——纯 key＝暗号，全套三格＝客席钥匙
import { loadPass, loadGuest } from '../src/ui/profile.js';

test('钥匙迁移：只填 key 的旧配置归暗号', () => {
  const s = memStorage({ 'kai.byok.v1': JSON.stringify({ apiKey: 'sk-pass', baseUrl: '', model: '', format: 'openai' }) });
  assert.equal(loadPass(s), 'sk-pass');
  assert.equal(loadGuest(s), null);
  assert.equal(s.getItem('kai.byok.v1'), null);
});

test('钥匙迁移：三格全填的旧配置归客席', () => {
  const s = memStorage({ 'kai.byok.v1': JSON.stringify({ apiKey: 'sk-x', baseUrl: 'https://api.x.com/v1', model: 'm1', format: 'openai' }) });
  assert.equal(loadGuest(s).model, 'm1');
  assert.equal(loadPass(s), '');
});

test('客席身家默认 300（model: 前缀）', () => {
  const led = loadLedger(memStorage());
  assert.equal(balanceOf(led, 'model:some-model'), 300);
});
