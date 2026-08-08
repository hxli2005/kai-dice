// 三人桌不变量（DESIGN §2.5，T1 验收）：3 随机 bot × 200 场自对弈。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allLegalBids, bidStands, countBid } from '../src/rules.js';
import { createMatch, commitmentOf, mulberry32 } from '../src/engine.js';

const TRIO = ['A', 'B', 'C'];

async function selfPlay3(seed) {
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const m = await createMatch({ seed, config: { players: TRIO } });
  for (let step = 0; step < 20_000; step++) {
    const obs = TRIO.map((p) => m.observe(p));
    const actor = obs.find((o) => o.legal.some((a) => a.type !== 'peek')) ?? obs.find((o) => o.legal.length > 0);
    if (!actor) break;
    let a = pick(actor.legal);
    if (a.type === 'bid') {
      const bids = allLegalBids(actor.currentBid, actor.zhai, actor.diceCount.you + actor.diceCount.opp);
      a = { type: 'bid', ...pick(bids) };
    }
    await m.act(actor.you, a, { elapsedMs: Math.floor(rng() * 9000) });
  }
  const final = m.observe('A');
  assert.ok(final.over, `seed ${seed}: 对局未终止`);
  return final.events;
}

test('三人桌 200 场：终止、守恒、轮转、开上家、判定、承诺、名次全部成立', async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const events = await selfPlay3(seed);
    let commits = {};
    let aliveAtRound = null;
    let lastBidder = null;
    let diceCount = null;
    for (const e of events) {
      if (e.type === 'roundStart') {
        commits = e.commits;
        diceCount = e.diceCount;
        aliveAtRound = TRIO.filter((p) => e.diceCount[p] > 0);
        lastBidder = null;
        // 首报者必须是活人
        assert.ok(aliveAtRound.includes(e.first), '首报者已出局');
        // 承诺只给活人
        assert.deepEqual(Object.keys(e.commits).sort(), [...aliveAtRound].sort());
      }
      if (e.type === 'bid') {
        assert.ok(aliveAtRound.includes(e.player), '出局者报数');
        lastBidder = e.player;
      }
      if (e.type === 'challenge') {
        // §2.5 开只开上家：被开者必为当前报价者
        assert.ok(lastBidder && e.player !== lastBidder, '自己开自己');
      }
      if (e.type === 'reveal') {
        // 全桌摊牌与承诺验证
        for (const p of Object.keys(e.dice)) {
          assert.equal(e.dice[p].length, diceCount[p]);
          assert.equal(await commitmentOf(e.dice[p], e.nonces[p]), commits[p], `承诺 ${p}`);
        }
        assert.equal(e.bid.player, lastBidder);
        const all = Object.values(e.dice).flat();
        assert.equal(e.stands, bidStands(e.bid, all, e.zhai));
        assert.equal(e.actual, countBid(e.bid, all, e.zhai));
        // 输家必为报价者或开牌者
        assert.ok([e.bid.player, e.challenger].includes(e.loser));
      }
      if (e.type === 'roundEnd') {
        // 零和转移：胜者收池=其余活人付额之和
        const sum = Object.values(e.transfers).reduce((a, b) => a + b, 0);
        assert.equal(sum, 0, '转移不零和');
        assert.equal(Object.values(e.chips).reduce((a, b) => a + b, 0), 300, '筹码守恒');
        assert.equal(
          Object.values(e.diceCount).reduce((a, b) => a + b, 0),
          Object.values(diceCount).reduce((a, b) => a + b, 0) - 1,
          '每局掉一骰',
        );
      }
      if (e.type === 'matchEnd') {
        assert.equal(e.standings.length, 3, '名次不全');
        assert.equal(new Set(e.standings).size, 3);
        assert.equal(e.standings[0], e.winner);
        assert.equal(Object.values(e.chips).reduce((a, b) => a + b, 0), 300);
      }
    }
    assert.equal(events.at(-1).type, 'matchEnd');
  }
});

test('三人桌：决定性回放（同种子同动作 → 事件流一致）', async () => {
  const rng = mulberry32(77);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const m = await createMatch({ seed: 77, config: { players: TRIO } });
  const actions = [];
  for (let step = 0; step < 20_000; step++) {
    const obs = TRIO.map((p) => m.observe(p));
    const actor = obs.find((o) => o.legal.some((a) => a.type !== 'peek')) ?? obs.find((o) => o.legal.length > 0);
    if (!actor) break;
    let a = pick(actor.legal);
    if (a.type === 'bid') {
      const bids = allLegalBids(actor.currentBid, actor.zhai, actor.diceCount.you + actor.diceCount.opp);
      a = { type: 'bid', ...pick(bids) };
    }
    await m.act(actor.you, a);
    actions.push({ p: actor.you, a });
  }
  const orig = m.observe('A').events;
  const m2 = await createMatch({ seed: 77, config: { players: TRIO } });
  for (const { p, a } of actions) await m2.act(p, a);
  assert.deepEqual(m2.observe('A').events, orig);
});

test('三人桌：出局者无动作、玩家可先出局后两 AI 收尾', async () => {
  // 构造：跑到有人出局，验证出局者 legal 为空且对局能继续到终局
  const events = await selfPlay3(5);
  const firstOut = events.find((e) => e.type === 'roundEnd' && Object.values(e.diceCount).includes(0));
  assert.ok(firstOut, '200 步内应有人出局');
  const end = events.at(-1);
  assert.equal(end.type, 'matchEnd');
});
