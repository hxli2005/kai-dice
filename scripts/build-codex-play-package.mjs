#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist', 'downloads');
const commonFiles = [
  'tokens.css',
  'src/engine.js',
  'src/rules.js',
  'scripts/mcp/seat-server.mjs',
  'scripts/mcp/lib/coordinator-http.mjs',
  'scripts/mcp/lib/showdown.mjs',
  'scripts/mcp/human/index.html',
  'scripts/mcp/human/play.css',
  'scripts/mcp/human/play.js',
];
const packages = [
  {
    name: 'codex',
    sourceRoot: 'packages/codex-play',
    runner: 'scripts/mcp/run-human-vs-codex.mjs',
    stableName: 'kai-codex-play.tgz',
  },
  {
    name: 'claude',
    sourceRoot: 'packages/claude-play',
    runner: 'scripts/mcp/run-human-vs-claude.mjs',
    stableName: 'kai-claude-play.tgz',
  },
];

mkdirSync(outDir, { recursive: true });
const outputs = [];
for (const spec of packages) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `kai-${spec.name}-package-`));
  const stage = path.join(tempRoot, 'package');
  mkdirSync(stage, { recursive: true });
  for (const source of [`${spec.sourceRoot}/package.json`, `${spec.sourceRoot}/README.md`, spec.runner, ...commonFiles]) {
    const destination = source.startsWith(`${spec.sourceRoot}/`)
      ? source.slice(spec.sourceRoot.length + 1)
      : source;
    const target = path.join(stage, destination);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, source), target);
  }
  const packed = spawnSync('npm', ['pack', stage, '--pack-destination', outDir, '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (packed.status !== 0) {
    process.stderr.write(packed.stderr || packed.stdout);
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(packed.status ?? 1);
  }
  const result = JSON.parse(packed.stdout)[0];
  const generated = path.join(outDir, result.filename);
  const stable = path.join(outDir, spec.stableName);
  renameSync(generated, stable);
  const hash = createHash('sha256').update(readFileSync(stable)).digest('hex');
  writeFileSync(path.join(outDir, spec.stableName.replace(/\.tgz$/, '.sha256')), `${hash}  ${spec.stableName}\n`);
  outputs.push({ agent: spec.name, file: stable, bytes: result.size, sha256: hash });
  rmSync(tempRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(outputs)}\n`);
