import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMatch } from '../src/engine.js';
import { SETTLEMENT_HOLD_MS, toTubeView } from '../src/ui/tubes.js';

test('三管机开牌结算保留足够阅读时间，且不受动画加速影响', () => {
  const tubes = fs.readFileSync(new URL('../src/ui/tubes.js', import.meta.url), 'utf8');

  assert.equal(SETTLEMENT_HOLD_MS, 3000);
  assert.match(tubes, /phase = 'settle';\s*timeScale = 1;\s*\/\/[^\n]*\n\s*await new Promise\(\(resolve\) => setTimeout\(resolve, SETTLEMENT_HOLD_MS\)\)/);
  assert.doesNotMatch(tubes, /await scaledWait\(700\);\s*phase = 'settle'/);
});

test('三管机 AI 台词使用完整可滚动 DOM 层，不再塞进两行 Canvas 分页', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  const tubes = fs.readFileSync(new URL('../src/ui/tubes.js', import.meta.url), 'utf8');

  assert.match(html, /id="tubeSpeech"[^>]*data-raw/);
  assert.match(css, /\.tube-speech\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.tube-speech\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(tubes, /speechEl\.textContent = speech\.shown/);
  assert.match(tubes, /speechEl\.scrollTop = speechEl\.scrollHeight/);
  assert.doesNotMatch(tubes, /all\.slice\(-2\)/);
  assert.doesNotMatch(tubes, /terminalPage\(\)/);
});

test('普通与三人气泡限制高度、允许滚动和任意换行', () => {
  const css = fs.readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  for (const selector of ['.bubble', '.strip-bubble']) {
    const body = css.match(new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';
    assert.match(body, /max-height:/, selector);
    assert.match(body, /overflow-y:\s*auto/, selector);
    assert.match(body, /overflow-wrap:\s*anywhere/, selector);
    assert.match(body, /white-space:\s*pre-wrap/, selector);
  }
});

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
