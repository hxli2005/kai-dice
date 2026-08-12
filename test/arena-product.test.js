import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Q93：大厅有普通玩家可见的模型竞技场入口', () => {
  const main = read('src/ui/main.js');
  assert.match(main, /href="docs\/arena\/live\.html"/);
  assert.match(main, /模型竞技场/);
  assert.match(main, /双模型自战 · BYOK/);
});

test('Q93：竞技场守住 BYOK、无关联声明与本桌分母口径', () => {
  const html = read('docs/arena/live.html');
  assert.match(html, /非官方 · 无关联/);
  assert.match(html, /直播只走 BYOK/);
  assert.match(html, /在这张桌子上/);
  assert.match(html, /返回《开！》大厅/);
  assert.doesNotMatch(html, /href="(?:replay|review)\.html/);

  const ratios = [...html.matchAll(/<td data-label="(?:胜率|开牌命中|降级)">([^<]+)<\/td>/g)].map((match) => match[1]);
  assert.equal(ratios.length, 6);
  assert.ok(ratios.every((value) => /n=\d+/.test(value)), ratios.join('；'));
});

test('Q93：发布包只带产品竞技场与裁剪后的公开实录', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.dist, /docs\/arena\/live\.html/);
  assert.match(pkg.scripts.dist, /docs\/arena\/verified-replay\.json/);
  assert.doesNotMatch(pkg.scripts.dist, /cp -R docs/);

  const archivePath = new URL('../docs/arena/verified-replay.json', import.meta.url);
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  assert.equal(archive.schema, 'kai.arena.public-replay.v1');
  assert.equal(archive.scope, '在这张桌子上');
  assert.equal(archive.matches.length, 8);
  assert.ok(fs.statSync(archivePath).size < 300_000, '公开复盘应保持轻量');

  const live = read('docs/arena/live.js');
  assert.match(live, /const ARCHIVE_RUN = 'verified-replay\.json'/);
  const serviceWorker = read('sw.js');
  // 只锁"缓存名带版本号"（改了壳就得升版，否则老客户端拿不到新代码），不锁具体第几版
  assert.match(serviceWorker, /const CACHE = 'kai-shell-v\d+'/);
  assert.match(serviceWorker, /docs\/arena\/verified-replay\.json/);
});

test('竞技场直播保持人机对战的纵向三管语法', () => {
  const html = read('docs/arena/live.html');
  const css = read('docs/arena/live.css');
  const live = read('docs/arena/live.js');

  assert.match(html, /id="liveCabinet"[^>]+data-match-state="idle"/);
  assert.match(html, /class="duel-stage"/);
  assert.match(html, /AI × AI · 单场对局/);
  assert.ok(html.indexOf('id="sideA"') < html.indexOf('id="felt"'));
  assert.ok(html.indexOf('id="felt"') < html.indexOf('id="sideB"'));

  assert.match(css, /\.duel-stage\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.doesNotMatch(css, /\.tube-stack\s*\{[^}]*minmax\(9rem/s);
  assert.match(css, /\.arena-tube--b\s*\{[^}]*text-align:\s*end/s);
  assert.match(live, /function setCabinetPhase\(phase\)/);
  assert.match(live, /function previewSeats\(\)/);
});
