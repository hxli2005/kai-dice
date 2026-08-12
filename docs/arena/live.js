import { createMatch } from '../../src/engine.js';
import { groundEvents } from '../../src/grounding.js';
import { createOpponent } from '../../src/ai/agent.js';
import { createSilentBot } from '../../src/ai/silent.js';
import { ARENA_SEAT, pinSampling } from '../../src/arena/arena.js';
import { openrouterChannel, fetchModels, fetchEndpoints, pickDefaults } from '../../src/ai/openrouter.js';
import { chat } from '../../src/ai/llm.js';

const $ = (id) => document.getElementById(id);
const KEY = 'kai.arena.key';
const LOCAL_MATCHES_KEY = 'kai.arena.local.matches.v1';
const ARCHIVE_RUN = 'verified-replay.json';
const DECIDED = new Set(['bid', 'challenge', 'peek', 'calc', 'declare', 'modAction']);
const DECL = { zhai: '斋', blind: '盲', raise: '抬' };
const PIPS = {
  1: ['c'],
  2: ['tl', 'br'],
  3: ['tl', 'c', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};

const esc = (value) => String(value ?? '').replace(/[<>&"]/g, (char) => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
})[char]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shortModel = (model) => String(model ?? '').split('/').at(-1) || '未命名型号';
const modelLabel = (match, seat) => match?.seats?.[seat] ?? seat;
// G2 旧档迁移：接地之前落盘的实录用 {player} 且不带 target，在**载入边界**补齐四元组。
// 这是唯一允许回推主客体的地方，且只对历史数据；活引擎的事件本就自带四元组（幂等）。
const groundRun = (run) => ({
  ...run,
  matches: (run.matches ?? []).map((match) => ({ ...match, events: groundEvents(match.events ?? []) })),
});

let stopped = false;
let running = false;
let hands = { A: null, B: null };
let seats = { A: '', B: '' };
let catalogById = new Map();
let replayRun = { matches: [] };
let replayIndex = 0;

function activateView(name, moveFocus = false) {
  const panels = [...document.querySelectorAll('[data-view]')];
  const tabs = [...document.querySelectorAll('[data-view-target]')];
  for (const panel of panels) {
    const active = panel.dataset.view === name;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  }
  for (const tab of tabs) {
    const active = tab.dataset.viewTarget === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && moveFocus) tab.focus({ preventScroll: true });
  }
  if (name === 'board') renderLocalBoard();
  if (name === 'replay') renderReplay();
}

for (const tab of document.querySelectorAll('[data-view-target]')) {
  tab.addEventListener('click', () => activateView(tab.dataset.viewTarget));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-view-target]')];
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activateView(tabs[next].dataset.viewTarget, true);
  });
}

for (const jump of document.querySelectorAll('[data-view-jump]')) {
  jump.addEventListener('click', () => activateView(jump.dataset.viewJump, true));
}

function setCabinetStatus(text, tone = 'idle') {
  $('stat').dataset.tone = tone;
  $('stat').lastElementChild.textContent = text;
}

function setCabinetPhase(phase) {
  $('liveCabinet').dataset.matchState = phase;
  if (phase !== 'idle') $('liveCabinet').closest('.arena-split')?.classList.add('has-match');
}

function setFormMessage(text, tone = 'idle') {
  $('catalogState').textContent = text;
  $('catalogState').dataset.tone = tone;
}

function setRunState(state) {
  running = state === 'loading';
  $('go').disabled = running;
  $('stop').disabled = !running;
  $('go').dataset.state = state;
  $('go').querySelector('.button-label').textContent = state === 'loading'
    ? '参赛体检中'
    : state === 'success'
      ? '比赛完成'
      : state === 'error'
        ? '重新启动'
        : '启动比赛';
  for (const id of ['mA', 'mB']) $(id).disabled = running;
}

function markKeyError(message) {
  $('key').setAttribute('aria-invalid', 'true');
  $('keyHelp').textContent = message;
  setFormMessage(message, 'error');
  setRunState('error');
  $('key').focus();
}

$('key').value = localStorage.getItem(KEY) ?? '';
$('key').addEventListener('change', () => localStorage.setItem(KEY, $('key').value.trim()));
$('key').addEventListener('input', () => {
  $('key').removeAttribute('aria-invalid');
  $('keyHelp').textContent = '只存在这台设备，浏览器直接连接 OpenRouter。';
  if (!running) setRunState('idle');
});

