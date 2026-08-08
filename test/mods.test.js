// 词条运行时测试（T7 实验桌批次）：亮一颗/掐/让报的引擎行为、
// 静态校验与回译（编译器地基）、冒烟自对弈不变量、体检离线门、解析与沉默 bot 守法。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { countBid } from '../src/rules.js';
import { probBidTrue, probBidExact, obProb, obProbExact } from '../src/probability.js';
import { CATALOG, catalogMap, validateMod, renderCard } from '../src/mods/catalog.js';
import { selfPlayMods, checkInvariants, smokeMods } from '../src/mods/smoke.js';
import { examMod } from '../src/mods/exam.js';
import { compileWish } from '../src/mods/compiler.js';
import { parseDecision, buildPrompts } from '../src/ai/agent.js';
import { createSilentBot } from '../src/ai/silent.js';

const MODS = CATALOG;
const { liang, qia, rang } = catalogMap();

// 双人带词条对局，双方掀盅——多数用例的起手式
async function matchWith(mods, seed = 5) {
  const m = await createMatch({ seed, config: { mods } });
  await m.act('A', { type: 'peek' });
  await m.act('B', { type: 'peek' });
  return m;
}

// ---------- 亮一颗 ----------

test('亮一颗：看骰前不可亮、看骰后每局一次、明骰全桌可见', async () => {
  const m = await createMatch({ seed: 5, config: { mods: [liang] } });
  assert.ok(!m.observe('A').legal.some((a) => a.type === 'liang'), '未看骰不可亮');
  await m.act('A', { type: 'peek' });
  const face = m.observe('A').yourDice[0];
  assert.ok(m.observe('A').legal.some((a) => a.type === 'liang'));
  await assert.rejects(() => m.act('A', { type: 'liang', face: 7 }), /no such die/);
  await m.act('A', { type: 'liang', face });
  const obB = m.observe('B');
  assert.deepEqual(obB.shown.A, [face], '对方看得见亮出的骰');
  assert.equal(obB.events.at(-1).type, 'modAction');
  assert.equal(obB.events.at(-1).face, face);
  // 亮完行动权仍在 A（keepTurn），且本局不可再亮
  assert.equal(obB.turn, 'A');
  assert.ok(!m.observe('A').legal.some((a) => a.type === 'liang'), '每局限一次');
});

test('亮一颗：概率表盘双发折算明骰（obProb）', async () => {
  const m = await matchWith([liang], 5);
  const face = m.observe('A').yourDice[0];
  await m.act('A', { type: 'liang', face });
  await m.act('A', { type: 'bid', count: 2, face: 3 });
  const obB = m.observe('B');
  // B 眼中：已知骰 = 自见 5 颗 + A 亮的 1 颗，未知 4 颗（用高数量报价放大差异）
  const bid = { count: 7, face };
  const expect = probBidTrue(bid, [...obB.yourDice, face], 4, false);
  assert.equal(obProb(obB, bid), expect);
  assert.notEqual(expect, probBidTrue(bid, obB.yourDice, 5, false), '折算确实改变了结果输入');
});

// ---------- 掐 ----------

// 从两侧 observe 拼出全桌真实骰面（测试是双方客户端的合体，不越权）
function allDiceOf(m) {
  return [...m.observe('A').yourDice, ...m.observe('B').yourDice];
}

test('掐对：赢回一颗真输掉的骰并收池，报价者先报下一局', async () => {
  const m = await matchWith([qia], 11);
  // 第 1 局：让 B 真输一颗——B 报到顶格（必假），A 开
  await m.act('A', { type: 'bid', count: 2, face: 2 });
  await m.act('B', { type: 'bid', count: 10, face: 6 });
  await m.act('A', { type: 'challenge' });
  const r1 = m.observe('A').events.findLast((e) => e.type === 'roundEnd');
  assert.equal(r1.loser, 'B', '顶格报价应被开掉');
  assert.equal(r1.diceCount.B, 4);
  // 第 2 局：B（输家）先报；A 抬到"恰好为真"，B 掐——赢回那颗骰
  await m.act('B', { type: 'peek' });
  await m.act('A', { type: 'peek' });
  await m.act('B', { type: 'bid', count: 2, face: 2 });
  const all = allDiceOf(m);
  let bid = null;
  for (let f = 2; f <= 6; f++) {
    const n = countBid({ count: 1, face: f }, all, false);
    if (n >= 3 || (n === 2 && f > 2)) { bid = { count: n, face: f }; break; }
  }
  assert.ok(bid, '种子 11 应有可构造的恰好抬价');
  await m.act('A', { type: 'bid', ...bid });
  const obB = m.observe('B');
  assert.ok(obB.legal.some((a) => a.type === 'qia'));
  await m.act('B', { type: 'qia' });
  const ev = m.observe('A').events;
  const rv = ev.findLast((e) => e.type === 'reveal');
  const re = ev.findLast((e) => e.type === 'roundEnd');
  assert.equal(rv.calza, true);
  assert.equal(rv.exact, true);
  assert.equal(re.loser, null, '掐对无人掉骰');
  assert.equal(re.winner, 'B', '掐对掐者收池');
  assert.equal(re.diceCount.B, 5, 'B 赢回一颗（4→5）');
  assert.equal(re.diceCount.A, 5);
  assert.ok(re.transfers.B > 0 && re.transfers.A < 0);
  const rs = ev.findLast((e) => e.type === 'roundStart');
  assert.equal(rs.first, 'A', '掐对→报价者先报下一局');
});

