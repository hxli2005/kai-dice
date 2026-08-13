import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beats, isLegalBid, allLegalBids, countBid, bidStands, legalFaces } from '../src/rules.js';
import { createMatch, commitmentOf, mulberry32, PLAYERS } from '../src/engine.js';

// ---------- 规则单元 ----------

test('阶梯：数量加大或同数量点数加大', () => {
  assert.ok(beats({ count: 3, face: 2 }, { count: 2, face: 6 }));
  assert.ok(beats({ count: 2, face: 5 }, { count: 2, face: 4 }));
  assert.ok(!beats({ count: 2, face: 4 }, { count: 2, face: 4 }));
  assert.ok(!beats({ count: 2, face: 3 }, { count: 2, face: 4 }));
  assert.ok(!beats({ count: 2, face: 6 }, { count: 3, face: 2 }));
});

test('首报数量 ≥ 2，数量不超总骰数，飞局禁报 1', () => {
  assert.ok(!isLegalBid({ count: 1, face: 6 }, null, false, 10));
  assert.ok(!isLegalBid({ count: 11, face: 6 }, null, false, 10));
  assert.ok(!isLegalBid({ count: 2, face: 1 }, null, false, 10)); // TODO(Q1)
  assert.ok(isLegalBid({ count: 2, face: 1 }, null, true, 10));
  assert.ok(isLegalBid({ count: 2, face: 2 }, null, false, 10));
});

test('清点：飞局 1 为万能，斋局关闭', () => {
  const all = [1, 1, 3, 3, 5, 2, 3, 6, 1, 4];
  assert.equal(countBid({ count: 4, face: 3 }, all, false), 6); // 3×3 + 3×1
  assert.equal(countBid({ count: 4, face: 3 }, all, true), 3);
  assert.ok(bidStands({ count: 6, face: 3 }, all, false));
  assert.ok(!bidStands({ count: 6, face: 3 }, all, true));
});

test('最小抬价 = 有序枚举首项', () => {
  assert.deepEqual(allLegalBids({ count: 2, face: 3 }, false, 10)[0], { count: 2, face: 4 });
  assert.deepEqual(allLegalBids({ count: 2, face: 6 }, false, 10)[0], { count: 3, face: 2 });
  assert.equal(allLegalBids({ count: 10, face: 6 }, false, 10).length, 0);
});

// ---------- 玩家接口与信息隔离 ----------

