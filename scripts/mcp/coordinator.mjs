#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { startCoordinator } from './lib/coordinator-http.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const seed = Number(arg('--seed', '1'));
const bestOf = Number(arg('--best-of', '1'));
const port = Number(arg('--port', '0'));
const out = path.resolve(arg('--out', `showdown-${Date.now()}.json`));
const tokens = {
  A: arg('--token-a') ?? randomBytes(24).toString('hex'),
  B: arg('--token-b') ?? randomBytes(24).toString('hex'),
};
const adminToken = arg('--admin-token') ?? randomBytes(24).toString('hex');

mkdirSync(path.dirname(out), { recursive: true });
const writeSnapshot = (snapshot) => {
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
  renameSync(tmp, out);
};

const coordinator = await startCoordinator({ seed, bestOf, port, tokens, adminToken, onSnapshot: writeSnapshot });
process.stdout.write(`${JSON.stringify({
  ready: true,
  url: coordinator.url,
  spectatorUrl: coordinator.spectatorUrl,
  seed,
  bestOf,
  out,
  tokens,
  adminToken,
})}\n`);

const close = async () => {
  await coordinator.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
