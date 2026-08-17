import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { language, outputLanguageRule, translateUiText } from '../src/ui/i18n.js';

test('English adaptation keeps Chinese as the non-browser default', () => {
  assert.equal(language(), 'zh');
  assert.equal(translateUiText('开局'), '开局');
});

test('英文输出规则明确要求翻译中文素材且不得用中文回答', () => {
  assert.match(outputLanguageRule('en'), /Translate any Chinese source material/);
  assert.match(outputLanguageRule('en'), /never answer in Chinese/);
  assert.equal(outputLanguageRule('zh'), '');
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
  assert.match(html, /id="tubeSpeech"[^>]*data-raw/);
});

// PHRASES 是顺序子串替换：短片段会排在长片段前面，把后者的机会吃掉，
// 还会啃穿本来不该动的句子。`['改','EDIT']` 就这么把「点此改为公开」变成
// 「点此EDIT为公开」，并让两条完整句子的替换永远命中不了。
test('短片段不许进 PHRASES（子串替换会啃穿句子）', () => {
  const i18n = fs.readFileSync(new URL('../src/ui/i18n.js', import.meta.url), 'utf8');
  const body = i18n.slice(i18n.indexOf('const PHRASES'), i18n.indexOf('const DYNAMIC'));
  const keys = [...body.matchAll(/^\s*\['([^']+)',/gm)].map((m) => m[1]);
  assert.ok(keys.length > 50, '没抽到 PHRASES 键，测试本身失效了');
  // 守的是**裸单字**：没有空格之类的分隔符兜着，它能匹配到任何位置，`改` 就是这么闯的祸。
  // 带分隔的片段（` 口`／` 秒`／` 场 `）危险性低一档，且模型留档那边已由 data-raw 兜底，
  // 但它们仍会啃我们自己的拼接文案——那批的正解是改走 isEnglish() 分支，已记 Q105。
  const bareSingles = keys.filter((k) => k === k.trim() && k.length < 2);
  assert.deepEqual(bareSingles, [], `裸单字片段会啃穿别的句子：${bareSingles.join('／')}`);
});

test('界面文案整句翻译，不留半截', () => {
  assert.equal(
    translateUiText('翻小本子这件事：他知道（点此改为不告诉他）', 'en'),
    'Opening the notebook: the AI knows (click to make it private)',
  );
  assert.equal(translateUiText('被戳 3 次 · 嘴硬 2 改口 1', 'en'), 'POKED 3 TIMES · HELD 2 FOLDED 1');
  assert.equal(translateUiText('改天再说', 'en'), '改天再说'); // 不是界面文案的中文，一个字都不许动
});

test('字体不得阻塞渲染（大陆不可达时会白屏）', () => {
  for (const page of ['index.html', 'docs/arena/live.html']) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const gf = html.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/)?.[0] ?? '';
    assert.ok(gf, `${page} 找不到字体 link`);
    assert.match(gf, /media="print"/, `${page} 的字体 link 仍在阻塞渲染`);
  }
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
  assert.match(agent, /'v10-en'/);
  assert.match(pkg.scripts.dist, /about\.en\.html/);
  assert.match(pkg.scripts.dist, /manifest\.en\.webmanifest/);
  assert.match(sw, /about\.en\.html/);
  assert.match(sw, /src\/ui\/i18n\.js/);
});

test('英文 DOM 适配器不监听自己写回的文字', () => {
  const source = fs.readFileSync(new URL('../src/ui/i18n.js', import.meta.url), 'utf8');
  const options = source.match(/observer\.observe\(document\.body,\s*\{([^}]+)\}\)/)?.[1] ?? '';
  assert.match(options, /childList:\s*true/);
  assert.match(options, /subtree:\s*true/);
  assert.doesNotMatch(options, /characterData/);
});
