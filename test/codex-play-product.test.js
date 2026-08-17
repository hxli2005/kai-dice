import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('自带 Codex 页面提供同源 npx 命令、双语和本地边界', () => {
  const html = read('codex.html');
  const js = read('codex.js');
  const css = read('codex.css');

  assert.match(html, /和你自己的/);
  assert.match(html, /id="copyButton"/);
  assert.match(html, /Node\.js 20\+/);
  assert.match(js, /downloads\/kai-\$\{agent\}-play\.tgz/);
  assert.match(js, /Claude Code/);
  assert.match(html, /data-agent="codex"/);
  assert.match(html, /data-agent="claude"/);
  assert.match(js, /--best-of 3/);
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(js, /Play your own/);
  assert.match(css, /macrostructure: Component Playground/);
  assert.match(css, /html,[\s\S]*body \{ min-height: 100%; overflow-x: clip;/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
});

test('本地分发包只调用用户自己的 Codex，并保留席位隔离', () => {
  const runner = read('scripts/mcp/run-human-vs-codex.mjs');
  const packageJson = JSON.parse(read('packages/codex-play/package.json'));
  const claudePackageJson = JSON.parse(read('packages/claude-play/package.json'));
  const claudeRunner = read('scripts/mcp/run-human-vs-claude.mjs');
  const build = read('scripts/build-codex-play-package.mjs');
  const rootPackage = JSON.parse(read('package.json'));

  assert.equal(packageJson.bin['kai-liars-play'], 'scripts/mcp/run-human-vs-codex.mjs');
  assert.equal(claudePackageJson.bin['kai-liars-play'], 'scripts/mcp/run-human-vs-claude.mjs');
  assert.match(runner, /versionOf\('codex'\)/);
  assert.match(runner, /spawn\('codex'/);
  assert.match(runner, /spectatorEnabled: false/);
  assert.match(runner, /playEnabled: true/);
  assert.match(runner, /--ignore-user-config/);
  assert.match(runner, /--ignore-rules/);
  assert.match(runner, /--sandbox', 'read-only/);
  assert.match(build, /kai-codex-play\.tgz/);
  assert.match(build, /kai-claude-play\.tgz/);
  assert.match(claudeRunner, /versionOf\('claude'\)/);
  assert.match(claudeRunner, /spawn\('claude'/);
  assert.match(claudeRunner, /spectatorEnabled: false/);
  assert.match(rootPackage.scripts.dist, /codex\.html/);
  assert.match(rootPackage.scripts.dist, /agent\.html/);
  assert.match(rootPackage.scripts.dist, /agent:packages/);
});