async function loadCatalog() {
  for (const id of ['mA', 'mB']) $(id).dataset.state = 'loading';
  try {
    const catalog = await fetchModels({});
    catalogById = new Map(catalog.map((model) => [model.id, model]));
    const options = catalog
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((model) => `<option value="${esc(model.id)}">${esc(model.id)}</option>`)
      .join('');
    for (const id of ['mA', 'mB']) {
      $(id).innerHTML = options;
      $(id).dataset.state = 'success';
    }
    const defaults = pickDefaults(catalog).map((model) => model.id);
    $('mA').value = defaults[0] ?? catalog[0]?.id ?? '';
    $('mB').value = defaults[1] ?? catalog[1]?.id ?? catalog[0]?.id ?? '';
    previewSeats();
    setFormMessage(`已读取 ${catalog.length} 个可选型号。`, 'success');
  } catch (error) {
    for (const id of ['mA', 'mB']) {
      $(id).innerHTML = '<option value="">模型目录不可用</option>';
      $(id).dataset.state = 'error';
      $(id).setAttribute('aria-invalid', 'true');
    }
    setFormMessage(`模型目录没有读取成功：${error.message}。检查网络后刷新页面。`, 'error');
  }
}

function die(face, className = '') {
  if (!face) return `<span class="arena-die is-back ${className}" aria-label="未看骰"></span>`;
  const pips = PIPS[face].map((pip) => `<i class="p-${pip}"></i>`).join('');
  return `<span class="arena-die ${className}" aria-label="${face} 点">${pips}</span>`;
}

function drawWaitingSeat(seat, model) {
  const tube = $(`side${seat}`);
  const color = seat === 'A' ? '绿管' : '琥珀管';
  tube.className = `arena-tube arena-tube--${seat.toLowerCase()}`;
  tube.innerHTML = `
    <div class="tube-line"><span class="tube-seat">${seat} 席 · ${color}</span><span class="tube-state">候场</span></div>
    <div class="tube-id" title="${esc(model)}">${esc(model ? shortModel(model) : '等待模型入席')}</div>
    <div class="tube-meta">${model ? '已入席 · 5 颗 · 等待开赛' : '选择型号后显示在这里'}</div>
    ${model ? `<div class="arena-dice">${Array.from({ length: 5 }, () => die(null)).join('')}</div>` : ''}`;
}

function previewSeats() {
  if (running) return;
  drawWaitingSeat('A', $('mA').value);
  drawWaitingSeat('B', $('mB').value);
}

function setSeatState(seat, text) {
  const state = $(`side${seat}`).querySelector('.tube-state');
  if (state) state.textContent = text;
}

for (const id of ['mA', 'mB']) $(id).addEventListener('change', previewSeats);

function drawSides(observation, turn) {
  for (const seat of ['A', 'B']) {
    const alive = observation.players.find((player) => player.id === seat)?.diceCount ?? 0;
    const hand = hands[seat];
    const tube = $(`side${seat}`);
    tube.className = `arena-tube arena-tube--${seat.toLowerCase()}${turn === seat ? ' is-turn' : ''}`;
    const dice = hand
      ? hand.map((face, index) => die(face, index >= alive ? 'is-gone' : '')).join('')
      : Array.from({ length: alive }, () => die(null)).join('');
    const notes = [
      `${alive} 颗`,
      observation.blind?.[seat] ? '盲着打' : '',
      observation.calced?.[seat] ? '拨过算盘' : '',
      hand ? '已看骰' : '未看骰',
    ].filter(Boolean).join(' · ');
    tube.innerHTML = `
      <div class="tube-line"><span class="tube-seat">${seat} 席 · ${seat === 'A' ? '绿管' : '琥珀管'}</span><span class="tube-state">${turn === seat ? '决策中' : turn ? '等待对手' : '等待裁判'}</span></div>
      <div class="tube-id" title="${esc(seats[seat])}">${esc(shortModel(seats[seat]))}</div>
      <div class="tube-meta">${esc(notes)}</div>
      <div class="arena-dice">${dice}</div>`;
  }
}

