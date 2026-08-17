#!/usr/bin/env node

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const SEATS = ['A', 'B'];
const ACTION_TYPES = ['peek', 'declare', 'bid', 'challenge'];

const PRIOR_GAME_MARKERS = [
  { label: 'game N', source: '\\bgame\\s+(?:1|one|i)\\b', flags: 'iu' },
  { label: 'prior-game phrase', source: '\\b(?:previous|prior|last|earlier|first)\\s+(?:game|match)\\b', flags: 'iu' },
  { label: 'Chinese prior-game phrase', source: '(?:上一|前一|第一)(?:场|局)', flags: 'u' },
];

function emptyActionCounts() {
  return Object.fromEntries(ACTION_TYPES.map((type) => [type, 0]));
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key == null || key === '' ? 'unknown' : String(key)] =
      (counts[key == null || key === '' ? 'unknown' : String(key)] ?? 0) + 1;
  }
  return counts;
}

function rejectionPatterns(rejections) {
  const patterns = new Map();
  for (const rejection of rejections) {
    const key = JSON.stringify([
      rejection?.seat ?? null,
      gameOf(rejection),
      rejection?.stateId ?? null,
      rejection?.code ?? null,
      rejection?.message ?? null,
      rejection?.action ?? null,
    ]);
    const existing = patterns.get(key);
    if (existing) {
      existing.attempts += 1;
      existing.lastRejectedAt = rejection?.rejectedAt ?? existing.lastRejectedAt;
      continue;
    }
    patterns.set(key, {
      seat: rejection?.seat ?? null,
      game: gameOf(rejection),
      stateId: rejection?.stateId ?? null,
      code: rejection?.code ?? null,
      message: rejection?.message ?? null,
      action: rejection?.action ?? null,
      attempts: 1,
      firstRejectedAt: rejection?.rejectedAt ?? null,
      lastRejectedAt: rejection?.rejectedAt ?? null,
    });
  }
  return [...patterns.values()].sort((a, b) => b.attempts - a.attempts);
}

function actionCounts(decisions) {
  const counts = emptyActionCounts();
  for (const decision of decisions) {
    const type = decision?.action?.type;
    if (Object.hasOwn(counts, type)) counts[type] += 1;
    else counts.other = (counts.other ?? 0) + 1;
  }
  return counts;
}

function gameOf(item) {
  return Number.isInteger(item?.game) ? item.game : 1;
}

function findExplicitPriorGameReferences(decisions) {
  const matches = [];
  for (const decision of decisions) {
    if (gameOf(decision) <= 1) continue;
    const matchedFields = [];
    const labels = new Set();
    for (const field of ['belief', 'say', 'note']) {
      const text = String(decision?.[field] ?? '');
      const fieldLabels = PRIOR_GAME_MARKERS
        .filter((marker) => new RegExp(marker.source, marker.flags).test(text))
        .map((marker) => marker.label);
      if (!fieldLabels.length) continue;
      matchedFields.push({ field, excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 240) });
      for (const label of fieldLabels) labels.add(label);
    }
    if (matchedFields.length) {
      matches.push({
        decisionId: decision.id ?? null,
        seat: decision.seat ?? null,
        game: gameOf(decision),
        round: decision.round ?? null,
        markers: [...labels],
        fields: matchedFields,
      });
    }
  }
  return {
    heuristic: {
      name: 'explicit-prior-game-markers-v1',
      scope: 'belief/say/note on accepted decisions in game 2 or later',
      markers: PRIOR_GAME_MARKERS.map(({ label, source }) => ({ label, pattern: source })),
      interpretation: 'Counts explicit textual mentions only; it cannot prove memory use or detect implicit adaptation.',
    },
    total: matches.length,
    bySeat: Object.fromEntries(SEATS.map((seat) => [seat, matches.filter((item) => item.seat === seat).length])),
    matches,
  };
}

async function scanJsonLines(file, select) {
  let lines = 0;
  let parseErrors = 0;
  let selected = null;
  const stream = createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    lines += 1;
    try {
      const value = JSON.parse(line);
      const candidate = select(value);
      if (candidate != null) selected = candidate;
    } catch {
      parseErrors += 1;
    }
  }
  return { lines, parseErrors, selected };
}

