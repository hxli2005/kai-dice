import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('大厅采用桌型／裁判／对手的纵向三管工作台', () => {
  const main = read('src/ui/main.js');

  assert.match(main, /data-lobby-shell="tube-workbench"/);
  assert.match(main, /class="lobby-workbench"/);
  assert.match(main, /class="lobby-console"/);
  assert.ok(main.indexOf('lobby-tube--mode') < main.indexOf('class="lobby-judge"'));
  assert.ok(main.indexOf('class="lobby-judge"') < main.indexOf('lobby-tube--roster'));
  assert.match(main, /class="lobby-rack"/);
  assert.match(main, /classList\.add\('lobby-mode'\)/);
  assert.match(main, /classList\.remove\('lobby-mode'\)/);
  assert.match(main, /id="lobbyStart"[^>]+aria-describedby="lobbyJudgeState"/);
  assert.match(main, /id="lobbySettings"/);
  assert.match(main, /id="roomBtn"/);
  assert.match(main, /href="docs\/arena\/live\.html"/);
  assert.match(main, /lobby-portal--codex/);
  assert.match(main, /href="agent\.html/);
});

test('大厅电子管样式占满窗口、桌面分架、窄屏先单列', () => {
  const css = read('src/ui/style.css');
  const section = css.slice(css.indexOf('大厅电子管工作台'), css.indexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(section, /#lobby\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*max-width:\s*none;/s);
  assert.match(section, /\.lobby-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(section, /@media \(min-width:\s*60rem\)[\s\S]*?\.lobby-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0, 7fr\) minmax\(18rem, 5fr\);/);
  assert.match(section, /\.lobby-tube--mode\s*\{[^}]*var\(--color-tube-a-surface\)/s);
  assert.match(section, /\.lobby-tube--roster\s*\{[^}]*var\(--color-tube-b-surface\)/s);
  assert.match(section, /\.lobby-judge\s*\{[^}]*var\(--color-tube-judge-surface\)/s);
  assert.match(section, /#app\.lobby-mode > header,[\s\S]*?visibility:\s*hidden;/);
  assert.doesNotMatch(section, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i, '大厅新增样式只能从共享令牌取色');
  assert.doesNotMatch(section, /transition-all|width:\s*100vw/);
});

test('大厅在旧样式前加载共享电子管令牌，离线壳同步升版', () => {
  const html = read('index.html');
  const worker = read('sw.js');

  assert.ok(html.indexOf('href="tokens.css"') < html.indexOf('href="src/ui/style.css"'));
  assert.match(worker, /const CACHE = 'kai-shell-v16'/);
  assert.match(worker, /'\.\/tokens\.css'/);
  assert.match(worker, /'\.\/codex\.html'/);
  assert.match(worker, /'\.\/agent\.html'/);
});