test('observe：快照带首报/报价数/看骰状态，但永不泄露对方骰面', async () => {
  const m = await createMatch({ seed: 7 });
  const obA = m.observe('A');
  assert.equal(obA.yourDice, null);
  assert.equal(obA.firstBidder, 'A');
  assert.equal(obA.bidCount, 0);
  assert.deepEqual(obA.peeked, { A: false, B: false });
  await m.act('A', { type: 'peek' });
  const afterPeek = m.observe('A');
  const dice = afterPeek.yourDice;
  assert.equal(dice.length, 5);
  assert.equal(afterPeek.peeked.A, true);
  assert.ok(!JSON.stringify(m.observe('B')).match(/"yourDice":\[/), 'B 未看骰不应有任何骰面');
  // 公开事件流里在摊牌前不含任何骰面
  for (const e of m.observe('B').events) assert.ok(e.type !== 'reveal');
});

test('宣盲后不可再看骰；看骰后不可宣盲', async () => {
  const m = await createMatch({ seed: 1 });
  await m.act('A', { type: 'declare', declaration: 'blind' });
  await assert.rejects(() => m.act('A', { type: 'peek' }), /illegal peek/);
  const m2 = await createMatch({ seed: 1 });
  await m2.act('A', { type: 'peek' });
  await assert.rejects(
    () => m2.act('A', { type: 'declare', declaration: 'blind' }),
    /illegal declare/,
  );
});

test('斋仅首报者可宣，且宣后 1 不为癞子', async () => {
  const m = await createMatch({ seed: 2 });
  await m.act('A', { type: 'declare', declaration: 'zhai' });
  await m.act('A', { type: 'bid', count: 2, face: 1 }); // 斋局可报 1
  await assert.rejects(
    () => m.act('B', { type: 'declare', declaration: 'zhai' }),
    /illegal declare/,
  );
});

test('非当前玩家不可行动；阶梯外报数被拒', async () => {
  const m = await createMatch({ seed: 3 });
  await assert.rejects(() => m.act('B', { type: 'bid', count: 2, face: 2 }), /illegal bid/);
  await m.act('A', { type: 'bid', count: 3, face: 4 });
  await assert.rejects(() => m.act('B', { type: 'bid', count: 3, face: 4 }), /bid off ladder/);
  await assert.rejects(() => m.act('B', { type: 'bid', count: 2, face: 6 }), /bid off ladder/);
});

test('Q22 抬：每人每局一次、全桌对等、倍率入结算', async () => {
  const m = await createMatch({ seed: 7 });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'declare', declaration: 'raise' });
  assert.ok(
    !m.observe('A').legal.some((a) => a.type === 'declare' && a.declaration === 'raise'),
    '同一局不可再抬',
  );
  await assert.rejects(() => m.act('A', { type: 'declare', declaration: 'raise' }), /illegal declare/);
  await m.act('A', { type: 'bid', count: 2, face: 3 });
  await m.act('B', { type: 'peek' });
  await m.act('B', { type: 'declare', declaration: 'raise' }); // 对等：B 也能抬
  await m.act('B', { type: 'challenge' });
  const re = m.observe('A').events.findLast((e) => e.type === 'roundEnd');
  assert.equal(re.mult, 4); // 双方各抬 ×2×2
  assert.equal(re.transfer, Math.round((1 + 1) * 4)); // units=底1+报1
});

