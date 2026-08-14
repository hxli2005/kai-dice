import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { language, translateUiText } from '../src/ui/i18n.js';

test('English adaptation keeps Chinese as the non-browser default', () => {
  assert.equal(language(), 'zh');
  assert.equal(translateUiText('开局'), '开局');
});

test('English UI copy covers core controls and dynamic round labels', () => {
  assert.equal(translateUiText('开局', 'en'), 'START');
  assert.equal(translateUiText('斋', 'en'), 'NO-WILDS');
  assert.equal(translateUiText('第 7 局', 'en'), 'ROUND 7');
  assert.equal(translateUiText('3/2 席已接通', 'en'), '3/2 SEAT(S) CONNECTED');
  assert.equal(translateUiText('看自己的骰子', 'en'), 'Peek at your dice');
  assert.equal(translateUiText('第 3 局 · 池 ×4 · you掉一颗骰', 'en'), 'ROUND 3 · POT ×4 · you lost one die');
});

// DESIGN §3（第 179 行「真迹不可赛后重写」，CLAUDE.md 列为不可协商项）。
// 英文适配器是子串替换，认不出哪段中文是界面文案、哪段是模型当时留的话——
// 边界只能靠 data-raw 显式标记。这两条测试守的就是那道边界。
test('英文适配器对模型留档整棵子树跳过（真迹护栏）', () => {
  const i18n = fs.readFileSync(new URL('../src/ui/i18n.js', import.meta.url), 'utf8');
  assert.match(i18n, /\[data-raw\]/); // 护栏选择器在
  assert.match(i18n, /if \(root\.closest\(RAW\)\) return;/); // 整棵子树跳过，不只跳文本节点
  assert.match(i18n, /el\.closest\(RAW\)/); // 属性（aria-label／title）也不改写
});

test('每个渲染模型文字的地方都打了 data-raw', () => {
  const main = fs.readFileSync(new URL('../src/ui/main.js', import.meta.url), 'utf8');
  assert.match(main, /b\.setAttribute\('data-raw', ''\)/); // 台词气泡
  assert.match(main, /<p class="hyp-text" data-raw>/); // 假设的一生
  assert.match(main, /<p class="note-item" data-raw>/); // 观察笔记
  assert.match(main, /<span data-raw>「\$\{h\.text\}」<\/span>/); // 小本子里的假设
  assert.match(main, /raw\(r\.inner\.say\)/); // 复盘：它当时说的
  assert.match(main, /raw\(r\.inner\.belief\)/); // 复盘：它当时想的
  assert.match(main, /class="verdict"\$\{raw \? ' data-raw' : ''\}/); // 判词（仅它自己写的那版）
  assert.match(main, /renderCard\(verdict \?\? templateVerdict\(stats, won\), !!verdict\)/);
  assert.match(main, /<div class="verdict" data-raw>\$\{m\.verdict\}/); // 好友房判词
  // a11y 播报区含模型台词，内容由 tubes.js 预先本地化
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="tubeA11y"[^>]*data-raw/);
});

test('English guide, manifest, prompt contract, and offline shell ship together', () => {
  const root = new URL('../', import.meta.url);
  const guide = fs.readFileSync(new URL('about.en.html', root), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.en.webmanifest', root), 'utf8'));
  const agent = fs.readFileSync(new URL('src/ai/agent.js', root), 'utf8');
  const i18n = fs.readFileSync(new URL('src/ui/i18n.js', root), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');

  assert.match(guide, /How to play/);
  assert.match(guide, /No-Wilds/);
  assert.equal(manifest.start_url, './?lang=en');
  assert.match(agent, /LIAR'S DICE · RULES/);
  assert.match(i18n, /Write every natural-language value/);
  assert.match(pkg.scripts.dist, /about\.en\.html/);
  assert.match(pkg.scripts.dist, /manifest\.en\.webmanifest/);
  assert.match(sw, /about\.en\.html/);
  assert.match(sw, /src\/ui\/i18n\.js/);
});
