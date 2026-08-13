// G2 事件接地（DESIGN §3.5「事件接地」，SYNC 接地批次 Q50）
//
// 立案原因：26 局压测里"反复把谁开谁弄反"。判据是硬的——
// 偶尔记错数字＝人格，主客体错＝数据接地故障。
// 本文件是那条判据的看门狗：引擎发的每条事件都得能指名道姓，
// 下游（判词素材／档案统计／留档／旧档回放）读到的必须是同一个人。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, mulberry32 } from '../src/engine.js';
import { allLegalBids } from '../src/rules.js';
import { catalogMap } from '../src/mods/catalog.js';
import { groundEvents, groundingFaults, TUPLE_KEYS } from '../src/grounding.js';
import { viewFor } from '../src/room/rename.js';
import { computeStats } from '../src/ui/report.js';
import { buildPromptPayload } from '../src/ai/agent.js';

// 固定脚本：同种子同动作，逐字节可复现（§4.1）
async function scripted(seed, players = ['A', 'B'], mods = []) {
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const m = await createMatch({ seed, config: { players, mods } });
  for (let step = 0; step < 20_000; step++) {
    const obs = players.map((p) => m.observe(p));
    const o = obs.find((x) => x.legal.some((a) => a.type !== 'peek')) ?? obs.find((x) => x.legal.length > 0);
    if (!o) break;
    let a = pick(o.legal);
    if (a.type === 'bid') {
      const bids = allLegalBids(o.currentBid, o.zhai, o.diceCount.you + o.diceCount.opp);
      a = { type: 'bid', ...pick(bids) };
    }
    await m.act(o.you, a, { elapsedMs: Math.floor(rng() * 9000) });
  }
  const final = m.observe(players[0]);
  assert.ok(final.over, `seed ${seed}: 对局未终止`);
  return final.events;
}

// 独立重算一遍"当前报价是谁的"——不看事件自称的 target，只按 bid 顺序数
function openingsOf(events) {
  const out = [];
  let bidder = null;
  for (const e of events) {
    if (e.type === 'roundStart') bidder = null;
    if (e.type === 'bid') bidder = e.actor;
    if (e.type === 'challenge' || e.type === 'reveal' || (e.type === 'modAction' && e.op === 'calzaResolve'))
      out.push({ i: e.i, type: e.type, actor: e.actor, target: e.target, expected: bidder });
  }
  return out;
}

test('G2「谁开谁」：固定脚本 20 局，每条记录的主客体与引擎一致', async () => {
  let rounds = 0;
  let openings = 0;
  for (let seed = 1; rounds < 20; seed++) {
    const events = await scripted(seed);
    rounds += events.filter((e) => e.type === 'roundStart').length;
    assert.deepEqual(groundingFaults(events), [], `seed ${seed} 接地自查`);
    for (const o of openingsOf(events)) {
      assert.equal(o.target, o.expected, `seed ${seed} 事件 ${o.i}(${o.type}) 开的不是当前报价人`);
      assert.notEqual(o.actor, o.target, `seed ${seed} 事件 ${o.i} 开了自己的价`);
      openings++;
    }
  }
  assert.ok(rounds >= 20, `只跑到 ${rounds} 局`);
  assert.ok(openings >= 20, `开牌样本只有 ${openings} 次`);
});

test('G2 全事件四元组：每一条都填齐 actor/target/action/round，一条不漏', async () => {
  const events = await scripted(7, ['A', 'B', 'C']);
  const seen = new Set();
  for (const e of events) {
    for (const k of TUPLE_KEYS) assert.ok(k in e, `事件 ${e.i}(${e.type}) 缺 ${k}`);
    assert.ok(Number.isInteger(e.round) && e.round >= 1, `事件 ${e.i} 的 round 不是局号：${e.round}`);
    seen.add(e.type);
  }
  // 引擎自己说的话（开局/结算/场终）没有主客体，读作"这条不是谁做的"
  for (const e of events.filter((x) => ['roundStart', 'roundEnd', 'matchEnd'].includes(x.type))) {
    assert.equal(e.actor, null);
    assert.equal(e.target, null);
  }
  // 玩家动作必须指名道姓
  for (const e of events.filter((x) => ['peek', 'bid', 'declare', 'challenge'].includes(x.type)))
    assert.ok(e.actor, `事件 ${e.i}(${e.type}) 没有 actor`);
  assert.ok(seen.has('challenge') && seen.has('reveal') && seen.has('roundEnd'));
});

test('G2 三人桌：谁开谁进档案不许错位（旧写法把座位硬编码成 A/B，三人桌上必错）', async () => {
  const events = await scripted(7, ['A', 'B', 'C']);
  // 从事件流独立数一遍归属，再与报告卡的统计对账
  for (const you of ['A', 'B', 'C']) {
    const truth = {};
    const vs = (seat) => (truth[seat] ??= { iOpened: 0, theyOpenedMe: 0 });
    for (const e of events) {
      if (e.type !== 'reveal') continue;
      if (e.actor === you) vs(e.target).iOpened++;
      else if (e.target === you) vs(e.actor).theyOpenedMe++;
    }
    const st = computeStats(events, you, {});
    for (const [seat, t] of Object.entries(truth)) {
      assert.equal(st.vs[seat]?.iOpened ?? 0, t.iOpened, `${you} 开 ${seat} 的次数`);
      assert.equal(st.vs[seat]?.theyOpenedMe ?? 0, t.theyOpenedMe, `${seat} 开 ${you} 的次数`);
    }
    const opened = events.filter((e) => e.type === 'reveal' && e.actor === you).length;
    const wasOpened = events.filter((e) => e.type === 'reveal' && e.target === you).length;
    assert.equal(st.myChallenges + st.myCalzas, opened, `${you} 一共开了几次`);
    assert.equal(st.timesChallenged, wasOpened, `${you} 一共被开了几次`);
  }
});