test('掐错：掐者掉一颗骰、报价者收池且不掉骰，掐者先报下一局', async () => {
  const m = await matchWith([qia], 13);
  const all = allDiceOf(m);
  // 找一个"为真但不恰好"的报价（实数 > 报数 ≥ 2）——掐必错
  let bid = null;
  for (let f = 2; f <= 6; f++) {
    const n = countBid({ count: 1, face: f }, all, false);
    if (n >= 3) { bid = { count: 2, face: f }, n; break; }
  }
  assert.ok(bid, '种子 13 应有实数≥3 的点');
  await m.act('A', { type: 'bid', ...bid });
  await m.act('B', { type: 'qia' });
  const ev = m.observe('A').events;
  const rv = ev.findLast((e) => e.type === 'reveal');
  const re = ev.findLast((e) => e.type === 'roundEnd');
  assert.equal(rv.exact, false);
  assert.equal(re.loser, 'B');
  assert.equal(re.winner, 'A', '掐错报价者收池');
  assert.equal(re.diceCount.B, 4, '掐者掉一颗');
  assert.equal(re.diceCount.A, 5, '被掐者安全');
  const rs = ev.findLast((e) => e.type === 'roundStart');
  assert.equal(rs.first, 'B', '掐错→掐者（输家）先报');
});

test('掐：回骰上限=起始骰数（满编掐对不越界）', async () => {
  const m = await matchWith([qia], 11);
  const all = allDiceOf(m);
  let bid = null;
  for (let f = 2; f <= 6; f++) {
    const n = countBid({ count: 1, face: f }, all, false);
    if (n >= 2) { bid = { count: n, face: f }; break; }
  }
  await m.act('A', { type: 'bid', ...bid });
  await m.act('B', { type: 'qia' });
  const re = m.observe('A').events.findLast((e) => e.type === 'roundEnd');
  assert.equal(re.exact, true);
  assert.equal(re.diceCount.B, 5, '满编不加骰');
});

test('掐：表盘双发——恰好概率与 obProbExact 一致', async () => {
  const m = await matchWith([qia], 7);
  await m.act('A', { type: 'bid', count: 3, face: 4 });
  const obB = m.observe('B');
  const expect = probBidExact({ count: 3, face: 4 }, obB.yourDice, 5, false);
  assert.equal(obProbExact(obB, obB.currentBid), expect);
  assert.ok(expect > 0 && expect < 1);
});

// ---------- 让报 ----------

test('让报：推回后报价者必须自己抬（不能开/掐自己的价），每场一次', async () => {
  const m = await matchWith([qia, rang], 5);
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  assert.ok(m.observe('B').legal.some((a) => a.type === 'rang'));
  await m.act('B', { type: 'rang' });
  const obA = m.observe('A');
  assert.equal(obA.turn, 'A', '行动权推回报价者');
  assert.ok(!obA.legal.some((a) => a.type === 'challenge'), '不能开自己的价');
  assert.ok(!obA.legal.some((a) => a.type === 'qia'), '不能掐自己的价');
  assert.ok(obA.legal.some((a) => a.type === 'bid'), '只能继续抬');
  await m.act('A', { type: 'bid', count: 2, face: 5 });
  assert.ok(!m.observe('B').legal.some((a) => a.type === 'rang'), '每场限一次');
  // 现在 B 可以开 A 的新价——节奏换了开牌权
  assert.ok(m.observe('B').legal.some((a) => a.type === 'challenge'));
});

test('让报：报满阶梯（对方抬无可抬）时不可让——防死局', async () => {
  const m = await matchWith([rang], 5);
  await m.act('A', { type: 'bid', count: 10, face: 6 }); // 顶格
  assert.ok(!m.observe('B').legal.some((a) => a.type === 'rang'));
});

// ---------- 解析与沉默 bot ----------

