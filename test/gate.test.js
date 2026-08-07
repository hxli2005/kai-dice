// 上线门禁（DESIGN 附B.2）：AI 不许被无脑策略稳定击穿。
// 清单 bot：永远开 / 从不虚报 / 复读机 / 纯随机。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allLegalBids, countBid } from '../src/rules.js';
import { probBidTrue } from '../src/probability.js';
import { createMatch, mulberry32, PLAYERS } from '../src/engine.js';
import { createSilentBot } from '../src/ai/silent.js';

const minRaise = (ob) =>
  allLegalBids(ob.currentBid, ob.zhai, ob.diceCount.you + ob.diceCount.opp)[0];

// 清单 bot 均先看骰（decide 在 yourDice 为 null 时返回 peek）
const withPeek = (decide) => (ob) => (ob.yourDice === null ? { type: 'peek' } : decide(ob));

const checklist = {
  alwaysChallenge: withPeek((ob) =>
    ob.currentBid ? { type: 'challenge' } : { type: 'bid', ...minRaise(ob) },
  ),
  neverBluff: withPeek((ob) => {
    const bids = allLegalBids(ob.currentBid, ob.zhai, ob.diceCount.you + ob.diceCount.opp);
    const honest = bids.find((b) => countBid(b, ob.yourDice, ob.zhai) >= b.count);
    if (honest) return { type: 'bid', ...honest };
    return ob.currentBid ? { type: 'challenge' } : { type: 'bid', ...minRaise(ob) };
  }),
  parrot: withPeek((ob) => {
    const b = minRaise(ob);
    return b ? { type: 'bid', ...b } : { type: 'challenge' };
  }),
  random: (rng) => (ob) => {
    if (ob.yourDice === null) return { type: 'peek' };
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const a = pick(ob.legal.filter((x) => x.type !== 'peek' && x.type !== 'declare'));
    if (a.type !== 'bid') return a;
    return {
      type: 'bid',
      ...pick(allLegalBids(ob.currentBid, ob.zhai, ob.diceCount.you + ob.diceCount.opp)),
    };
  },
};

export async function runMatch(seed, decideA, decideB) {
  const m = await createMatch({ seed });
  const decide = { A: decideA, B: decideB };
  for (let step = 0; step < 10_000; step++) {
    const ob = PLAYERS.map((p) => m.observe(p)).find((o) => o.turn === o.you && !o.over);
    if (!ob) break;
    await m.act(ob.you, decide[ob.you](ob));
  }
  const final = m.observe('A');
  assert.ok(final.over);
  return final.events.at(-1).winner;
}

async function winRate(makeOpponent, games = 100) {
  let wins = 0;
  for (let seed = 1; seed <= games; seed++) {
    const bot = createSilentBot();
    // 轮换先后手，消除位置偏差
    const silentAs = seed % 2 === 0 ? 'A' : 'B';
    const oppDecide = makeOpponent(mulberry32(seed * 31));
    const winner =
      silentAs === 'A'
        ? await runMatch(seed, (ob) => bot.decide(ob), oppDecide)
        : await runMatch(seed, oppDecide, (ob) => bot.decide(ob));
    if (winner === silentAs) wins++;
  }
  return wins / games;
}

test('门禁：沉默 bot 不被清单 bot 稳定击穿（胜率 ≥ 50%）', async () => {
  for (const [name, make] of Object.entries(checklist)) {
    const makeOpp = name === 'random' ? make : () => make;
    const rate = await winRate(makeOpp);
    assert.ok(rate >= 0.5, `${name}: 胜率 ${rate} < 0.5`);
  }
});

test('概率计算器：边界与已知值', () => {
  // 我 5 骰全是 3，报 5 个 3 必真
  assert.equal(probBidTrue({ count: 5, face: 3 }, [3, 3, 3, 3, 3], 5, false), 1);
  // 需要对方 6 个匹配但对方只有 5 颗 → 0
  assert.equal(probBidTrue({ count: 6, face: 3 }, [2, 2, 4, 4, 5], 5, true), 0);
  // 飞局单颗匹配率 1/3：需对方 5 颗中至少 1 个 → 1 - (2/3)^5
  const p = probBidTrue({ count: 1, face: 3 }, [], 5, false);
  assert.ok(Math.abs(p - (1 - (2 / 3) ** 5)) < 1e-12);
  // 斋局报 1 单颗匹配率 1/6
  const p1 = probBidTrue({ count: 1, face: 1 }, [], 1, true);
  assert.ok(Math.abs(p1 - 1 / 6) < 1e-12);
});
