// 档案双层制（§3.3 Q19，T2 验收）：客观层共享、主观层私有、旧档迁移无损。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, appendMatch, profileBrief, profilePromptData, mindOf, openerFacts } from '../src/ui/profile.js';
import { modelPersona } from '../src/ai/personas.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

const STATS = { bluffRate: 0.4, myChallenges: 2, myChallengeHits: 1, timesChallenged: 1, avgTimeMs: 5000, myBids: 5, myBlinds: 0, rounds: 6 };

test('旧档迁移：顶层 notes 无损归入一号机主观层', () => {
  const s = memStorage({
    'kai.profile.v1': JSON.stringify({ matches: 3, wins: 1, notes: ['他手抖', '秒点真话'], stats: [STATS] }),
  });
  const p = loadProfile(s);
  assert.equal(p.matches, 3);
  assert.equal(p.notes, undefined);
  assert.deepEqual(p.minds['model:deepseek-v4-flash'].notes, ['他手抖', '秒点真话']);
  assert.deepEqual(p.minds['model:deepseek-v4-flash'].hypotheses, []);
});

// Q89 折成型号户头：老李头与阿飞钉的是同一个型号，两本账**合并**成一本
//（DESIGN §1.2「户头按型号记」——以前分着记才是 bug）。D4 规矩：改键必须带迁移。
test('Q89 迁移：旧机位折进型号户头，两本并一本且一分不差', () => {
  const s = memStorage({
    'kai.profile.v1': JSON.stringify({
      matches: 9, wins: 4, stats: [STATS],
      minds: {
        laolitou: { notes: ['他大池必怂'], hypotheses: [{ text: '虚报时偏报6', hits: 4 }], stats: [], record: { plays: 9, beat: 2, wins: 4 } },
        afei: { notes: ['这人稳'], hypotheses: [], stats: [], record: { plays: 2, beat: 0, wins: 1 } },
      },
    }),
    'kai.ledger.v1': JSON.stringify({ you: 130, personas: { laolitou: 770, afei: 300 }, bankrollApplied: { laolitou: 800, afei: 300 } }),
  });
  const p = loadProfile(s);
  const F = 'model:deepseek-v4-flash';
  assert.equal(p.minds.laolitou, undefined, '旧键必须让位');
  assert.equal(p.minds.afei, undefined);
  assert.deepEqual(p.minds[F].notes, ['他大池必怂', '这人稳'], '两本笔记接起来');
  assert.equal(p.minds[F].hypotheses[0].text, '虚报时偏报6');
  assert.equal(p.minds[F].record.plays, 11, '9 + 2：对局数相加');
  assert.equal(p.minds[F].record.wins, 5, '4 + 1');

  const led = loadLedger(s);
  assert.equal(led.personas.laolitou, undefined, '旧键必须让位');
  assert.equal(led.personas.afei, undefined);
  // 老李头 770（本金 800）＝净 −30；阿飞 300（本金 300）＝净 0 → 并账后 −30，本金没被加两遍
  assert.equal(led.personas[F], -30, '合并后它净输 30');
  assert.equal(led.bankrollApplied[F], 0);
  assert.equal(loadLedger(s).personas[F], -30, '二次读取不重复折');
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

test('双层：客观统计全席共享，笔记按型号各记各的', () => {
  const s = memStorage();
  let p = loadProfile(s);
  p = appendMatch(p, { won: true, stats: STATS, notes: ['flash 记：爱虚报'], personaId: 'model:deepseek-v4-flash' }, s);
  p = appendMatch(p, { won: false, stats: STATS, notes: ['pro 记：这人稳'], personaId: 'model:deepseek-v4-pro' }, s);
  // 客观层：两场都计入，谁看都一样
  assert.equal(p.matches, 2);
  assert.equal(p.stats.length, 2);
  assert.equal(
    profileBrief(p, 'model:deepseek-v4-flash', false),
    profileBrief(p, 'model:deepseek-v4-pro', false),
    '客观段必须全席一致',
  );
  // 主观层：笔记按型号互不可见
  assert.match(profileBrief(p, 'model:deepseek-v4-flash'), /flash 记：爱虚报/);
  assert.doesNotMatch(profileBrief(p, 'model:deepseek-v4-flash'), /pro 记/);
  assert.match(profileBrief(p, 'model:deepseek-v4-pro'), /pro 记：这人稳/);
  assert.doesNotMatch(profileBrief(p, 'model:deepseek-v4-pro'), /flash 记/);
  // 重载后结构保持
  const p2 = loadProfile(s);
  assert.deepEqual(mindOf(p2, 'model:deepseek-v4-pro').notes, ['pro 记：这人稳']);
});

test('提示词档案契约：核验统计与型号私有笔记/假设分桶', () => {
  const s = memStorage();
  let p = loadProfile(s);
  p = appendMatch(p, { won: true, stats: STATS, notes: ['flash 的主观笔记'], personaId: 'model:deepseek-v4-flash' }, s);
  mindOf(p, 'model:deepseek-v4-flash').hypotheses = [{ text: '他在大池会急', hits: 2, misses: [] }];
  mindOf(p, 'model:deepseek-v4-pro').notes = ['pro 的主观笔记'];

  const flash = profilePromptData(p, 'model:deepseek-v4-flash');
  const pro = profilePromptData(p, 'model:deepseek-v4-pro');
  assert.deepEqual(flash.verified, pro.verified, '引擎统计不得因型号改口径');
  assert.equal(flash.verified[0].scope, 'career');
  assert.equal(flash.verified[1].scope, 'lastMatch');
  assert.deepEqual(flash.subjective.notes, ['flash 的主观笔记']);
  assert.deepEqual(flash.subjective.hypotheses, [{ text: '他在大池会急', hits: 2, misses: [] }]);
  assert.deepEqual(pro.subjective.notes, ['pro 的主观笔记']);
  assert.deepEqual(pro.subjective.hypotheses, []);
});

// 账本 v4（TODO(Q25) 占位数值）：AI 是独立玩家，各有初始身家；旧账自愈迁移
import { loadLedger, balanceOf } from '../src/ui/profile.js';
import { PERSONAS } from '../src/ai/personas.js';

// Q88：榜上不预置任何数字——身家＝净转移，谁都从 0 起
test('账本 v5：全席从 0 起，一场没打榜上就是空的', () => {
  const s = memStorage();
  const led = loadLedger(s);
  assert.equal(led.you, 0);
  assert.equal(balanceOf(led, 'model:deepseek-v4-flash'), 0);
  assert.equal(balanceOf(led, 'model:deepseek-v4-flash'), 0);
  assert.equal(balanceOf(led, 'model:deepseek-v4-pro'), 0);
  assert.equal(balanceOf(led, 'model:any-model'), 0);
});

// Q88 自愈迁移：老档带着本金记的数，要原样折成净转移，一分不差且不许补第二次
test('账本 v5：老档折成净转移——赢走的还是那么多，二次读取不重复折', () => {
  const s = memStorage({
    // 老口径：玩家本金 100、一号机本金 800；你从它身上赢走 30
    'kai.ledger.v1': JSON.stringify({ you: 130, personas: { seat1: 770 }, bankrollApplied: { seat1: 800 } }),
  });
  const led = loadLedger(s);
  assert.equal(led.you, 30, '你净赢 30');
  assert.equal(led.personas['model:deepseek-v4-flash'], -30, '它净输 30');
  const again = loadLedger(s);
  assert.equal(again.you, 30, '不许再折一次');
  assert.equal(again.personas['model:deepseek-v4-flash'], -30);
});

test('mindOf 补齐 record.wins（旧档无损，胜率列可用）', () => {
  const p = { matches: 0, wins: 0, resets: 0, stats: [], minds: { 'model:deepseek-v4-flash': { notes: [], hypotheses: [], stats: [], record: { plays: 3, beat: 1 } } } };
  const m = mindOf(p, 'model:deepseek-v4-flash');
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

test('Q88：客席也从 0 起——没打过就没有身家', () => {
  const led = loadLedger(memStorage());
  assert.equal(balanceOf(led, 'model:some-model'), 0);
});

// ---------- 模型席：每个型号各记各的账（用户 2026-08-09 验证要求） ----------
// 户头＝模型名。这条既是"换模型＝换人"的落点，也是"托管席与自带钥匙同一个模型即同一个人"的依据。

test('模型独立记忆：主观层按型号分开，客观层照旧全馆共享', () => {
  const s = memStorage();
  const A = modelPersona('deepseek-v4-flash', { hosted: true });
  const B = modelPersona('glm-5.2');
  assert.notEqual(A.id, B.id);

  const p = loadProfile(s);
  appendMatch(p, { won: false, stats: STATS, notes: ['他算完才敢报'], personaId: A.id }, s);
  mindOf(p, A.id).hypotheses = [{ text: '他压高价必虚', hits: 2 }];
  appendMatch(p, { won: true, stats: { ...STATS, bluffRate: 0.1 }, notes: ['他从不盲'], personaId: B.id }, s);

  const back = loadProfile(s);
  // 主观层：各记各的——A 的笔记与假设不许漏进 B 的本子
  assert.deepEqual(mindOf(back, A.id).notes, ['他算完才敢报']);
  assert.deepEqual(mindOf(back, B.id).notes, ['他从不盲']);
  assert.equal(mindOf(back, A.id).hypotheses.length, 1);
  assert.deepEqual(mindOf(back, B.id).hypotheses, []);
  // 客观层：全馆公共账本，换谁上桌都不冷启动（Q19）
  assert.equal(back.matches, 2);
  assert.equal(back.wins, 1);
  assert.equal(back.stats.length, 2);
  // 档案摘要给谁看，就只带谁的笔记
  assert.match(profileBrief(back, A.id), /他算完才敢报/);
  assert.ok(!profileBrief(back, A.id).includes('他从不盲'));
});

test('模型席：同一个模型不管谁付钱都是同一个人；身家各开各的户头', () => {
  const hosted = modelPersona('deepseek-v4-flash', { hosted: true });
  const byok = modelPersona('deepseek-v4-flash');
  assert.equal(hosted.id, byok.id, '同名即同人——托管与自带钥匙共用一本账');
  assert.equal(hosted.hosted, true);
  assert.equal(byok.hosted, false);
  // 素颜：提示词只给规则、操作与数据（角色脚本是被删掉的那部分）
  assert.equal(hosted.bare, true);
  assert.equal(hosted.flaws, undefined);
  assert.equal(hosted.tone, undefined);
  assert.equal(hosted.blurb.includes('deepseek-v4-flash'), true);
  assert.equal(hosted.identity, undefined, '身份自述已随角色脚本一起删掉');
  // 身家按户头走，两个不同型号各有各的钱
  const led = { you: 0, personas: {}, bankrollApplied: {} };
  assert.equal(balanceOf(led, hosted.id), 0);
  led.personas[hosted.id] = 412;
  assert.equal(balanceOf(led, hosted.id), 412);
  assert.equal(balanceOf(led, modelPersona('glm-5.2').id), 0, '另一个型号自己的账，还没开张');
});
