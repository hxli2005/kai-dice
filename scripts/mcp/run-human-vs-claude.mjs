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

function actionText(decision) {
  const action = decision.action;
  if (action.type === 'bid') return `bid ${action.count}x${action.face}`;
  if (action.type === 'declare') return `declare ${action.declaration}`;
  return action.type;
}

function renderSummary(snapshot, metadata, humanSeat, claudeSeat) {
  const rounds = snapshot.events.filter((event) => event.type === 'roundEnd');
  const humanWins = snapshot.series.wins[humanSeat] ?? 0;
  const claudeWins = snapshot.series.wins[claudeSeat] ?? 0;
  const humanActions = snapshot.decisions.filter((decision) => decision.seat === humanSeat).length;
  const claudeActions = snapshot.decisions.filter((decision) => decision.seat === claudeSeat).length;
  const name = (seat) => seat === humanSeat ? 'Human' : seat === claudeSeat ? 'Claude Code' : seat;
  const rows = rounds.map((round) =>
    `| ${round.game ?? 1} | ${round.round} | ${name(round.winner)} | ${name(round.loser)} | ${round.diceCount[humanSeat]}–${round.diceCount[claudeSeat]} |`,
  );
  return `# Human vs Claude Code · 大话骰真实${snapshot.bestOf > 1 ? ` BO${snapshot.bestOf} 系列赛` : '对局'}\n\n` +
    `- 种子：${snapshot.seed}\n` +
    `- 席位：Human ${humanSeat} 席 / Claude Code ${claudeSeat} 席\n` +
    `- 系列比分：Human ${humanWins}–${claudeWins} Claude Code\n` +
    `- 胜者：**${name(snapshot.winner)}（${snapshot.winner ?? '—'} 席）**\n` +
    `- 已接受动作：${snapshot.decisions.length}（Human ${humanActions} / Claude Code ${claudeActions}）\n` +
    `- 公开发言：${snapshot.dialogue.length}\n` +
    `- 拒绝动作：${snapshot.rejections.length}\n` +
    `- Claude CLI：${metadata.versions.claude ?? 'unknown'}\n\n` +
    `| 场 | 小局 | 胜者 | 败者 | 剩余骰 Human–Claude |\n|---:|---:|---|---|---:|\n${rows.join('\n')}\n`;
}

if (has('--help') || has('-h')) {
  process.stdout.write(`Human vs your own Claude Code\n\n` +
    `Usage: kai-liars-play [options]\n\n` +
    `  --best-of N           Series length (default: 1)\n` +
    `  --human-seat A|B      Your seat (default: A)\n` +
    `  --claude-model ID      Override your Claude Code default model\n` +
    `  --seed N               Deterministic seed (default: random)\n` +
    `  --out DIR              Record directory\n` +
    `  --timeout-minutes N    Match timeout (default: 120)\n` +
    `  --no-open              Print the PLAY URL without opening a browser\n`);
  process.exit(0);
}

const claudeVersion = versionOf('claude');
if (!claudeVersion) {
  process.stderr.write('Claude Code was not found. Install and sign in to Claude Code, then run this command again.\n');
  process.exit(2);
}

const seed = Number(arg('--seed', String(Math.floor(Math.random() * 90_000_000) + 10_000_000)));
const bestOf = Math.max(1, Number(arg('--best-of', '1')));
const timeoutMinutes = Number(arg('--timeout-minutes', '120'));
const outDir = path.resolve(arg('--out', path.join(process.cwd(), 'kai-liars-records', timestamp())));
const humanSeat = String(arg('--human-seat', 'A')).toUpperCase();
if (!['A', 'B'].includes(humanSeat)) throw new Error('--human-seat must be A or B');
const claudeSeat = humanSeat === 'A' ? 'B' : 'A';
const claudeModel = arg('--claude-model');
const labels = {
  [humanSeat]: 'Human',
  [claudeSeat]: claudeModel ? `Claude Code · ${claudeModel}` : 'Claude Code · CLI default',
};
mkdirSync(outDir, { recursive: true });

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kai-human-vs-claude-'));
const claudeCwd = path.join(tempRoot, 'claude-seat');
mkdirSync(claudeCwd);

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
const coordinator = await startCoordinator({
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
      `[${decision.seat === humanSeat ? 'Human' : 'Claude'}] game ${decision.game} round ${decision.round}: ${actionText(decision)}` +
      `${decision.say ? ` — ${JSON.stringify(decision.say)}` : ''}\n`,
    );
    if (snapshot.over) finishMatch(snapshot);
  },
});