test('Q22 深水线：第 6 手报价起池 ×2', async () => {
  const m = await createMatch({ seed: 11 });
  await m.act('A', { type: 'peek' });
  await m.act('B', { type: 'peek' });
  const ladder = [[2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [3, 2]];
  let p = 'A';
  for (const [count, face] of ladder) {
    await m.act(p, { type: 'bid', count, face });
    p = p === 'A' ? 'B' : 'A';
  }
  await m.act(p, { type: 'challenge' });
  const re = m.observe('A').events.findLast((e) => e.type === 'roundEnd');
  assert.equal(re.mult, 2);
  assert.equal(re.transfer, Math.round((1 + 6) * 2));
});

test('Q22 盲窗口放宽：报过数、只要没看骰仍可宣盲', async () => {
  const m = await createMatch({ seed: 13 });
  await m.act('A', { type: 'bid', count: 2, face: 4 }); // 裸报（未看骰）
  await m.act('B', { type: 'peek' });
  await m.act('B', { type: 'bid', count: 2, face: 5 });
  await m.act('A', { type: 'declare', declaration: 'blind' }); // 追认裸报
  await assert.rejects(() => m.act('A', { type: 'peek' }), /illegal peek/);
  const o = m.observe('A');
  assert.equal(o.potMult, 2);
  assert.ok(o.raises && o.blind.A === true);
});

test('计算工具从所有模式删除：无动作、无状态、无事件，旧动作直接拒绝', async () => {
  const m = await createMatch({ seed: 3 });
  const o = m.observe('A');
  assert.ok(!Object.hasOwn(o, 'calced'));
  assert.ok(!o.legal.some((a) => a.type === 'calc'));
  await assert.rejects(() => m.act('A', { type: 'calc' }), /illegal calc/);
  assert.ok(!m.observe('A').events.some((e) => e.type === 'calc'));
});

test('startChips 支持 {A,B} 不对称初始（跨场账本）', async () => {
  const m = await createMatch({ seed: 1, config: { startChips: { A: 37, B: -5 } } });
  const o = m.observe('A');
  assert.equal(o.chips.you, 37);
  assert.equal(o.chips.opp, -5);
});

// ---------- 自对弈：随机合法 bot 互打，验证全局不变量 ----------

async function selfPlay(seed) {
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const m = await createMatch({ seed });
  const actions = [];
  for (let step = 0; step < 10_000; step++) {
    const ob = PLAYERS.map((p) => m.observe(p)).find((o) => o.legal.length > 0);
    if (!ob) break;
    const p = ob.you;
    let a = pick(ob.legal);
    if (a.type === 'bid') {
      const bids = allLegalBids(ob.currentBid, ob.zhai, ob.diceCount.you + ob.diceCount.opp);
      a = { type: 'bid', ...pick(bids) };
    }
    await m.act(p, a, { elapsedMs: Math.floor(rng() * 20000) });
    actions.push({ p, a });
  }
  const final = m.observe('A');
  assert.ok(final.over, `seed ${seed}: 对局未终止`);
  return { events: final.events, actions };
}

test('自对弈 200 场：终止、守恒、判定、承诺全部成立', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { events } = await selfPlay(seed);
    const commits = {};
    let bids = 0;
    let declares = { blindA: false, blindB: false, zhai: false, raiseA: false, raiseB: false };
    let diceCount = null;
    for (const e of events) {
      if (e.type === 'roundStart') {
        commits.A = e.commits.A;
        commits.B = e.commits.B;
        bids = 0;
        declares = { blindA: false, blindB: false, zhai: false, raiseA: false, raiseB: false };
        diceCount = e.diceCount;
      }
      if (e.type === 'bid') bids++;
      if (e.type === 'declare') {
        if (e.declaration === 'zhai') declares.zhai = true;
        else if (e.declaration === 'raise') declares[`raise${e.actor}`] = true;
        else declares[`blind${e.actor}`] = true;
      }
      if (e.type === 'reveal') {
        // 骰面数量与承诺一致
        assert.equal(e.dice.A.length, diceCount.A);
        assert.equal(e.dice.B.length, diceCount.B);
        assert.equal(await commitmentOf(e.dice.A, e.nonces.A), commits.A, '承诺哈希 A');
        assert.equal(await commitmentOf(e.dice.B, e.nonces.B), commits.B, '承诺哈希 B');
        // 开牌判定可独立复算
        const all = [...e.dice.A, ...e.dice.B];
        assert.equal(e.stands, bidStands(e.bid, all, e.zhai));
        assert.equal(e.actual, countBid(e.bid, all, e.zhai));
      }
      if (e.type === 'roundEnd') {
        // 注池：单方投入 × 赔率（盲/抬/斋/深水线 Q22），零和转移
        const mult =
          2 ** (declares.blindA ? 1 : 0) * 2 ** (declares.blindB ? 1 : 0) *
          2 ** (declares.raiseA ? 1 : 0) * 2 ** (declares.raiseB ? 1 : 0) *
          (declares.zhai ? 1.5 : 1) * (bids >= 6 ? 2 : 1);
        assert.equal(e.transfer, Math.round((1 + bids) * mult));
        assert.equal(e.chips.A + e.chips.B, 200, '筹码守恒');
        assert.equal(e.diceCount.A + e.diceCount.B, diceCount.A + diceCount.B - 1, '每局掉一骰');
      }
      if (e.type === 'matchEnd') {
        assert.equal(e.chips.A + e.chips.B, 200);
      }
    }
    assert.equal(events.at(-1).type, 'matchEnd');
  }
});

test('决定性回放：同种子同动作 → 事件流逐字节一致（§4.1）', async () => {
  const { events, actions } = await selfPlay(42);
  const m = await createMatch({ seed: 42 });
  for (const { p, a } of actions) await m.act(p, a);
  const replayed = m.observe('A').events;
  assert.equal(replayed.length, events.length);
  for (let k = 0; k < events.length; k++) {
    const { elapsedMs: _a, ...orig } = events[k];
    const { elapsedMs: _b, ...rep } = replayed[k];
    assert.deepEqual(rep, orig, `事件 ${k} 不一致`);
  }
});
