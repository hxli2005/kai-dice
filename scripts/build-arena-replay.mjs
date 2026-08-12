import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { groundEvents } from '../src/grounding.js';

const source = process.argv[2] ?? 'docs/arena/2026-08-12T04-56-09/run.json';
const target = process.argv[3] ?? 'docs/arena/verified-replay.json';

// G2：主客体（actor/target）随事件一起进公开实录——谁开谁不留给读者去猜。
// round/action 由载入侧的 groundEvents 按报价梯还原，不占公开档的体积。
const eventFields = {
  roundStart: ['type', 'round', 'first'],
  peek: ['type', 'actor'],
  calc: ['type', 'actor'],
  bid: ['type', 'actor', 'count', 'face'],
  declare: ['type', 'actor', 'declaration'],
  challenge: ['type', 'actor', 'target'],
  reveal: ['type', 'actor', 'target', 'actual', 'bid', 'stands', 'loser'],
  roundEnd: ['type'],
  matchEnd: ['type', 'winner'],
  modAction: ['type', 'actor', 'target', 'action', 'op'],
};

const pick = (value, fields) => Object.fromEntries(
  fields.filter((field) => value?.[field] != null).map((field) => [field, value[field]]),
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
    // 先接地再裁剪：G2 之前跑出来的 run.json 用 {player} 且不带 target，这里一次补齐
    events: groundEvents(match.events ?? []).map((event) => pick(event, eventFields[event.type] ?? ['type'])),
    logs: Object.fromEntries(['A', 'B'].map((seat) => [
      seat,
      (match.logs?.[seat] ?? []).map((log) => pick(log, ['say', 'belief', 'silentFallback'])),
    ])),
  })),
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify(output)}\n`);
console.log(`公开复盘：${output.matches.length} 场，${fs.statSync(target).size} bytes → ${target}`);