async function extractUsage(runDirectory, metadata) {
  const specs = [
    {
      agent: 'codex',
      filename: 'codex.jsonl',
      select(value) {
        if (value?.type !== 'turn.completed' || value.usage == null) return null;
        return { recordType: value.type, usage: value.usage };
      },
    },
    {
      agent: 'claude',
      filename: 'claude.jsonl',
      select(value) {
        if (value?.type !== 'result' || value.usage == null) return null;
        return {
          recordType: value.type,
          usage: value.usage,
          ...(typeof value.total_cost_usd === 'number' ? { costUsd: value.total_cost_usd } : {}),
          ...(value.modelUsage != null ? { modelUsage: value.modelUsage } : {}),
        };
      },
    },
  ];

  const out = {};
  for (const spec of specs) {
    const file = path.join(runDirectory, spec.filename);
    if (!existsSync(file)) {
      out[spec.agent] = { present: false, file };
      continue;
    }
    const scanned = await scanJsonLines(file, spec.select);
    out[spec.agent] = {
      present: true,
      file,
      lines: scanned.lines,
      parseErrors: scanned.parseErrors,
      extracted: scanned.selected != null,
      ...(SEATS.includes(metadata?.[spec.agent]?.seat) ? { configuredSeat: metadata[spec.agent].seat } : {}),
      ...(metadata?.[spec.agent]?.model != null ? { configuredModel: metadata[spec.agent].model } : {}),
      ...(scanned.selected ?? {}),
    };
  }
  return out;
}

function challengeOutcomes(events) {
  return events
    .filter((event) => event?.type === 'reveal' && SEATS.includes(event.challenger))
    .map((event) => ({
      game: gameOf(event),
      round: event.round ?? null,
      challenger: event.challenger,
      bidder: event.bid?.player ?? null,
      bid: event.bid == null ? null : {
        count: event.bid.count,
        face: event.bid.face,
      },
      actual: event.actual ?? null,
      stands: event.stands ?? null,
      hit: event.stands === false,
      loser: event.loser ?? null,
    }));
}

function normalizeRunFile(input) {
  const resolved = path.resolve(input);
  return path.extname(resolved).toLowerCase() === '.json' ? resolved : path.join(resolved, 'run.json');
}