function drawFelt(observation, openText = '') {
  const felt = $('felt');
  felt.className = `arena-tube arena-tube--judge${openText ? ' is-open' : ''}`;
  if (openText) {
    felt.innerHTML = `<div class="judge-kicker">裁判 / 开牌结算</div><div class="judge-reading">${esc(openText)}</div><div class="judge-meta">结果已写入引擎流水</div>`;
    return;
  }
  const bid = observation.currentBid ? `${observation.currentBid.count} 个 ${observation.currentBid.face}` : '——';
  felt.innerHTML = `
    <div class="judge-kicker">裁判 / 当前报价</div>
    <div class="judge-reading">${esc(bid)}</div>
    <div class="judge-meta">第 ${observation.round} 局 · 池 ${observation.potUnits} 注${observation.zhai ? ' · 斋局' : ''}</div>`;
}

function pushLog(html, className = '') {
  $('talk').querySelector('.signal-log__empty')?.remove();
  const row = document.createElement('div');
  row.className = className;
  row.innerHTML = html;
  $('talk').append(row);
  $('talk').scrollTop = $('talk').scrollHeight;
}

function actionText(action) {
  if (!action) return '未记录动作';
  if (action.type === 'bid') return `报 ${action.count} 个 ${action.face}`;
  if (action.type === 'challenge') return '开';
  if (action.type === 'calc') return '拨算盘';
  if (action.type === 'peek') return '掀盅看骰';
  if (action.type === 'declare') return `宣「${DECL[action.declaration] ?? action.declaration}」`;
  if (action.type === 'modAction') return action.label ?? action.mod ?? '使用词条';
  return action.type;
}