test('parseDecision：词条动作合法通过、参数校验、非法拒绝', async () => {
  const m = await matchWith(MODS, 5);
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const ob = m.observe('B');
  const face = ob.yourDice[0];
  const good = parseDecision(`{"action":{"type":"liang","face":${face}},"say":"看好了"}`, ob);
  assert.deepEqual(good.action, { type: 'liang', face });
  assert.ok(parseDecision('{"action":{"type":"qia"},"say":"就是这个数"}', ob));
  assert.ok(parseDecision('{"action":{"type":"rang"}}', ob));
  assert.equal(parseDecision('{"action":{"type":"liang","face":7}}', ob), null, '亮不存在的骰');
  assert.equal(parseDecision('{"action":{"type":"xxx"}}', ob), null);
});

test('buildPrompts：规则卡明牌注入、词条候选与动作 schema、明骰入叙事', async () => {
  const m = await matchWith(MODS, 5);
  const faceA = m.observe('A').yourDice[0];
  await m.act('A', { type: 'liang', face: faceA });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  const ob = m.observe('B');
  const { system, user } = buildPrompts(ob, '');
  assert.match(user, /本桌实验词条（明牌，全桌同权）：「亮一颗」/);
  assert.match(user, /「掐」/);
  assert.match(user, new RegExp(`对方.*亮出.*${faceA}`), '明骰进叙事');
  assert.match(user, /恰好的概率按你的骰子算是 \d+%/, '掐的表盘双发进提示词');
  assert.match(user, /把这口价原样推回/);
  assert.match(system, /{"type":"qia"}/);
  assert.match(system, /{"type":"liang","face":点数1到6}/);
  assert.match(user, /face 填骰子的点数/, '亮的语义钉死：点数不是第几颗');
  assert.match(user, /宣言和词条都是真招/, '机制使用软推在场');
});

test('沉默 bot：被让报推回自己的价时守法（不开自己的价，继续抬）', async () => {
  const m = await matchWith([rang], 5);
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'rang' });
  const bot = createSilentBot({ challengeThreshold: 0.99 }); // 阈值拉满：若不守法必开
  const a = bot.decide(m.observe('A'));
  assert.equal(a.type, 'bid');
  await m.act('A', a); // 引擎不炸即合法
});

// ---------- 校验器与回译（编译器地基） ----------

test('validateMod：官方三词条即金样，全部通过', () => {
  for (const mod of CATALOG) {
    const v = validateMod({ name: mod.name, actions: mod.actions });
    assert.ok(v.ok, `${mod.name}: ${v.errors.join('；')}`);
  }
});

test('validateMod：坏 AST 逐类拒绝且拒绝信可读', () => {
  const cases = [
    [{ name: '太长的词条名字啦', actions: [] }, /1–6 字|1–2 个动作/],
    [{ name: '好', actions: [{ type: 'challenge', label: '开', window: { turn: true }, effect: [{ op: 'returnBid' }] }] }, /与基础动作重名/],
    [{ name: '好', actions: [{ type: 'zz', label: '妙', window: { turn: true }, effect: [{ op: 'teleport' }] }] }, /未知效果原子「teleport」/],
    [{ name: '好', actions: [{ type: 'zz', label: '亮', window: { turn: true }, params: 'face', keepTurn: true, effect: [{ op: 'revealOwnDie' }] }] }, /requiresPeeked/],
    [{ name: '好', actions: [{ type: 'zz', label: '倍', window: { turn: true }, keepTurn: true, effect: [{ op: 'potMult', x: 2 }] }] }, /oncePer/],
    [{ name: '好', actions: [{ type: 'zz', label: '让', window: { turn: true, needBid: true, notOwnBid: true }, effect: [{ op: 'returnBid' }] }] }, /needRaisableByBidder/],
    [{ name: '好', actions: [{ type: 'zz', label: '狠', window: { turn: true, needBid: true, notOwnBid: true }, terminal: true, effect: [{ op: 'calzaResolve' }, { op: 'potMult', x: 2 }] }] }, /唯一效果/],
    [{ name: '好', actions: [{ type: 'liang', label: '亮', window: { turn: true, requiresPeeked: true }, params: 'face', keepTurn: true, effect: [{ op: 'revealOwnDie' }] }] }, /撞名/],
  ];
  for (const [ast, re] of cases) {
    const v = validateMod(ast, { existingTypes: ['liang', 'qia', 'rang'] });
    assert.ok(!v.ok, JSON.stringify(ast.actions));
    assert.ok(v.errors.some((e) => re.test(e)), `${re} ∉ ${v.errors.join('；')}`);
  }
  // 缺失原子进 missing（许愿失败日志＝原子库需求清单）
  const miss = validateMod({ name: '好', actions: [{ type: 'zz', label: '妙', window: { turn: true }, effect: [{ op: 'teleport' }] }] });
  assert.deepEqual(miss.missing, ['效果原子 teleport']);
});

