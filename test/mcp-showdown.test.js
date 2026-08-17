import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startCoordinator } from '../scripts/mcp/lib/coordinator-http.mjs';
import {
  labelsForAgentSeats,
  mcpArgsForAgent,
  renderSummary,
  resolveAgentSeats,
  summarizeAgentResult,
} from '../scripts/mcp/lib/agent-seats.mjs';
import { CHALLENGE_ASSERTION, createShowdown } from '../scripts/mcp/lib/showdown.mjs';
import { allLegalBids } from '../src/rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seatServer = path.resolve(here, '../scripts/mcp/seat-server.mjs');

test('Agent 换席：标签、胜者、比分、动作与摘要按真实映射', () => {
  const seats = resolveAgentSeats('b');
  assert.deepEqual(seats, {
    codex: 'B',
    claude: 'A',
    bySeat: { B: 'codex', A: 'claude' },
  });
  assert.deepEqual(labelsForAgentSeats(seats, {
    codexModel: 'gpt-5.6-sol',
    claudeModel: 'opus',
  }), {
    A: 'Claude Code · opus',
    B: 'Codex · gpt-5.6-sol',
  });
  assert.throws(() => resolveAgentSeats('C'), /must be A or B/);
  const connection = {
    seatServer: '/game/seat-server.mjs',
    coordinator: 'http://127.0.0.1:1234',
    tokens: { A: 'token-a', B: 'token-b' },
  };
  assert.deepEqual(mcpArgsForAgent('codex', seats, connection), [
    '/game/seat-server.mjs', '--seat', 'B',
    '--coordinator', 'http://127.0.0.1:1234',
    '--token', 'token-b',
  ]);
  assert.deepEqual(mcpArgsForAgent('claude', seats, connection), [
    '/game/seat-server.mjs', '--seat', 'A',
    '--coordinator', 'http://127.0.0.1:1234',
    '--token', 'token-a',
  ]);

  const snapshot = {
    seed: 42,
    bestOf: 3,
    winner: 'A',
    series: { wins: { A: 2, B: 1 }, completedGames: [{}, {}] },
    decisions: [{ seat: 'A' }, { seat: 'A' }, { seat: 'B' }],
    dialogue: [],
    rejections: [],
    events: [{
      type: 'roundEnd',
      game: 2,
      round: 4,
      winner: 'A',
      loser: 'B',
      diceCount: { A: 4, B: 3 },
    }],
  };
  assert.deepEqual(summarizeAgentResult(snapshot, seats), {
    winnerSeat: 'A',
    winnerAgent: 'claude',
    winnerName: 'Claude Code',
    score: { codex: 1, claude: 2 },
    actions: { codex: 1, claude: 2 },
  });
  const summary = renderSummary(snapshot, {
    versions: { codex: 'codex-cli test', claude: 'claude test' },
  }, seats);
  assert.match(summary, /席位：Codex B 席 \/ Claude Code A 席/);
  assert.match(summary, /系列比分：Codex 1–2 Claude Code/);
  assert.match(summary, /胜者：\*\*Claude Code（A 席）\*\*/);
  assert.match(summary, /已接受动作：3（Codex 1 \/ Claude Code 2）/);
  assert.match(summary, /\| 2 \| 4 \| Claude Code \| Codex \| 3–4 \|/);
});

test('MCP 对局：席位隔离、陈旧状态、发言转发与开牌语义', async () => {
  const game = await createShowdown({ seed: 7 });
  const a0 = game.observe('A');
  const b0 = game.observe('B');
  assert.equal(a0.current.yourDice, null);
  assert.equal(b0.current.yourDice, null);

  const a1 = await game.act('A', {
    stateId: a0.stateId,
    belief: '先看自己的骰子',
    action: { type: 'peek' },
    say: '我先看看。',
    note: '看骰是公开动作',
  });
  assert.equal(a1.current.yourDice.length, 5);
  const b1 = game.observe('B');
  assert.equal(b1.current.yourDice, null, 'B 不得看到 A 的私骰');
  assert.ok(!JSON.stringify(b1).includes(JSON.stringify(a1.current.yourDice)), '摊牌前接口不得串牌');
  assert.equal(b1.tableTalk.at(-1).text, '我先看看。');
  assert.ok(b1.newEvents.every((event) => !Object.hasOwn(event, 'elapsedMs')), '席位不得收到原始毫秒');
  const live = game.spectate();
  assert.equal(live.current.hands.A.length, 5);
  assert.equal(live.current.hands.B, null, '观战层也不为未看骰席位开引擎后门');
  assert.ok(live.events.every((event) => !Object.hasOwn(event, 'elapsedMs')));
  assert.ok(live.decisions.every((decision) => !Object.hasOwn(decision, 'thinkMs')));

  await assert.rejects(
    () => game.act('A', {
      stateId: a0.stateId,
      belief: '',
      action: { type: 'bid', count: 2, face: 2 },
      say: '',
      note: '',
    }),
    /stale state/,
  );
  assert.equal(game.snapshot().rejections.at(-1).code, 'STALE_STATE');
  await assert.rejects(
    () => game.act('A', {
      stateId: a1.stateId,
      belief: '',
      action: { type: 'challenge' },
      say: '',
      note: '',
    }),
    new RegExp(CHALLENGE_ASSERTION),
  );
});