async function lockedChannel(apiKey, model) {
  const tags = [...new Set(
    (await fetchEndpoints(model, {})).map((endpoint) => endpoint.tag).filter(Boolean),
  )];
  if (!tags.length) throw new Error('模型目录没有返回可锁定的供应商后端');
  let lastError = '没有可用后端';
  for (const tag of tags) {
    const channel = openrouterChannel({
      apiKey,
      model,
      modelInfo: catalogById.get(model),
      providerTag: tag,
    });
    try {
      await chat(pinSampling(channel), {
        system: '回复 ok',
        user: 'ok',
        maxTokens: 16,
        timeoutMs: 20_000,
      });
      return { channel, tag };
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
  }
  throw new Error(lastError);
}

function localMatches() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_MATCHES_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveLocalMatch(match) {
  const next = [match, ...localMatches()].slice(0, 12);
  try {
    localStorage.setItem(LOCAL_MATCHES_KEY, JSON.stringify(next));
    return true;
  } catch {
    setFormMessage('比赛已经完成，但本机存储空间不足，未写入客场记录。', 'error');
    return false;
  }
}

async function runMatch() {
  if (running) return;
  const apiKey = $('key').value.trim();
  if (!apiKey) {
    markKeyError('API Key 为空。填入 OpenRouter Key，再启动比赛。');
    return;
  }
  const modelA = $('mA').value;
  const modelB = $('mB').value;
  if (!modelA || !modelB) {
    setFormMessage('型号还没有准备好。等待目录读取完成，或检查网络后刷新。', 'error');
    setRunState('error');
    return;
  }

  localStorage.setItem(KEY, apiKey);
  seats = { A: modelA, B: modelB };
  stopped = false;
  setRunState('loading');
  setCabinetPhase('checking');
  setFormMessage('正在逐席体检，并锁定可用后端。');
  setCabinetStatus('参赛体检', 'live');
  $('talk').innerHTML = '';

  const channels = {};
  for (const seat of ['A', 'B']) {
    setSeatState(seat, '体检中');
    setCabinetStatus(`${shortModel(seats[seat])} 体检`, 'live');
    try {
      const result = await lockedChannel(apiKey, seats[seat]);
      channels[seat] = result.channel;
      setSeatState(seat, '已锁定');
      pushLog(
        `<div class="log-hand__head"><span>${esc(shortModel(seats[seat]))}</span><span class="log-hand__action">体检通过${result.tag ? ` · 锁 ${esc(result.tag)}` : ''}</span></div>`,
        'log-hand',
      );
    } catch (error) {
      setSeatState(seat, '未通过');
      throw new Error(`${shortModel(seats[seat])} 没有通过体检：${error.message}。更换型号或检查 OpenRouter 数据策略。`);
    }
  }

  const seed = Math.floor(Math.random() * 1_000_000);
  const match = await createMatch({ seed, config: { players: ['A', 'B'] } });
  const agents = {};
  for (const seat of ['A', 'B']) {
    agents[seat] = createOpponent({
      channel: pinSampling(channels[seat]),
      profile: '',
      persona: ARENA_SEAT,
    });
  }
  const backup = createSilentBot(ARENA_SEAT.strategy);
  let round = 0;
  let aborted = null;

  setFormMessage(`比赛 seed ${seed} 已开始。`, 'success');
  setCabinetPhase('live');
  setCabinetStatus('比赛进行中', 'live');

  for (let step = 0; step < 400 && !stopped; step += 1) {
    const firstObservation = match.observe('A');
    if (firstObservation.over) break;
    const turn = firstObservation.turn;
    const observation = turn === 'A' ? firstObservation : match.observe(turn);

    if (observation.round !== round) {
      round = observation.round;
      pushLog(`第 ${round} 局`, 'log-round');
    }

    hands = { A: match.observe('A').yourDice, B: match.observe('B').yourDice };
    drawSides(observation, turn);
    drawFelt(observation);
    setCabinetStatus(`${shortModel(seats[turn])} 决策中`, 'live');

    const decision = await agents[turn].decide(observation);
    if (stopped) {
      aborted = 'stopped';
      break;
    }

    if (decision.silentFallback) {
      pushLog(
        `<div class="log-hand__head"><span>${esc(shortModel(seats[turn]))}</span><span>${esc(actionText(decision.action))}</span></div><div>这一手由沉默 bot 顶班，不记在模型名下。</div>`,
        'log-hand is-warning',
      );
    } else {
      pushLog(
        `<div class="log-hand__head"><span>${esc(shortModel(seats[turn]))}</span><span class="log-hand__action">${esc(actionText(decision.action))}</span>${decision.speechMode === 'bait' ? '<span>诈</span>' : ''}</div>` +
          (decision.say ? `<div class="log-hand__say">“${esc(decision.say)}”</div>` : '') +
          (decision.belief ? `<div class="log-hand__belief">留档：${esc(decision.belief)}</div>` : ''),
        'log-hand',
      );
    }

    try {
      await match.act(turn, decision.action, { elapsedMs: null });
    } catch {
      const fallback = backup.decide(observation);
      const safe = observation.legal.some((action) => action.type === fallback.type) ? fallback : observation.legal[0];
      if (!safe) {
        aborted = 'stuck';
        break;
      }
      const rejectedLog = agents[turn].logs.at(-1);
      if (rejectedLog) rejectedLog.silentFallback = true;
      await match.act(turn, safe, { elapsedMs: null });
      pushLog('动作被引擎打回，沉默 bot 已接手这一手。', 'log-hand is-warning');
    }

    const current = match.observe('A');
    const reveal = current.events.findLast((event) => event.type === 'reveal');
    if (decision.action.type === 'challenge' && reveal) {
      hands = reveal.dice;
      drawSides(current, null);
      drawFelt(current, `实有 ${reveal.actual} 个 ${reveal.bid.face}`);
      pushLog(
        `开牌 · ${reveal.stands ? '报价成立，开的人输' : '报价不成立，报的人输'} · ${esc(shortModel(seats[reveal.loser]))} 掉一颗骰`,
        'log-open',
      );
      await sleep(1600);
    } else {
      await sleep(300);
    }
  }

  const final = match.observe('A');
  const end = final.events.findLast((event) => event.type === 'matchEnd');
  if (stopped && !aborted) aborted = 'stopped';
  const record = {
    seed,
    createdAt: new Date().toISOString(),
    seats: { ...seats },
    events: final.events,
    logs: { A: agents.A.logs, B: agents.B.logs },
    winner: end?.winner ?? null,
    aborted,
  };
  saveLocalMatch(record);
  replayRun = groundRun({ matches: localMatches() });
  replayIndex = 0;
  renderLocalBoard();

  if (end) {
    hands = final.events.findLast((event) => event.type === 'reveal')?.dice ?? hands;
    drawSides(final, null);
    drawFelt(final, `${shortModel(seats[end.winner])} 胜`);
    pushLog(`全场结束 · ${esc(shortModel(seats[end.winner]))} 胜`, 'log-open');
    setCabinetStatus('比赛完成', 'success');
    setCabinetPhase('complete');
    setFormMessage('比赛完成，已写入本机客场记录。', 'success');
    setRunState('success');
  } else {
    setCabinetStatus('比赛已停止', 'idle');
    setCabinetPhase('stopped');
    setFormMessage('比赛已停止，未完成的流水仍写入本机复盘。');
    setRunState('idle');
  }
}

$('matchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  runMatch().catch((error) => {
    setCabinetStatus('启动失败', 'error');
    setCabinetPhase('error');
    setFormMessage(error.message, 'error');
    pushLog(esc(error.message), 'log-hand is-warning');
    setRunState('error');
  });
});

