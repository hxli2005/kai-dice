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

  // 榜的数字现在由 verified-board.json 出（不再写死在 HTML 里），分母口径改在数据上验
  const board = JSON.parse(read('docs/arena/verified-board.json'));
  assert.equal(board.scope, '在这张桌子上');
  for (const row of board.flavor) {
    assert.ok(row.n.seenBids >= 0 && row.n.bids > 0 && row.n.rounds > 0, `${row.model} 缺分母`);
    for (const key of ['bluffRate', 'knowingBluffRate', 'blindBidRate'])
      assert.ok(row[key] == null || (row[key] >= 0 && row[key] <= 1), `${row.model}.${key} 越界`);
  }
  for (const arm of board.arms) {
    assert.equal(arm.record[0] + arm.record[1], arm.matches, `${arm.model} vs ${arm.opponent} 战绩对不上场次`);
    assert.equal(arm.grades.clean + arm.grades.light + arm.grades.spoiled, arm.matches, '三档分级要盖住全部场次');
    assert.equal(arm.cleanRecord[0] + arm.cleanRecord[1], arm.grades.clean, '零顶班战绩只数净场');
  }
});

test('Q93：本桌榜就是昨晚那批干净集，榜与实录同源', () => {
  const board = JSON.parse(read('docs/arena/verified-board.json'));
  const archive = JSON.parse(read('docs/arena/verified-replay.json'));
  assert.equal(board.set, '干净集 v2');
  assert.equal(board.totals.matches, archive.matches.length, '榜上的场数＝实录里的场数');
  assert.deepEqual(board.batches, archive.batches, '榜与实录必须出自同一批跑批');
  assert.equal(board.totals.arms, 22);
  assert.equal(board.totals.models, 7);
  assert.ok(board.batches.every((b) => b.startsWith('2026-08-11')), '干净集全部来自 2026-08-11');
  // 实录里每一场都要能说清自己来自哪一批
  const batches = new Set(board.batches);
  for (const match of archive.matches) assert.ok(batches.has(match.batch), `${match.seed} 没有来源批次`);
});

test('Q93：发布包只带产品竞技场与裁剪后的公开实录', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.dist, /docs\/arena\/live\.html/);
  assert.match(pkg.scripts.dist, /docs\/arena\/verified-replay\.json/);
  assert.doesNotMatch(pkg.scripts.dist, /cp -R docs/);

  assert.match(pkg.scripts.dist, /docs\/arena\/verified-board\.json/);

  const archivePath = new URL('../docs/arena/verified-replay.json', import.meta.url);
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  assert.equal(archive.schema, 'kai.arena.public-replay.v2');
  assert.equal(archive.scope, '在这张桌子上');
  assert.equal(archive.matches.length, 44);
  // 只在点「载入实录」时才取，且这类中文 JSON 压缩后约剩四分之一；
  // 上限守的是"别把整份原始跑批（4.6MB 起）当产品发出去"。
  assert.ok(fs.statSync(archivePath).size < 1_200_000, '公开复盘应保持裁剪后的体积');
  assert.ok(fs.statSync(new URL('../docs/arena/verified-board.json', import.meta.url)).size < 60_000, '本桌榜要小到可随手取');

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