test('HTTP 协调器：两个令牌只能访问自己的席位', async (t) => {
  const coordinator = await startCoordinator({
    seed: 3,
    tokens: { A: 'token-a', B: 'token-b' },
    adminToken: 'admin',
  });
  t.after(() => coordinator.close());
  const call = (seat, token) => fetch(`${coordinator.url}/seat/${seat}/observe`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal((await call('A', 'token-a')).status, 200);
  assert.equal((await call('B', 'token-a')).status, 403);
  assert.equal((await call('B', 'token-b')).status, 200);
});

test('私有直播：静态页、快照与 SSE 都随合法动作更新', async (t) => {
  const coordinator = await startCoordinator({
    seed: 13,
    tokens: { A: 'token-a', B: 'token-b' },
    adminToken: 'admin',
    labels: { A: 'Codex', B: 'Claude Code' },
  });
  t.after(() => coordinator.close());

  const page = await fetch(coordinator.spectatorUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /《开！》私有直播/);
  const css = await fetch(`${coordinator.url}/spectate/live.css`);
  assert.equal(css.status, 200);
  assert.match(await css.text(), /macrostructure: Map \/ Diagram/);

  const stream = await fetch(`${coordinator.url}/spectate/events`);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  let buffer = '';
  const nextSnapshot = async () => {
    for (let i = 0; i < 100; i++) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event.split('\n').find((line) => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += new TextDecoder().decode(chunk.value, { stream: true });
    }
    throw new Error('SSE snapshot timeout');
  };

  const initial = await nextSnapshot();
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.labels, { A: 'Codex', B: 'Claude Code' });
  const view = coordinator.showdown.observe('A');
  await coordinator.showdown.act('A', {
    stateId: view.stateId,
    belief: '先看骰',
    action: { type: 'peek' },
    say: '看一眼。',
    note: '直播测试',
  });
  const updated = await nextSnapshot();
  assert.equal(updated.revision, 1);
  assert.equal(updated.current.hands.A.length, 5);
  assert.equal(updated.decisions[0].belief, '先看骰');
  await reader.cancel();
});

test('人类牌桌：只开放本人席位操作，并可关闭泄露暗骰的观战入口', async (t) => {
  const coordinator = await startCoordinator({
    seed: 17,
    tokens: { A: 'human-token', B: 'claude-token' },
    adminToken: 'admin',
    labels: { A: 'Human', B: 'Claude Code · opus' },
    spectatorEnabled: false,
    playEnabled: true,
  });
  t.after(() => coordinator.close());

  assert.equal(coordinator.spectatorUrl, null);
  assert.equal(coordinator.playUrl, `${coordinator.url}/play`);
  const page = await fetch(coordinator.playUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /你 vs 本地 Agent/);
  assert.match(html, /id="challengeBtn"/);
  assert.match(html, /id="humanState"/);
  assert.match(html, /id="opponentState"/);
  assert.match(html, /id="talkLog"/);
  assert.match(html, /id="languageToggle"/);
  assert.match(html, /你只能看到自己的暗骰/);
  const script = await fetch(`${coordinator.url}/play/play.js`);
  assert.equal(script.status, 200);
  const scriptText = await script.text();
  assert.match(scriptText, /\{agent\} is deciding/);
  assert.match(scriptText, /function renderTalk/);
  assert.match(scriptText, /kai-human-play-language/);
  assert.match(scriptText, /renderKey === talkRenderKey/);
  assert.match(scriptText, /wasPinnedToBottom/);
  assert.equal((await fetch(`${coordinator.url}/play/play.css`)).status, 200);
  assert.equal((await fetch(`${coordinator.url}/spectate`)).status, 404);
  assert.equal((await fetch(`${coordinator.url}/spectate/snapshot`)).status, 404);

  const observe = await fetch(`${coordinator.url}/seat/A/observe`, {
    method: 'POST',
    headers: { authorization: 'Bearer human-token', 'content-type': 'application/json' },
    body: '{}',
  });
  const before = await observe.json();
  assert.deepEqual(before.labels, { A: 'Human', B: 'Claude Code · opus' });
  assert.equal(before.current.yourDice, null);
  const peek = await fetch(`${coordinator.url}/seat/A/act`, {
    method: 'POST',
    headers: { authorization: 'Bearer human-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      stateId: before.stateId,
      action: { type: 'peek' },
      belief: '',
      say: '',
      note: '',
    }),
  });
  assert.equal(peek.status, 200);
  const after = await peek.json();
  assert.equal(after.current.yourDice.length, 5);
  assert.equal((await fetch(`${coordinator.url}/seat/B/observe`, {
    method: 'POST',
    headers: { authorization: 'Bearer human-token', 'content-type': 'application/json' },
    body: '{}',
  })).status, 403);
});