$('stop').addEventListener('click', () => {
  stopped = true;
  setCabinetPhase('stopping');
  setCabinetStatus('正在停止', 'idle');
  $('stop').disabled = true;
});

function renderLocalBoard() {
  const matches = localMatches();
  $('clearLocal').disabled = matches.length === 0;
  if (!matches.length) {
    $('localBoardRows').innerHTML = '<div class="empty-state"><strong>本机还没有比赛</strong><span>从开赛页启动一场，结果会留在这里。</span><button class="arena-button arena-button--quiet" type="button" data-local-jump>去开一场</button></div>';
    $('[data-local-jump]')?.addEventListener('click', () => activateView('match', true));
    return;
  }

  const models = new Map();
  for (const match of matches) {
    for (const seat of ['A', 'B']) {
      const name = modelLabel(match, seat);
      const row = models.get(name) ?? { name, games: 0, wins: 0, incomplete: 0 };
      if (match.winner) row.games += 1;
      else row.incomplete += 1;
      if (match.winner === seat) row.wins += 1;
      models.set(name, row);
    }
  }
  $('localBoardRows').innerHTML = [...models.values()]
    .sort((a, b) => b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name))
    .map((row) => {
      const rate = row.games ? `${Math.round((row.wins / row.games) * 100)}%` : '—';
      return `<div class="local-row"><strong title="${esc(row.name)}">${esc(shortModel(row.name))}</strong><span>${rate} · n=${row.games}</span><span>${row.wins} 胜${row.incomplete ? ` · ${row.incomplete} 场未完` : ''}</span></div>`;
    })
    .join('');
}

$('clearLocal').addEventListener('click', () => {
  localStorage.removeItem(LOCAL_MATCHES_KEY);
  replayRun = { matches: [] };
  replayIndex = 0;
  renderLocalBoard();
  renderReplay();
});

function alignLogs(match) {
  const queues = { A: [...(match.logs?.A ?? [])], B: [...(match.logs?.B ?? [])] };
  return (match.events ?? []).map((event) => (
    DECIDED.has(event.type) && event.actor ? queues[event.actor].shift() ?? null : null
  ));
}

function eventText(event, match) {
  const who = (seat) => shortModel(modelLabel(match, seat));
  if (event.type === 'roundStart') return `第 ${event.round} 局 · ${who(event.first)} 先报`;
  if (event.type === 'peek') return `${who(event.actor)} 掀盅看骰`;
  if (event.type === 'calc') return `${who(event.actor)} 当众拨算盘`;
  if (event.type === 'bid') return `${who(event.actor)} 报 ${event.count} 个 ${event.face}`;
  if (event.type === 'declare') return `${who(event.actor)} 宣「${DECL[event.declaration] ?? event.declaration}」`;
  if (event.type === 'challenge') return `${who(event.actor)} 开 ${who(event.target)}`;
  if (event.type === 'reveal') return `开牌 · 实有 ${event.actual} 个 ${event.bid.face} · ${event.stands ? '报价成立' : '报价不成立'} · ${who(event.loser)} 掉一骰`;
  if (event.type === 'matchEnd') return `全场结束 · ${who(event.winner)} 胜`;
  if (event.type === 'modAction') return `${who(event.actor)} 使用词条`;
  return '';
}