test('renderCard：回译确定性、含窗口/限次/效果', () => {
  const card = renderCard({ name: '亮一颗', actions: liang.actions });
  assert.match(card, /轮到你时、你已看过骰，可拍「亮」（每人每局一次）/);
  assert.match(card, /翻开自己选定的一颗骰/);
  assert.match(card, /之后你照常行动/);
  assert.equal(card, renderCard({ name: '亮一颗', actions: liang.actions }), '确定性');
});

// ---------- 冒烟与体检 ----------

test('冒烟自对弈：三词条齐上 120 场（双人）不变量全绿且词条被行使', async () => {
  const r = await smokeMods(MODS, { games: 120 });
  assert.ok(r.ok, r.errors.join('\n'));
  assert.ok(r.uses > 50, `词条行使次数过低：${r.uses}`);
});

test('冒烟自对弈：三人桌 60 场带词条不变量全绿', async () => {
  const r = await smokeMods(MODS, { games: 60, players: ['A', 'B', 'C'] });
  assert.ok(r.ok, r.errors.join('\n'));
});

test('带词条决定性回放：同种子同动作 → 事件流一致', async () => {
  const { events, actions } = await selfPlayMods(42, { mods: MODS });
  const m = await createMatch({ seed: 42, config: { mods: MODS } });
  for (const { p, a } of actions) await m.act(p, a);
  const replayed = m.observe('A').events;
  assert.equal(replayed.length, events.length);
  for (let k = 0; k < events.length; k++) {
    const { elapsedMs: _a, ...orig } = events[k];
    const { elapsedMs: _b, ...rep } = replayed[k];
    assert.deepEqual(rep, orig, `事件 ${k} 不一致`);
  }
});

test('体检：官方词条过静态与冒烟、张力守恒两门；无通道时歧义门记未测', async () => {
  const r = await examMod(qia, { games: 30 });
  assert.equal(r.pass, true);
  const byId = Object.fromEntries(r.gates.map((g) => [g.id, g]));
  assert.equal(byId.static.pass, true);
  assert.equal(byId.tension.pass, true);
  assert.equal(byId.ambiguity.pass, null);
  assert.match(byId.ambiguity.detail, /没测/);
});

test('compileWish：mock 编译端到端——产物过校验回译并可冒烟；拒绝信带缺失原子', async () => {
  const mockFetch = (content) => async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
  const chan = { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' };
  // 成功路径：potMult 原子（第四原子的引擎覆盖也在这条冒烟里）
  const good = JSON.stringify({
    name: '翻倍章',
    actions: [{ type: 'fanbei', label: '倍', window: { turn: true, oncePer: 'match' }, keepTurn: true, effect: [{ op: 'potMult', x: 2 }] }],
  });
  const r = await compileWish('每场一次把池翻倍', chan, { fetchFn: mockFetch(good) });
  assert.ok(r.ok, r.reason);
  assert.match(r.card, /每人每场一次/);
  assert.match(r.card, /池 ×2/);
  const mod = { id: 'wish-fanbei', name: r.ast.name, card: r.card, origin: 'wish', actions: r.ast.actions };
  const sm = await smokeMods([mod], { games: 40 });
  assert.ok(sm.ok && sm.uses > 0, sm.errors.join('\n'));
  // 编译器自认表达不了：拒绝信带缺的钩子（许愿失败日志原料）
  const refuse = await compileWish('让我能看对面的骰子', chan, {
    fetchFn: mockFetch('{"error":"没有查看他人骰面的原子","missing":"查看他人骰"}'),
  });
  assert.equal(refuse.ok, false);
  assert.match(refuse.reason, /没有查看他人骰面的原子/);
  assert.equal(refuse.missing, '查看他人骰');
  // 编译幻觉：发明了不存在的原子——静态校验拦下，missing 指名
  const bad = await compileWish('x', chan, {
    fetchFn: mockFetch('{"name":"坏","actions":[{"type":"huan","label":"幻","window":{"turn":true},"keepTurn":true,"effect":[{"op":"teleport"}]}]}'),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.missing, /teleport/);
});

test('体检：窗口永远打不开的词条被门一逮住', async () => {
  const dead = {
    id: 'dead', name: '死门', card: '永远打不开',
    actions: [{ type: 'dead', label: '死', window: { turn: true, needBid: true, minBids: 25 }, keepTurn: true, effect: [{ op: 'potMult', x: 2 }] }],
  };
  // minBids 25 在 10 颗骰的桌上几乎不可达（报价上限=总骰数）
  const fixed = { ...dead, actions: [{ ...dead.actions[0], window: { ...dead.actions[0].window, oncePer: 'round' } }] };
  const r = await examMod(fixed, { games: 25 });
  const g1 = r.gates.find((g) => g.id === 'static');
  assert.equal(g1.pass, false);
  assert.match(g1.detail, /一次都没触发/);
});
