import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine.js';
import { toTubeView } from '../src/ui/tubes.js';

test('三管机视图只映射 observe 公开事实，不泄露对手暗骰', async () => {
  const match = await createMatch({ seed: 17 });
  const snapshot = match.observe('A');
  const view = toTubeView(snapshot, {
    opponentName: '一号机',
    selectedBid: { count: 2, face: 2 },
  });

  assert.equal(view.opponentName, '一号机');
  assert.equal(view.myDice, null);
  assert.equal(view.oppDiceCount, 5);
  assert.deepEqual(view.oppShown, []);
  assert.equal(view.seal.length, 8);
  assert.equal(view.pot, 2);
  assert.equal(view.potEffective, 2);
  assert.equal(view.stakePerSeat, 1);
  assert.deepEqual(view.chips, { upper: 100, lower: 100 });
  assert.equal(view.legal.peek, true);
  assert.equal(view.legal.bid, true);
  assert.deepEqual(view.legal.faces, [2, 3, 4, 5, 6]);
  assert.equal(view.legal.countDown, false);
  assert.equal(view.legal.countUp, true);
  assert.equal(view.legal.open, false);
  assert.equal(JSON.stringify(view).includes('nonces'), false);
});

test('三管机筹码坞保留负账本符号，不把欠筹美化成零', async () => {
  const match = await createMatch({ seed: 19, config: { startChips: { A: -44, B: 44 } } });
  const view = toTubeView(match.observe('A'));

  assert.deepEqual(view.chips, { upper: 44, lower: -44 });
  assert.equal(view.chips.upper - view.stakePerSeat, 43);
  assert.equal(view.chips.lower - view.stakePerSeat, -45);
});

test('三管机视图跟随真实报价、倍率与行动权', async () => {
  const match = await createMatch({ seed: 23 });
  await match.act('A', { type: 'peek' });
  await match.act('A', { type: 'declare', declaration: 'raise' });
  await match.act('A', { type: 'bid', count: 2, face: 4 });

  const view = toTubeView(match.observe('A'), {
    selectedBid: { count: 2, face: 5 },
    busy: false,
  });
  assert.deepEqual(view.currentBid, { player: 'A', count: 2, face: 4 });
  assert.deepEqual(view.selectedBid, { count: 2, face: 5 });
  assert.equal(view.myDice.length, 5);
  assert.equal(view.pot, 4);
  assert.equal(view.potEffective, 8);
  assert.equal(view.potMult, 2);
  assert.equal(view.stakePerSeat, 4);
  assert.equal(view.fuse, 1);
  assert.equal(view.declarations.raise, true);
  assert.equal(view.myTurn, false);

  const stagedTotal = view.chips.upper - view.stakePerSeat
    + view.chips.lower - view.stakePerSeat
    + view.potEffective;
  assert.equal(stagedTotal, view.chips.upper + view.chips.lower);

  await match.act('B', { type: 'challenge' });
  const after = match.observe('A');
  const roundEnd = after.events.findLast((event) => event.type === 'roundEnd');
  assert.equal(Math.abs(roundEnd.transfers[roundEnd.winner]), view.stakePerSeat);
  const beforeWinner = roundEnd.winner === 'A' ? view.chips.lower : view.chips.upper;
  const expectedWinner = beforeWinner - view.stakePerSeat + view.potEffective;
  assert.equal(after.players.find((p) => p.id === roundEnd.winner).chips, expectedWinner);
});

test('三管机托管池包含所有存活席，三人桌入池与结算守恒', async () => {
  const match = await createMatch({ seed: 31, config: { players: ['A', 'B', 'C'] } });
  await match.act('A', { type: 'bid', count: 2, face: 4 });
  const before = match.observe('A');
  const view = toTubeView(before);

  assert.equal(view.pot, 6); // 2 个基础池单位 × 3 个存活席
  assert.equal(view.potEffective, 6);
  assert.equal(view.stakePerSeat, 2);
  const staged = before.players.reduce((sum, p) => sum + p.chips - view.stakePerSeat, 0) + view.potEffective;
  assert.equal(staged, before.players.reduce((sum, p) => sum + p.chips, 0));
  await match.act('B', { type: 'challenge' });
  const after = match.observe('A');
  const roundEnd = after.events.findLast((event) => event.type === 'roundEnd');
  assert.equal(roundEnd.transfers[roundEnd.winner], view.stakePerSeat * 2);
  const expectedWinner = before.players.find((p) => p.id === roundEnd.winner).chips - view.stakePerSeat + view.potEffective;
  assert.equal(after.players.find((p) => p.id === roundEnd.winner).chips, expectedWinner);
});