function renderReplay() {
  const matches = replayRun.matches ?? [];
  if (!matches.length) {
    $('replayList').innerHTML = '<div class="empty-state"><strong>没有可列出的比赛</strong><span>本机比赛和导入实录会出现在这里。</span></div>';
    $('replayPane').innerHTML = '<div class="empty-state"><strong>还没有本机比赛</strong><span>先启动一场，或载入已有实录。</span><button class="arena-button arena-button--quiet" type="button" data-replay-jump>去开一场</button></div>';
    $('[data-replay-jump]')?.addEventListener('click', () => activateView('match', true));
    return;
  }

  replayIndex = Math.min(replayIndex, matches.length - 1);
  $('replayList').innerHTML = matches.map((match, index) => {
    const winner = match.winner ? `${shortModel(modelLabel(match, match.winner))} 胜` : `未完${match.aborted ? ` · ${match.aborted}` : ''}`;
    return `<button class="replay-item ${index === replayIndex ? 'is-active' : ''}" type="button" data-replay-index="${index}" aria-pressed="${index === replayIndex}"><span class="replay-item__meta">#${String(index + 1).padStart(2, '0')} · seed ${esc(match.seed)} · ${esc(winner)}</span><span class="replay-item__models">${esc(shortModel(modelLabel(match, 'A')))} vs ${esc(shortModel(modelLabel(match, 'B')))}</span></button>`;
  }).join('');
  for (const button of $('replayList').querySelectorAll('[data-replay-index]')) {
    button.addEventListener('click', () => {
      replayIndex = Number(button.dataset.replayIndex);
      renderReplay();
    });
  }
  renderReplayPane(matches[replayIndex]);
}

function renderReplayPane(match) {
  const logs = alignLogs(match);
  const rows = (match.events ?? []).map((event, index) => {
    const fact = eventText(event, match);
    if (!fact) return '';
    const log = logs[index];
    const warning = log?.silentFallback;
    const className = event.type === 'reveal' || event.type === 'matchEnd'
      ? 'replay-event is-open'
      : warning
        ? 'replay-event is-warning'
        : 'replay-event';
    return `<div class="${className}"><div class="replay-event__fact">${esc(fact)}${warning ? ' · 沉默 bot 顶班，非模型输出' : ''}</div>${!warning && log?.say ? `<div class="replay-event__say">“${esc(log.say)}”</div>` : ''}${!warning && log?.belief ? `<div class="replay-event__belief">当时留档：${esc(log.belief)}</div>` : ''}</div>`;
  }).join('');
  const winner = match.winner ? `${shortModel(modelLabel(match, match.winner))} 胜` : '比赛未完成';
  $('replayPane').innerHTML = `<header class="replay-pane__head"><h2>${esc(shortModel(modelLabel(match, 'A')))} vs ${esc(shortModel(modelLabel(match, 'B')))}</h2><p>seed ${esc(match.seed)} · ${esc(winner)} · ${(match.events ?? []).length} 条引擎事件</p></header>${rows || '<div class="empty-state"><strong>这场没有事件</strong><span>导入文件里没有可读取的引擎流水。</span></div>'}`;
}

async function loadArchive() {
  $('loadArchive').disabled = true;
  $('loadArchive').dataset.state = 'loading';
  $('loadArchive').textContent = '载入中';
  try {
    const response = await fetch(ARCHIVE_RUN);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (!Array.isArray(value.matches)) throw new Error('文件里没有 matches 数组');
    replayRun = groundRun(value);
    replayIndex = 0;
    renderReplay();
    $('loadArchive').dataset.state = 'success';
    $('loadArchive').textContent = `已载入 ${value.matches.length} 场`;
  } catch (error) {
    $('loadArchive').dataset.state = 'error';
    $('loadArchive').textContent = '载入实录失败';
    $('replayPane').innerHTML = `<div class="empty-state"><strong>实录没有载入</strong><span>${esc(error.message)}。请改用“导入 run.json”。</span></div>`;
  } finally {
    $('loadArchive').disabled = false;
  }
}

$('loadArchive').addEventListener('click', loadArchive);
$('runFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const value = JSON.parse(await file.text());
    if (!Array.isArray(value.matches)) throw new Error('文件里没有 matches 数组');
    replayRun = groundRun(value);
    replayIndex = 0;
    renderReplay();
  } catch (error) {
    $('replayPane').innerHTML = `<div class="empty-state"><strong>文件没有读入</strong><span>${esc(error.message)}。请选择竞技场生成的 run.json。</span></div>`;
  }
});

replayRun = groundRun({ matches: localMatches() });
renderLocalBoard();
renderReplay();
loadCatalog();