function parseMetadata(runDirectory) {
  const file = path.join(runDirectory, 'metadata.json');
  if (!existsSync(file)) return { file, value: null, error: null };
  try {
    return { file, value: JSON.parse(readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { file, value: null, error: error.message };
  }
}

export async function analyzeShowdown(input) {
  const runFile = normalizeRunFile(input);
  const runDirectory = path.dirname(runFile);
  const snapshot = JSON.parse(readFileSync(runFile, 'utf8'));
  const decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions : [];
  const rejections = Array.isArray(snapshot.rejections) ? snapshot.rejections : [];
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const completedGames = Array.isArray(snapshot.games) && snapshot.games.length
    ? snapshot.games
    : (Array.isArray(snapshot.series?.completedGames) ? snapshot.series.completedGames : []);
  const metadata = parseMetadata(runDirectory);
  const outcomes = challengeOutcomes(events);
  const rejectionPatternRows = rejectionPatterns(rejections);

  const gameNumbers = new Set([
    ...completedGames.map(gameOf),
    ...decisions.map(gameOf),
    ...rejections.map(gameOf),
    ...events.map(gameOf),
  ]);
  if (!gameNumbers.size && Number.isInteger(snapshot.series?.game)) gameNumbers.add(snapshot.series.game);

  const games = [...gameNumbers].sort((a, b) => a - b).map((gameNumber) => {
    const completed = completedGames.find((item) => gameOf(item) === gameNumber);
    const gameDecisions = decisions.filter((item) => gameOf(item) === gameNumber);
    const gameRejections = rejections.filter((item) => gameOf(item) === gameNumber);
    const gameEvents = events.filter((item) => gameOf(item) === gameNumber);
    const roundEnds = gameEvents.filter((item) => item?.type === 'roundEnd');
    return {
      game: gameNumber,
      seed: completed?.seed ?? (Number.isFinite(snapshot.seed) ? snapshot.seed + gameNumber - 1 : null),
      firstSeat: completed?.firstSeat ?? gameEvents.find((item) => item?.type === 'roundStart')?.first ?? null,
      winner: completed?.winner ?? gameEvents.findLast((item) => item?.type === 'matchEnd')?.winner ?? null,
      completed: completed != null || gameEvents.some((item) => item?.type === 'matchEnd'),
      rounds: Number.isInteger(completed?.rounds) ? completed.rounds : roundEnds.length,
      acceptedActions: gameDecisions.length,
      rejections: gameRejections.length,
      actionsBySeat: Object.fromEntries(SEATS.map((seat) => [seat, gameDecisions.filter((item) => item.seat === seat).length])),
      actionTypes: actionCounts(gameDecisions),
      challenges: outcomes.filter((item) => item.game === gameNumber).length,
      challengeHits: outcomes.filter((item) => item.game === gameNumber && item.hit).length,
    };
  });

  const seats = {};
  for (const seat of SEATS) {
    const seatDecisions = decisions.filter((item) => item.seat === seat);
    const seatOutcomes = outcomes.filter((item) => item.challenger === seat);
    const hits = seatOutcomes.filter((item) => item.hit).length;
    const challenges = seatDecisions.filter((item) => item?.action?.type === 'challenge').length;
    seats[seat] = {
      acceptedActions: seatDecisions.length,
      rejections: rejections.filter((item) => item.seat === seat).length,
      actionTypes: actionCounts(seatDecisions),
      bids: seatDecisions.filter((item) => item?.action?.type === 'bid').length,
      challenges,
      challengeResolved: seatOutcomes.length,
      challengeHits: hits,
      challengeMisses: seatOutcomes.length - hits,
      challengeUnresolved: Math.max(0, challenges - seatOutcomes.length),
      challengeAccuracy: seatOutcomes.length ? hits / seatOutcomes.length : null,
    };
  }

  const wins = snapshot.series?.wins ?? Object.fromEntries(SEATS.map((seat) => [
    seat,
    completedGames.filter((game) => game.winner === seat).length,
  ]));
  const usage = await extractUsage(runDirectory, metadata.value);
  const agentForSeat = (seat) => ['codex', 'claude'].find((agent) => metadata.value?.[agent]?.seat === seat) ?? null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      runFile,
      runDirectory,
      snapshotSchemaVersion: snapshot.schemaVersion ?? null,
      metadataFile: metadata.file,
      metadataPresent: metadata.value != null,
      ...(metadata.error != null ? { metadataError: metadata.error } : {}),
    },
    participants: {
      seats: Object.fromEntries(SEATS.map((seat) => [seat, {
        label: snapshot.labels?.[seat] ?? metadata.value?.labels?.[seat] ?? seat,
        agent: agentForSeat(seat),
      }])),
      agents: Object.fromEntries(['codex', 'claude'].map((agent) => [agent, {
        seat: SEATS.includes(metadata.value?.[agent]?.seat) ? metadata.value[agent].seat : null,
        model: metadata.value?.[agent]?.model ?? null,
      }])),
    },
    series: {
      seed: snapshot.seed ?? null,
      bestOf: snapshot.bestOf ?? snapshot.series?.bestOf ?? 1,
      winsNeeded: snapshot.series?.winsNeeded ?? 1,
      over: Boolean(snapshot.over ?? snapshot.series?.over),
      winner: snapshot.winner ?? snapshot.series?.winner ?? null,
      wins,
      gamesCompleted: games.filter((game) => game.completed).length,
      gamesObserved: games.length,
    },
    totals: {
      acceptedActions: decisions.length,
      rejections: rejections.length,
      rejectionCodes: countBy(rejections, (item) => item.code),
      rejectionPatterns: rejectionPatternRows.length,
      repeatedRejectionAttempts: rejectionPatternRows.reduce(
        (sum, pattern) => sum + Math.max(0, pattern.attempts - 1),
        0,
      ),
      dialogue: Array.isArray(snapshot.dialogue) ? snapshot.dialogue.length : 0,
      rounds: games.reduce((sum, game) => sum + game.rounds, 0),
      actionTypes: actionCounts(decisions),
      challengesResolved: outcomes.length,
      challengeHits: outcomes.filter((item) => item.hit).length,
    },
    seats,
    games,
    challengeOutcomes: outcomes,
    rejectionPatterns: rejectionPatternRows,
    crossGameExplicitReferences: findExplicitPriorGameReferences(decisions),
    usage,
  };
}

function usageText() {
  return 'Usage: node scripts/mcp/analyze-showdown.mjs <run-directory|run.json> [--out <file>]';
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const positional = [];
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      if (argv[index + 1] == null) throw new Error('--out requires a file path');
      out = argv[index + 1];
      index += 1;
    } else if (argv[index].startsWith('-')) {
      throw new Error(`unknown option ${argv[index]}`);
    } else {
      positional.push(argv[index]);
    }
  }
  if (positional.length !== 1) throw new Error(usageText());
  return { help: false, input: positional[0], out };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usageText()}\n\nDefault: print JSON to stdout. --out creates a new file and refuses to overwrite any existing file.\n`);
    return;
  }
  const analysis = await analyzeShowdown(args.input);
  const json = `${JSON.stringify(analysis, null, 2)}\n`;
  if (args.out == null) process.stdout.write(json);
  else writeFileSync(path.resolve(args.out), json, { flag: 'wx' });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`analyze-showdown: ${error.message}\n`);
    process.exitCode = 1;
  });
}