test('MCP 对局：两个最小合法客户端能完整打到终局', async () => {
  const game = await createShowdown({ seed: 11 });
  for (let step = 0; step < 500; step++) {
    const snapshot = game.snapshot();
    if (snapshot.over) break;
    for (const seat of ['A', 'B']) {
      const view = game.observe(seat);
      const legal = view.current.legal;
      if (!legal.length) continue;
      let action = legal.find((candidate) => candidate.type === 'peek');
      if (!action) {
        const canChallenge = legal.some((candidate) => candidate.type === 'challenge');
        if (canChallenge) action = { type: 'challenge', assert: CHALLENGE_ASSERTION };
        else {
          const bid = allLegalBids(
            view.current.currentBid,
            view.current.zhai,
            view.current.diceCount.you + view.current.diceCount.opp,
          )[0];
          action = { type: 'bid', ...bid };
        }
      }
      await game.act(seat, {
        stateId: view.stateId,
        belief: 'test client',
        action,
        say: '',
        note: 'first legal action',
      });
    }
  }
  const snapshot = game.snapshot();
  assert.equal(snapshot.over, true);
  assert.ok(['A', 'B'].includes(snapshot.winner));
  assert.equal(snapshot.events.at(-1).type, 'matchEnd');
});

test('BO3：同一协调器连续换场，先到两胜并轮换首手', async () => {
  const game = await createShowdown({ seed: 101, bestOf: 3 });
  for (let step = 0; step < 1500; step++) {
    if (game.snapshot().over) break;
    for (const seat of ['A', 'B']) {
      const view = game.observe(seat);
      const legal = view.current.legal;
      if (!legal.length) continue;
      let action = legal.find((candidate) => candidate.type === 'peek');
      if (!action) {
        if (legal.some((candidate) => candidate.type === 'challenge'))
          action = { type: 'challenge', assert: CHALLENGE_ASSERTION };
        else {
          const bid = allLegalBids(
            view.current.currentBid,
            view.current.zhai,
            view.current.diceCount.you + view.current.diceCount.opp,
          )[0];
          action = { type: 'bid', ...bid };
        }
      }
      await game.act(seat, {
        stateId: view.stateId,
        belief: `game ${view.series.game}`,
        action,
        say: '',
        note: 'series test',
      });
    }
  }

  const snapshot = game.snapshot();
  assert.equal(snapshot.over, true);
  assert.equal(snapshot.series.bestOf, 3);
  assert.equal(snapshot.series.wins[snapshot.winner], 2);
  assert.ok([2, 3].includes(snapshot.games.length));
  assert.deepEqual(snapshot.games.slice(0, 2).map((item) => item.firstSeat), ['A', 'B']);
  assert.deepEqual(snapshot.events.map((event) => event.i), snapshot.events.map((_, index) => index));
  assert.ok(snapshot.events.some((event) => event.game === 2));
  assert.ok(snapshot.decisions.some((decision) => decision.game === 2));
});

test('stdio MCP：Codex/Claude 所需 initialize、tools/list 与 observe 均可用', async (t) => {
  const coordinator = await startCoordinator({
    seed: 5,
    tokens: { A: 'token-a', B: 'token-b' },
    adminToken: 'admin',
  });
  t.after(() => coordinator.close());
  const child = spawn(process.execPath, [
    seatServer,
    '--seat', 'A',
    '--coordinator', coordinator.url,
    '--token', 'token-a',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));

  const messages = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) messages.push(JSON.parse(line));
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const waitFor = async (id) => {
    for (let i = 0; i < 100; i++) {
      const found = messages.find((message) => message.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timeout waiting for MCP response ${id}`);
  };

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const init = await waitFor(1);
  assert.equal(init.result.serverInfo.name, 'kai-liars-dice-seat-A');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const list = await waitFor(2);
  assert.deepEqual(list.result.tools.map((tool) => tool.name), [
    'observe_table', 'take_action', 'wait_for_change',
  ]);
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'observe_table', arguments: {} } });
  const observed = await waitFor(3);
  assert.equal(observed.result.structuredContent.seat, 'A');
  child.stdin.end();
  await once(child, 'exit');
});
