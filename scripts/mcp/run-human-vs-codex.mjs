#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startCoordinator } from './lib/coordinator-http.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seatServer = path.join(here, 'seat-server.mjs');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function toml(value) {
  return JSON.stringify(value);
}

function versionOf(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return String(result.stdout || result.stderr || '').trim() || null;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }));
  });
}

function actionText(decision) {
  const action = decision.action;
  if (action.type === 'bid') return `bid ${action.count}x${action.face}`;
  if (action.type === 'declare') return `declare ${action.declaration}`;
  return action.type;
}

function openBrowser(url) {
  if (has('--no-open')) return;
  const spec = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(spec[0], spec[1], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {}
}

function renderSummary(snapshot, metadata, humanSeat, codexSeat) {
  const rounds = snapshot.events.filter((event) => event.type === 'roundEnd');
  const humanWins = snapshot.series.wins[humanSeat] ?? 0;
  const codexWins = snapshot.series.wins[codexSeat] ?? 0;
  const humanActions = snapshot.decisions.filter((decision) => decision.seat === humanSeat).length;
  const codexActions = snapshot.decisions.filter((decision) => decision.seat === codexSeat).length;
  const name = (seat) => seat === humanSeat ? 'Human' : seat === codexSeat ? 'Codex' : seat;
  const rows = rounds.map((round) =>
    `| ${round.game ?? 1} | ${round.round} | ${name(round.winner)} | ${name(round.loser)} | ${round.diceCount[humanSeat]}–${round.diceCount[codexSeat]} |`,
  );
  return `# Human vs Codex · Liar's Dice ${snapshot.bestOf > 1 ? `BO${snapshot.bestOf}` : 'match'}\n\n` +
    `- Seed: ${snapshot.seed}\n` +
    `- Seats: Human ${humanSeat} / Codex ${codexSeat}\n` +
    `- Series: Human ${humanWins}–${codexWins} Codex\n` +
    `- Winner: **${name(snapshot.winner)} (${snapshot.winner ?? '—'})**\n` +
    `- Accepted actions: ${snapshot.decisions.length} (Human ${humanActions} / Codex ${codexActions})\n` +
    `- Table-talk messages: ${snapshot.dialogue.length}\n` +
    `- Rejected actions: ${snapshot.rejections.length}\n` +
    `- Codex CLI: ${metadata.versions.codex ?? 'unknown'}\n\n` +
    `| Game | Round | Winner | Loser | Dice Human–Codex |\n|---:|---:|---|---|---:|\n${rows.join('\n')}\n`;
}

if (has('--help') || has('-h')) {
  process.stdout.write(`Human vs your own Codex\n\n` +
    `Usage: kai-liars-play [options]\n\n` +
    `  --best-of N          Series length (default: 1)\n` +
    `  --human-seat A|B     Your seat (default: A)\n` +
    `  --codex-model ID      Override your Codex CLI default model\n` +
    `  --seed N              Deterministic seed (default: random)\n` +
    `  --out DIR             Record directory\n` +
    `  --timeout-minutes N   Match timeout (default: 120)\n` +
    `  --no-open             Print the PLAY URL without opening a browser\n`);
  process.exit(0);
}

const codexVersion = versionOf('codex');
if (!codexVersion) {
  process.stderr.write('Codex CLI was not found. Install and sign in to Codex, then run this command again.\n');
  process.exit(2);
}

const seed = Number(arg('--seed', String(Math.floor(Math.random() * 90_000_000) + 10_000_000)));
const bestOf = Math.max(1, Number(arg('--best-of', '1')));
const timeoutMinutes = Number(arg('--timeout-minutes', '120'));
const outDir = path.resolve(arg('--out', path.join(process.cwd(), 'kai-liars-records', timestamp())));
const humanSeat = String(arg('--human-seat', 'A')).toUpperCase();
if (!['A', 'B'].includes(humanSeat)) throw new Error('--human-seat must be A or B');
const codexSeat = humanSeat === 'A' ? 'B' : 'A';
const codexModel = arg('--codex-model');
const codexLabel = codexModel ? `Codex · ${codexModel}` : 'Codex · CLI default';
const labels = { [humanSeat]: 'Human', [codexSeat]: codexLabel };
mkdirSync(outDir, { recursive: true });

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kai-human-vs-codex-'));
const codexCwd = path.join(tempRoot, 'codex-seat');
mkdirSync(codexCwd);
const tokens = { A: randomBytes(24).toString('hex'), B: randomBytes(24).toString('hex') };
const adminToken = randomBytes(24).toString('hex');
const runFile = path.join(outDir, 'run.json');
const metadataFile = path.join(outDir, 'metadata.json');
const writeSnapshot = (snapshot) => {
  const tmp = `${runFile}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(tmp, runFile);
};

let finishMatch;
const matchFinished = new Promise((resolve) => { finishMatch = resolve; });
let coordinator = null;
let codex = null;
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  if (codex?.exitCode == null) codex?.kill('SIGTERM');
  await coordinator?.close().catch(() => {});
  rmSync(tempRoot, { recursive: true, force: true });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

coordinator = await startCoordinator({
  seed,
  bestOf,
  tokens,
  adminToken,
  labels,
  spectatorEnabled: false,
  playEnabled: true,
  onSnapshot: writeSnapshot,
  onAction(decision, snapshot) {
    process.stdout.write(
      `[${decision.seat === humanSeat ? 'Human' : 'Codex'}] game ${decision.game} round ${decision.round}: ${actionText(decision)}` +
      `${decision.say ? ` — ${JSON.stringify(decision.say)}` : ''}\n`,
    );
    if (snapshot.over) finishMatch(snapshot);
  },
});

const playUrl = `${coordinator.playUrl}#seat=${humanSeat}&token=${tokens[humanSeat]}`;
process.stdout.write(`PLAY ${playUrl}\n`);

const prompt =
  `Play this entire best-of-${bestOf} Liar's Dice series against a human to completion using only the liars MCP tools. ` +
  `You are seat ${codexSeat}. One session covers every game and round. Observe, take legal actions, and wait when no action is legal. ` +
  'The human may take time to act; wait patiently and never stop early. Do not inspect files or use outside tools. ' +
  'Do not stop until series.over is true; then briefly report the series winner and score.';
const codexMcpArgs = [
  seatServer,
  '--seat', codexSeat,
  '--coordinator', coordinator.url,
  '--token', tokens[codexSeat],
];
const codexArgs = [
  'exec',
  '--json',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '--cd', codexCwd,
  '--sandbox', 'read-only',
  '--config', 'approval_policy="never"',
  '--config', `mcp_servers.liars.command=${toml(process.execPath)}`,
  '--config', `mcp_servers.liars.args=${toml(codexMcpArgs)}`,
  '--config', 'mcp_servers.liars.default_tools_approval_mode="approve"',
  ...(codexModel ? ['--model', codexModel] : []),
  prompt,
];
const metadata = {
  schemaVersion: 1,
  mode: 'human-vs-own-codex',
  startedAt: new Date().toISOString(),
  seed,
  bestOf,
  labels,
  human: { seat: humanSeat, client: 'local-browser' },
  codex: {
    command: 'codex',
    seat: codexSeat,
    model: codexModel ?? 'cli-default',
    args: codexArgs.map((value) => String(value).replaceAll(tokens[codexSeat], '<seat-token>')),
  },
  versions: { codex: codexVersion },
};
writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

const codexOut = createWriteStream(path.join(outDir, 'codex.jsonl'));
const codexErr = createWriteStream(path.join(outDir, 'codex.stderr.log'));
codex = spawn('codex', codexArgs, { cwd: codexCwd, stdio: ['ignore', 'pipe', 'pipe'] });
codex.stdout.pipe(codexOut);
codex.stderr.pipe(codexErr);
const codexExit = waitForExit(codex);
openBrowser(playUrl);

const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMinutes * 60_000));
const first = await Promise.race([
  matchFinished.then(() => 'match'),
  codexExit.then(() => 'codex-exit'),
  timeout,
]);
if (first !== 'match') {
  if (codex.exitCode == null) codex.kill('SIGTERM');
} else {
  await Promise.race([codexExit, new Promise((resolve) => setTimeout(resolve, 30_000))]);
  if (codex.exitCode == null) codex.kill('SIGTERM');
}

const codexResult = await codexExit;
const snapshot = coordinator.showdown.snapshot();
metadata.completedAt = new Date().toISOString();
metadata.outcome = first;
metadata.over = snapshot.over;
metadata.winner = snapshot.winner == null ? null : {
  seat: snapshot.winner,
  participant: snapshot.winner === humanSeat ? 'human' : 'codex',
};
metadata.seriesScore = {
  human: snapshot.series.wins[humanSeat] ?? 0,
  codex: snapshot.series.wins[codexSeat] ?? 0,
};
metadata.acceptedActions = {
  human: snapshot.decisions.filter((decision) => decision.seat === humanSeat).length,
  codex: snapshot.decisions.filter((decision) => decision.seat === codexSeat).length,
};
metadata.codex.exit = codexResult;
writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(path.join(outDir, 'summary.md'), renderSummary(snapshot, metadata, humanSeat, codexSeat));
if (first === 'match') await new Promise((resolve) => setTimeout(resolve, 2_000));
codexOut.end();
codexErr.end();
await cleanup();

process.stdout.write(`${JSON.stringify({ outDir, over: snapshot.over, winner: metadata.winner, outcome: first })}\n`);
process.exit(snapshot.over ? 0 : 1);
