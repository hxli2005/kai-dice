import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyzeShowdown } from '../scripts/mcp/analyze-showdown.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const analyzer = path.resolve(here, '../scripts/mcp/analyze-showdown.mjs');

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kai-analysis-test-'));
  const run = {
    schemaVersion: 1,
    seed: 42,
    bestOf: 3,
    over: true,
    winner: 'A',
    series: {
      bestOf: 3,
      winsNeeded: 2,
      wins: { A: 2, B: 0 },
      over: true,
      winner: 'A',
    },
    games: [
      { game: 1, seed: 42, firstSeat: 'A', winner: 'A', rounds: 1 },
      { game: 2, seed: 43, firstSeat: 'B', winner: 'A', rounds: 1 },
    ],
    decisions: [
      { id: 0, seat: 'A', game: 1, round: 1, action: { type: 'peek' }, belief: '', say: '', note: '' },
      { id: 1, seat: 'A', game: 1, round: 1, action: { type: 'bid', count: 2, face: 4 }, belief: '', say: '', note: '' },
      { id: 2, seat: 'B', game: 1, round: 1, action: { type: 'challenge' }, belief: '', say: '', note: '' },
      { id: 3, seat: 'B', game: 2, round: 1, action: { type: 'bid', count: 3, face: 5 }, belief: '', say: '', note: '' },
      {
        id: 4,
        seat: 'A',
        game: 2,
        round: 1,
        action: { type: 'challenge' },
        belief: 'Unlike game 1, this bid is unsupported.',
        say: '',
        note: '',
      },
    ],
    rejections: [
      { id: 0, seat: 'B', game: 1, code: 'STALE_STATE' },
      { id: 1, seat: 'A', game: 2, code: 'ILLEGAL_ACTION' },
      { id: 2, seat: 'B', game: 1, code: 'STALE_STATE' },
    ],
    dialogue: [{ id: 0 }],
    events: [
      { i: 0, game: 1, round: 1, type: 'roundStart', first: 'A' },
      { i: 1, game: 1, round: 1, type: 'challenge', actor: 'B' },
      {
        i: 2, game: 1, round: 1, type: 'reveal', challenger: 'B',
        bid: { player: 'A', count: 2, face: 4 }, actual: 2, stands: true, loser: 'B',
      },
      { i: 3, game: 1, round: 1, type: 'roundEnd', winner: 'A', loser: 'B' },
      { i: 4, game: 1, round: 1, type: 'matchEnd', winner: 'A' },
      { i: 5, game: 2, round: 1, type: 'roundStart', first: 'B' },
      { i: 6, game: 2, round: 1, type: 'challenge', actor: 'A' },
      {
        i: 7, game: 2, round: 1, type: 'reveal', challenger: 'A',
        bid: { player: 'B', count: 3, face: 5 }, actual: 2, stands: false, loser: 'B',
      },
      { i: 8, game: 2, round: 1, type: 'roundEnd', winner: 'A', loser: 'B' },
      { i: 9, game: 2, round: 1, type: 'matchEnd', winner: 'A' },
    ],
  };
  writeFileSync(path.join(directory, 'run.json'), `${JSON.stringify(run)}\n`);
  writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({
    codex: { seat: 'A', model: 'gpt-test' },
    claude: { seat: 'B', model: 'claude-test' },
    labels: { A: 'Codex test', B: 'Claude test' },
  }));
  writeFileSync(path.join(directory, 'codex.jsonl'), [
    JSON.stringify({ type: 'thread.started' }),
    '{malformed',
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10, reasoning_output_tokens: 4 },
    }),
  ].join('\n'));
  writeFileSync(path.join(directory, 'claude.jsonl'), [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({
      type: 'result',
      total_cost_usd: 1.25,
      usage: { input_tokens: 2, cache_read_input_tokens: 50, output_tokens: 20 },
      modelUsage: { 'claude-test': { costUSD: 1.25 } },
    }),
  ].join('\n'));
  return directory;
}

test('showdown 分析器机械统计系列、动作、challenge 结果、跨局明示引用与原始 usage', async (t) => {
  const directory = fixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const analysis = await analyzeShowdown(directory);
  assert.deepEqual(analysis.series, {
    seed: 42,
    bestOf: 3,
    winsNeeded: 2,
    over: true,
    winner: 'A',
    wins: { A: 2, B: 0 },
    gamesCompleted: 2,
    gamesObserved: 2,
  });
  assert.equal(analysis.totals.acceptedActions, 5);
  assert.equal(analysis.totals.rejections, 3);
  assert.deepEqual(analysis.totals.rejectionCodes, { STALE_STATE: 2, ILLEGAL_ACTION: 1 });
  assert.equal(analysis.totals.rejectionPatterns, 2);
  assert.equal(analysis.totals.repeatedRejectionAttempts, 1);
  assert.equal(analysis.rejectionPatterns[0].attempts, 2);
  assert.equal(analysis.totals.rounds, 2);
  assert.deepEqual(analysis.games.map((game) => [game.rounds, game.acceptedActions]), [[1, 3], [1, 2]]);
  assert.deepEqual(analysis.participants.seats, {
    A: { label: 'Codex test', agent: 'codex' },
    B: { label: 'Claude test', agent: 'claude' },
  });

  assert.equal(analysis.seats.A.bids, 1);
  assert.equal(analysis.seats.A.challenges, 1);
  assert.equal(analysis.seats.A.challengeHits, 1);
  assert.equal(analysis.seats.A.challengeAccuracy, 1);
  assert.equal(analysis.seats.B.challenges, 1);
  assert.equal(analysis.seats.B.challengeMisses, 1);
  assert.equal(analysis.seats.B.challengeAccuracy, 0);

  assert.equal(analysis.crossGameExplicitReferences.total, 1);
  assert.equal(analysis.crossGameExplicitReferences.bySeat.A, 1);
  assert.match(analysis.crossGameExplicitReferences.heuristic.interpretation, /cannot prove memory use/);
  assert.equal(analysis.crossGameExplicitReferences.matches[0].decisionId, 4);

  assert.equal(analysis.usage.codex.extracted, true);
  assert.equal(analysis.usage.codex.parseErrors, 1);
  assert.equal(analysis.usage.codex.usage.reasoning_output_tokens, 4);
  assert.equal(analysis.usage.codex.configuredSeat, 'A');
  assert.equal(analysis.usage.codex.configuredModel, 'gpt-test');
  assert.equal(analysis.usage.claude.costUsd, 1.25);
  assert.deepEqual(analysis.usage.claude.modelUsage, { 'claude-test': { costUSD: 1.25 } });
});

test('showdown 分析 CLI 默认输出 stdout，--out 只新建且拒绝覆盖', (t) => {
  const directory = fixture();
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const stdoutRun = spawnSync(process.execPath, [analyzer, directory], { encoding: 'utf8' });
  assert.equal(stdoutRun.status, 0, stdoutRun.stderr);
  assert.equal(JSON.parse(stdoutRun.stdout).series.winner, 'A');
  assert.equal(stdoutRun.stderr, '');

  const output = path.join(directory, 'mechanical-analysis.json');
  const firstWrite = spawnSync(process.execPath, [analyzer, directory, '--out', output], { encoding: 'utf8' });
  assert.equal(firstWrite.status, 0, firstWrite.stderr);
  const original = readFileSync(output, 'utf8');
  const overwrite = spawnSync(process.execPath, [analyzer, directory, '--out', output], { encoding: 'utf8' });
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /EEXIST/);
  assert.equal(readFileSync(output, 'utf8'), original);
});
