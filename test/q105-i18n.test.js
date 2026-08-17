import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CATALOG } from '../src/mods/catalog.js';
import {
  archiveTableCopy,
  drawerCoreCopy,
  matchReportCopy,
  modActionLabel,
  modDisplay,
} from '../src/ui/copy.js';

const CJK = /[\u3400-\u9fff]/;

const reportFixture = {
  sandbox: false,
  matchNo: 3,
  trio: true,
  standings: '1. you　2. deepseek-v4-flash　3. deepseek-v4-pro',
  won: true,
  roundsAlive: 4,
  rounds: 7,
  chips: -2,
  bluffRate: 0.5,
  seenBids: 8,
  myBluffs: 4,
  knowingBluffs: 2,
  thinBluffs: 2,
  knowingWildest: { count: 5, face: 3 },
  blindBids: 2,
  blindWildest: { count: 4, face: 6 },
  callsByOpponent: [
    { name: 'deepseek-v4-flash', hits: 1, calls: 2, calledYou: 3 },
    { name: 'deepseek-v4-pro', hits: 2, calls: 3, calledYou: 1 },
  ],
  challengeHits: 3,
  challenges: 5,
  calzaHits: 1,
  calzas: 2,
  timesChallenged: 4,
  avgTimeSeconds: '2.4',
};

test('Q105 match report renders complete English sentences around dynamic values', () => {
  const report = matchReportCopy(reportFixture, true);
  const text = [report.heading, ...report.rows.flat(), report.changeTable, report.playAgain, report.review, report.footer].join('\n');
  assert.equal(report.heading, 'MATCH REPORT · MATCH 3');
  assert.match(text, /YOU PLAYED 4 ROUNDS · TABLE TOTAL 7 ROUNDS/);
  assert.match(text, /WILDEST 5 × 3/);
  assert.match(text, /VS deepseek-v4-flash 1\/2/);
  assert.match(text, /CALZA\n1\/2/);
  assert.doesNotMatch(text, CJK);
});

test('Q105 archive headers and result cells render explicitly in English', () => {
  const archive = archiveTableCopy(
    [
      { won: true, bluffRate: 0.25, myChallengeHits: 1, myChallenges: 2 },
      { won: false, bluffRate: 0.5, myChallengeHits: 0, myChallenges: 1 },
    ],
    true,
  );
  assert.deepEqual(archive.headers, ['MATCH', 'RESULT', 'BLUFF', 'CALLS']);
  assert.deepEqual(archive.rows.map((row) => row.result), ['WIN', 'LOSS']);
  assert.doesNotMatch(JSON.stringify(archive), CJK);
});

test('Q105 rules and opponent drawer use complete English bodies and English guide link', () => {
  const drawer = drawerCoreCopy(true);
  const html = [drawer.lobbyNav, drawer.tableNav(true), drawer.rules, drawer.opponent, drawer.modsHeading].join('\n');
  assert.match(html, /Bids must rise/);
  assert.match(html, /The model is the opponent/);
  assert.match(html, /There is no persona script/);
  assert.match(html, /href="about\.en\.html"/);
  assert.doesNotMatch(html, CJK);
});

test('Q105 official mod cards and buttons have English display fields without rewriting canonical records', () => {
  for (const mod of CATALOG) {
    const view = modDisplay(mod, true);
    assert.ok(view.name && view.card, mod.id);
    assert.equal(view.raw, false);
    assert.doesNotMatch(`${view.name}\n${view.card}`, CJK, mod.id);
    for (const action of mod.actions) assert.doesNotMatch(modActionLabel(action, mod, true), CJK, action.type);
  }
  assert.equal(CATALOG[0].name, '亮一颗');
  assert.match(CATALOG[0].card, /看过骰后/);
});

test('Q105 model-authored wish cards remain raw instead of being post-translated', () => {
  const wish = {
    origin: 'wish',
    name: '模型原名',
    card: '模型当时写下的规则卡。',
    actions: [{ type: 'yuan', label: '愿' }],
  };
  assert.deepEqual(modDisplay(wish, true), { name: wish.name, card: wish.card, raw: true });
  assert.equal(modActionLabel(wish.actions[0], wish, true), '愿');

  const main = fs.readFileSync(new URL('../src/ui/main.js', import.meta.url), 'utf8');
  assert.match(main, /view\.raw \? `<span data-raw>\$\{view\[field\]\}<\/span>`/);
  assert.match(main, /<p class="note-item" data-raw>\$\{r\.card\}<\/p>/);
  assert.match(main, /class="verdict"\$\{raw \? ' data-raw' : ''\}/);
});

test('Q105 first-game coach has direct English render branches for both layouts', () => {
  const main = fs.readFileSync(new URL('../src/ui/main.js', import.meta.url), 'utf8');
  const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok([...main.matchAll(/c\.innerHTML = isEnglish\(\)/g)].length >= 2);
  assert.match(main, /Tap the lower dice bay to peek/);
  assert.match(main, /Bids must rise: increase the count/);
  assert.match(main, /BLIND ×2, NO-WILDS ×1\.5, and RAISE ×2/);
  assert.match(serviceWorker, /src\/ui\/copy\.js/);
});
