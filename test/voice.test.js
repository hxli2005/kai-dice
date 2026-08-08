// 沉默模式的"被读"底线（施工单 F2）：无 LLM 通道时，开牌那一拍仍要说出"我为什么开你"。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { silentSay, readClause } from '../src/ai/voice.js';
import { PERSONAS } from '../src/ai/personas.js';
import { createOpponent } from '../src/ai/agent.js';

test('F2：沉默模式开牌台词按人设声口生成，且只用真事实', async () => {
  const m = await createMatch({ seed: 5 });
  await m.act('A', { type: 'declare', declaration: 'blind' }); // 客人空着手压人——可引用的事实
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  const ob = m.observe('B');
  assert.equal(readClause(ob), '你骰都没看就压我');
  const li = silentSay(PERSONAS.laolitou, ob);
  const fei = silentSay(PERSONAS.afei, ob);
  assert.match(li, /你骰都没看就压我。开。$/);
  assert.match(li, /^(基本稳|五五开|悬|纯扯)。/, '老李头的母语：先给档，再动手');
  assert.match(fei, /就这？开！$/);
  assert.notEqual(li, fei, '不同人设不同声口');
  // 零准数：沉默 bot 没拨过算盘，嘴里就不许有百分号
  for (const line of [li, fei, silentSay(PERSONAS.xiansheng, ob)]) assert.ok(!/%|成(?!立)/.test(line));
});

test('F2：拨过算盘的人报的价会被点破（算盘也是可引用的事实）', async () => {
  const m = await createMatch({ seed: 7 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'calc' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  assert.equal(readClause(m.observe('B')), '你算完才敢报这个数');
});

test('F2：无通道的 AI 决策仍给得出台词素材（降级不降差异化）', async () => {
  const m = await createMatch({ seed: 11 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 9, face: 6 }); // 报到天上去，沉默 bot 必开
  const silent = createOpponent({ persona: PERSONAS.laolitou });
  await m.act('B', (await silent.decide(m.observe('B'))).action); // 不玩盲的人设先掀盅
  const ob = m.observe('B');
  const d = await silent.decide(ob);
  assert.equal(d.say, '', '沉默 bot 自己不说话');
  assert.equal(d.silentFallback, true);
  if (d.action.type === 'challenge') assert.ok(silentSay(PERSONAS.laolitou, ob).endsWith('开。'));
});
