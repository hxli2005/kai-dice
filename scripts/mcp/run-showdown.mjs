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
import {
  labelsForAgentSeats,
  mcpArgsForAgent,
  renderSummary,
  resolveAgentSeats,
  summarizeAgentResult,
} from './lib/agent-seats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seatServer = path.join(here, 'seat-server.mjs');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
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

function actionText(decision) {
  const action = decision.action;
  if (action.type === 'bid') return `bid ${action.count}x${action.face}`;
  if (action.type === 'declare') return `declare ${action.declaration}`;
  return action.type;
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

const seed = Number(arg('--seed', '20260817'));
const bestOf = Math.max(1, Number(arg('--best-of', '1')));
const timeoutMinutes = Number(arg('--timeout-minutes', '30'));
const outDir = path.resolve(arg('--out', path.join('docs', 'showdown', timestamp())));
const codexModel = arg('--codex-model');
const claudeModel = arg('--claude-model');
const agentSeats = resolveAgentSeats(arg('--codex-seat', 'A'));
const labels = labelsForAgentSeats(agentSeats, { codexModel, claudeModel });
mkdirSync(outDir, { recursive: true });

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kai-showdown-'));
const codexCwd = path.join(tempRoot, 'codex-seat');
const claudeCwd = path.join(tempRoot, 'claude-seat');
mkdirSync(codexCwd);
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
  onSnapshot: writeSnapshot,
  onAction(decision, snapshot) {
    process.stdout.write(
      `[${decision.seat}] round ${decision.round}: ${actionText(decision)}` +
      `${decision.say ? ` — ${JSON.stringify(decision.say)}` : ''}\n`,
    );
    if (snapshot.over) finishMatch(snapshot);
  },
});
process.stdout.write(`LIVE ${coordinator.spectatorUrl}\n`);

const prompt =
  `Play this entire best-of-${bestOf} Liar's Dice series to completion using only the liars MCP tools. ` +
  'One session covers every game and round. Observe, take legal actions, and wait when no action is legal. ' +
  'Do not stop until series.over is true; then report the series winner and score.';
const mcpContext = { seatServer, coordinator: coordinator.url, tokens };
const codexMcpArgs = mcpArgsForAgent('codex', agentSeats, mcpContext);
const claudeMcpArgs = mcpArgsForAgent('claude', agentSeats, mcpContext);

const codexArgs = [
  'exec',
  '--json',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '--cd',
  codexCwd,
  '--sandbox',
  'read-only',
  '--config',
  'approval_policy="never"',
  '--config',
  `mcp_servers.liars.command=${toml(process.execPath)}`,
  '--config',
  `mcp_servers.liars.args=${toml(codexMcpArgs)}`,
  '--config',
  'mcp_servers.liars.default_tools_approval_mode="approve"',
  ...(codexModel ? ['--model', codexModel] : []),
  prompt,
];

const claudeConfig = path.join(tempRoot, 'claude-mcp.json');
writeFileSync(claudeConfig, JSON.stringify({
  mcpServers: {
    liars: {
      command: process.execPath,
      args: claudeMcpArgs,
    },
  },
}, null, 2));
const claudeArgs = [
  '--print',
  '--verbose',
  '--output-format',
  'stream-json',
  '--strict-mcp-config',
  '--mcp-config',
  claudeConfig,
  '--tools',
  '',
  '--dangerously-skip-permissions',
  '--disable-slash-commands',
  ...(claudeModel ? ['--model', claudeModel] : []),
  prompt,
];

const metadata = {
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  seed,
  bestOf,
  coordinator: coordinator.url,
  labels,
  codex: {
    command: 'codex',
    seat: agentSeats.codex,
    model: codexModel ?? 'cli-default',
    args: codexArgs.map((x) => String(x).replaceAll(tokens[agentSeats.codex], '<seat-token>')),
  },
  claude: {
    command: 'claude',
    seat: agentSeats.claude,
    model: claudeModel ?? 'cli-default',
    args: claudeArgs.map((x) => x === claudeConfig ? '<mcp-config>' : x),
  },
  versions: { codex: versionOf('codex'), claude: versionOf('claude') },
};
writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

const codexOut = createWriteStream(path.join(outDir, 'codex.jsonl'));
const codexErr = createWriteStream(path.join(outDir, 'codex.stderr.log'));
const claudeOut = createWriteStream(path.join(outDir, 'claude.jsonl'));
const claudeErr = createWriteStream(path.join(outDir, 'claude.stderr.log'));

const codex = spawn('codex', codexArgs, { cwd: codexCwd, stdio: ['ignore', 'pipe', 'pipe'] });
const claude = spawn('claude', claudeArgs, { cwd: claudeCwd, stdio: ['ignore', 'pipe', 'pipe'] });
codex.stdout.pipe(codexOut);
codex.stderr.pipe(codexErr);
claude.stdout.pipe(claudeOut);
claude.stderr.pipe(claudeErr);

const codexExit = waitForExit(codex);
const claudeExit = waitForExit(claude);
const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMinutes * 60_000));
const first = await Promise.race([
  matchFinished.then(() => 'match'),
  codexExit.then(() => 'codex-exit'),
  claudeExit.then(() => 'claude-exit'),
  timeout,
]);

if (first !== 'match') {
  codex.kill('SIGTERM');
  claude.kill('SIGTERM');
} else {
  await Promise.race([
    Promise.all([codexExit, claudeExit]),
    new Promise((resolve) => setTimeout(resolve, 30_000)),
  ]);
  if (codex.exitCode == null) codex.kill('SIGTERM');
  if (claude.exitCode == null) claude.kill('SIGTERM');
}

const [codexResult, claudeResult] = await Promise.all([codexExit, claudeExit]);
const snapshot = coordinator.showdown.snapshot();
const result = summarizeAgentResult(snapshot, agentSeats);
metadata.completedAt = new Date().toISOString();
metadata.outcome = first;
metadata.over = snapshot.over;
metadata.winner = result.winnerAgent == null ? null : {
  seat: result.winnerSeat,
  agent: result.winnerAgent,
  label: result.winnerName,
};
metadata.seriesScore = result.score;
metadata.acceptedActions = result.actions;
metadata.codex.exit = codexResult;
metadata.claude.exit = claudeResult;
writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(path.join(outDir, 'summary.md'), renderSummary(snapshot, metadata, agentSeats));
await coordinator.close();
codexOut.end();
codexErr.end();
claudeOut.end();
claudeErr.end();
rmSync(tempRoot, { recursive: true, force: true });

process.stdout.write(`${JSON.stringify({
  outDir,
  over: snapshot.over,
  winner: result.winnerAgent,
  winnerSeat: result.winnerSeat,
  outcome: first,
})}\n`);
process.exit(snapshot.over ? 0 : 1);
