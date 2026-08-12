import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const source = process.argv[2] ?? 'docs/arena/2026-08-12T04-56-09/run.json';
const target = process.argv[3] ?? 'docs/arena/verified-replay.json';

const eventFields = {
  roundStart: ['type', 'round', 'first'],
  peek: ['type', 'player'],
  calc: ['type', 'player'],
  bid: ['type', 'player', 'count', 'face'],
  declare: ['type', 'player', 'declaration'],
  challenge: ['type', 'player'],
  reveal: ['type', 'actual', 'bid', 'stands', 'loser'],
  roundEnd: ['type'],
  matchEnd: ['type', 'winner'],
  modAction: ['type', 'player'],
};

const pick = (value, fields) => Object.fromEntries(
  fields.filter((field) => value?.[field] !== undefined).map((field) => [field, value[field]]),
);

const input = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!Array.isArray(input.matches)) throw new Error(`${source} 没有 matches 数组`);

const output = {
  schema: 'kai.arena.public-replay.v1',
  source: path.basename(path.dirname(source)),
  scope: '在这张桌子上',
  matches: input.matches.map((match) => ({
    seed: match.seed,
    seats: match.seats,
    winner: match.winner,
    ...(match.aborted ? { aborted: match.aborted } : {}),
    events: (match.events ?? []).map((event) => pick(event, eventFields[event.type] ?? ['type'])),
    logs: Object.fromEntries(['A', 'B'].map((seat) => [
      seat,
      (match.logs?.[seat] ?? []).map((log) => pick(log, ['say', 'belief', 'silentFallback'])),
    ])),
  })),
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(output)}\n`);
console.log(`公开复盘：${output.matches.length} 场，${fs.statSync(target).size} bytes → ${target}`);