test('G2 词条「掐」：掐的也是当前报价人，让报的 to 与 target 同源', async () => {
  const { qia, rang } = catalogMap();
  let sawCalza = false;
  let sawReturn = false;
  for (let seed = 1; seed <= 40 && !(sawCalza && sawReturn); seed++) {
    const events = await scripted(seed, ['A', 'B'], [qia, rang]);
    assert.deepEqual(groundingFaults(events), [], `seed ${seed} 接地自查`);
    for (const o of openingsOf(events)) assert.equal(o.target, o.expected, `seed ${seed} 事件 ${o.i}`);
    for (const e of events.filter((x) => x.type === 'modAction')) {
      assert.equal(e.action, e.mod === 'qia' ? 'qia' : e.action, '词条事件的 action 是词条动作名');
      if (e.op === 'calzaResolve') sawCalza = true;
      if (e.op === 'returnBid') {
        sawReturn = true;
        assert.equal(e.target, e.to, '让报推回给谁＝target');
      }
    }
  }
  assert.ok(sawCalza, '样本里没出现掐');
  assert.ok(sawReturn, '样本里没出现让报');
});

test('G2 好友房：客视角重命名后主客体跟着换，谁开谁不错位', async () => {
  const events = await scripted(7, ['A', 'B', 'C']);
  const viewed = viewFor({ events }, 'C').events; // A↔C 对换
  assert.deepEqual(groundingFaults(viewed), [], '重命名后的事件流仍应接地完好');
  const swap = (s) => ({ A: 'C', C: 'A' })[s] ?? s;
  for (const [i, e] of events.entries()) {
    assert.equal(viewed[i].actor, e.actor == null ? null : swap(e.actor), `事件 ${e.i} 的 actor`);
    assert.equal(viewed[i].target, e.target == null ? null : swap(e.target), `事件 ${e.i} 的 target`);
  }
});

test('G2 进提示词的历史是四元组的投影，不是另写一遍的说法', async () => {
  const events = await scripted(3);
  const ob = { ...(await createMatch({ seed: 3 })).observe('A'), events };
  const payload = buildPromptPayload(ob, '', { id: 'x', name: 'x' });
  const flat = payload.history.rounds.flatMap((r) => r.events);
  const byId = new Map(events.map((e) => [e.i, e]));
  let checked = 0;
  for (const h of flat) {
    const src = byId.get(h.id);
    assert.equal(h.actor, src.actor, `事件 ${h.id} 的 actor 与引擎不符`);
    if (h.type === 'challenge') {
      assert.equal(h.target, src.target, `事件 ${h.id} 的 target 与引擎不符`);
      checked++;
    }
  }
  assert.ok(checked > 0, '样本里没有开牌');
});

// ---------- 旧档迁移：G2 之前落盘的实录 ----------

test('G2 旧档迁移：{player} 老事件补齐四元组，谁开谁按报价梯还原', () => {
  const legacy = [
    { i: 0, type: 'roundStart', round: 1, first: 'A', diceCount: { A: 5, B: 5, C: 5 } },
    { i: 1, type: 'peek', player: 'A' },
    { i: 2, type: 'bid', player: 'A', count: 2, face: 4 },
    { i: 3, type: 'bid', player: 'B', count: 3, face: 4 },
    { i: 4, type: 'challenge', player: 'C' }, // 老档里没写开的是谁——B 才是当前报价人
    {
      i: 5,
      type: 'reveal',
      bid: { player: 'B', count: 3, face: 4 },
      challenger: 'C',
      dice: { A: [1, 1, 1, 1, 1], B: [2, 2, 2, 2, 2], C: [3, 3, 3, 3, 3] },
      zhai: false,
      stands: false,
      actual: 0,
      loser: 'B',
    },
    { i: 6, type: 'roundEnd', round: 1, loser: 'B', winner: 'C', transfer: 3, chips: {}, diceCount: { A: 5, B: 4, C: 5 } },
  ];
  const grounded = groundEvents(legacy);
  assert.deepEqual(groundingFaults(grounded), [], '迁移后应接地完好');
  assert.deepEqual(
    grounded.map((e) => [e.type, e.actor, e.target, e.round]),
    [
      ['roundStart', null, null, 1],
      ['peek', 'A', null, 1],
      ['bid', 'A', null, 1],
      ['bid', 'B', null, 1],
      ['challenge', 'C', 'B', 1],
      ['reveal', 'C', 'B', 1],
      ['roundEnd', null, null, 1],
    ],
  );
  // 不留第二个真相源：旧字段 player 迁移后就没了
  assert.ok(grounded.every((e) => !('player' in e)));
  // 幂等：已接地的流再过一遍不变
  assert.deepEqual(groundEvents(grounded), grounded);
});

test('G2 旧档迁移：活引擎的事件本就接地，过一遍迁移原样不动', async () => {
  const events = await scripted(5);
  assert.deepEqual(groundEvents(events), events);
});

test('G2 自查会咬人：主客体被改错时 groundingFaults 抓得住', async () => {
  const events = await scripted(5);
  const bad = events.map((e) => (e.type === 'challenge' ? { ...e, target: e.actor } : e));
  const faults = groundingFaults(bad);
  assert.ok(faults.length > 0, '把开牌对象改成开牌人自己，自查必须报错');
  assert.match(faults[0].fault, /谁开谁弄反|开了自己的价/);
  // 少一个字段也算故障
  assert.ok(groundingFaults(events.map(({ target, ...rest }) => rest)).some((f) => /缺字段 target/.test(f.fault)));
});
