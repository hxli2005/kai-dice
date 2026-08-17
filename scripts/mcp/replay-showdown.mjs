#!/usr/bin/env node

// 决定性重放核验：seed ＋ 已接受动作序列 → 引擎重放 → 与归档事件逐项 diff。
// 兼容两种 run.json：schemaVersion 1 单场（顶层 events）与 BO 系列（games[] 逐场）。
// 退出码 0 ＝ 全部一致；1 ＝ 存在分歧或重放抛错。
//
// 用法：node scripts/mcp/replay-showdown.mjs <run-dir|run.json> [...]

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createMatch } from '../../src/engine.js';

function normalizeRunFile(input) {
  const resolved = path.resolve(input);
  return path.extname(resolved).toLowerCase() === '.json' ? resolved : path.join(resolved, 'run.json');
}

async function replayGame({ seed, firstSeat, startDice, decisions }) {
  const players = firstSeat === 'A' ? ['A', 'B'] : ['B', 'A'];
  const match = await createMatch({ seed, config: { players, startDice } });
  for (const decision of decisions) {
    await match.act(decision.seat, decision.action, { elapsedMs: decision.thinkMs });
  }
  return match.observe('A').events;
}

function diffEvents(archived, replayed) {
  const total = Math.max(archived.length, replayed.length);
  for (let i = 0; i < total; i += 1) {
    if (JSON.stringify(archived[i] ?? null) !== JSON.stringify(replayed[i] ?? null)) {
      return { index: i, archived: archived[i] ?? null, replayed: replayed[i] ?? null };
    }
  }
  return null;
}

export async function verifyRun(input) {
  const runFile = normalizeRunFile(input);
  const snapshot = JSON.parse(readFileSync(runFile, 'utf8'));
  const startDice = snapshot.startDice ?? 5;
  const decisions = snapshot.decisions ?? [];
  const games = snapshot.games?.length
    ? snapshot.games.map((game) => ({
      game: game.game,
      seed: game.seed,
      firstSeat: game.firstSeat,
      events: game.events,
      decisions: decisions.filter((decision) => (decision.game ?? 1) === game.game),
    }))
    : [{
      game: 1,
      seed: snapshot.seed,
      firstSeat: snapshot.events.find((event) => event.type === 'roundStart')?.first ?? 'A',
      events: snapshot.events,
      decisions,
    }];

  const results = [];
  for (const game of games) {
    let replayed;
    let error = null;
    try {
      replayed = await replayGame({ seed: game.seed, firstSeat: game.firstSeat, startDice, decisions: game.decisions });
    } catch (cause) {
      error = cause?.message ?? String(cause);
    }
    const firstDiff = error == null ? diffEvents(game.events, replayed) : null;
    results.push({
      game: game.game,
      seed: game.seed,
      firstSeat: game.firstSeat,
      archivedEvents: game.events.length,
      replayedEvents: replayed?.length ?? 0,
      consistent: error == null && firstDiff == null,
      ...(error != null ? { error } : {}),
      ...(firstDiff != null ? { firstDiff } : {}),
    });
  }
  return { runFile, consistent: results.every((result) => result.consistent), games: results };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    process.stderr.write('usage: node scripts/mcp/replay-showdown.mjs <run-dir|run.json> [...]\n');
    process.exit(2);
  }
  let allConsistent = true;
  for (const input of inputs) {
    const verdict = await verifyRun(input);
    allConsistent &&= verdict.consistent;
    process.stdout.write(`${verdict.runFile}\n`);
    for (const game of verdict.games) {
      const status = game.consistent ? 'OK' : 'MISMATCH';
      process.stdout.write(`  game ${game.game} (seed ${game.seed}, first ${game.firstSeat}): ${game.replayedEvents}/${game.archivedEvents} events → ${status}\n`);
      if (game.error) process.stdout.write(`    replay error: ${game.error}\n`);
      if (game.firstDiff) process.stdout.write(`    first diff @${game.firstDiff.index}\n`);
    }
  }
  process.exit(allConsistent ? 0 : 1);
}