const playUrl = `${coordinator.playUrl}#seat=${humanSeat}&token=${tokens[humanSeat]}`;
process.stdout.write(`PLAY ${playUrl}\n`);

const prompt =
  `Play this entire best-of-${bestOf} Liar's Dice series against a human to completion using only the liars MCP tools. ` +
  `You are seat ${claudeSeat}. One session covers every game and round. Observe, take legal actions, and wait when no action is legal. ` +
  'The human may take time to act; wait patiently and never stop early. Do not use outside tools. ' +
  'Do not stop until series.over is true; then briefly report the series winner and score.';
const claudeMcpArgs = [
  seatServer,
  '--seat', claudeSeat,
  '--coordinator', coordinator.url,
  '--token', tokens[claudeSeat],
];
const claudeConfig = path.join(tempRoot, 'claude-mcp.json');
writeFileSync(claudeConfig, JSON.stringify({
  mcpServers: {
    liars: { command: process.execPath, args: claudeMcpArgs },
  },
}, null, 2));
const claudeArgs = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--strict-mcp-config',
  '--mcp-config', claudeConfig,
  '--tools', '',
  '--dangerously-skip-permissions',
  '--disable-slash-commands',
  ...(claudeModel ? ['--model', claudeModel] : []),
  prompt,
];

const metadata = {
  schemaVersion: 1,
  mode: 'human-vs-claude-code',
  startedAt: new Date().toISOString(),
  seed,
  bestOf,
  labels,
  human: { seat: humanSeat, client: 'local-browser' },
  claude: {
    command: 'claude',
    seat: claudeSeat,
    model: claudeModel ?? 'cli-default',
    args: claudeArgs.map((value) => value === claudeConfig ? '<mcp-config>' : value),
  },
  versions: { claude: claudeVersion },
};
writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

const claudeOut = createWriteStream(path.join(outDir, 'claude.jsonl'));
const claudeErr = createWriteStream(path.join(outDir, 'claude.stderr.log'));
const claude = spawn('claude', claudeArgs, { cwd: claudeCwd, stdio: ['ignore', 'pipe', 'pipe'] });
claude.stdout.pipe(claudeOut);
claude.stderr.pipe(claudeErr);
const claudeExit = waitForExit(claude);
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  if (claude.exitCode == null) claude.kill('SIGTERM');
  await coordinator.close().catch(() => {});
  rmSync(tempRoot, { recursive: true, force: true });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});
openBrowser(playUrl);
const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMinutes * 60_000));
const first = await Promise.race([
  matchFinished.then(() => 'match'),
  claudeExit.then(() => 'claude-exit'),
  timeout,
]);

if (first !== 'match') {
  if (claude.exitCode == null) claude.kill('SIGTERM');
} else {
  await Promise.race([claudeExit, new Promise((resolve) => setTimeout(resolve, 30_000))]);
  if (claude.exitCode == null) claude.kill('SIGTERM');
}

const claudeResult = await claudeExit;
const snapshot = coordinator.showdown.snapshot();
metadata.completedAt = new Date().toISOString();
metadata.outcome = first;
metadata.over = snapshot.over;
metadata.winner = snapshot.winner == null ? null : {
  seat: snapshot.winner,
  participant: snapshot.winner === humanSeat ? 'human' : 'claude',
};
metadata.seriesScore = {
  human: snapshot.series.wins[humanSeat] ?? 0,
  claude: snapshot.series.wins[claudeSeat] ?? 0,
};
metadata.acceptedActions = {
  human: snapshot.decisions.filter((decision) => decision.seat === humanSeat).length,
  claude: snapshot.decisions.filter((decision) => decision.seat === claudeSeat).length,
};
metadata.claude.exit = claudeResult;
writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(path.join(outDir, 'summary.md'), renderSummary(snapshot, metadata, humanSeat, claudeSeat));

if (first === 'match') await new Promise((resolve) => setTimeout(resolve, 2_000));
claudeOut.end();
claudeErr.end();
await cleanup();

process.stdout.write(`${JSON.stringify({ outDir, over: snapshot.over, winner: metadata.winner, outcome: first })}\n`);
process.exit(snapshot.over ? 0 : 1);
