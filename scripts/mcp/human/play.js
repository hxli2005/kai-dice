const $ = (id) => document.getElementById(id);
const ASSERT_FALSE = 'current_bid_is_false';
const hash = new URLSearchParams(location.hash.slice(1));
const seat = String(hash.get('seat') ?? '').toUpperCase();
const token = hash.get('token') ?? '';
const opponent = seat === 'A' ? 'B' : 'A';

const I18N = {
  zh: {
    title: '你 vs 本地 Agent · 大话骰', skip: '跳到操作区', brand: '你 vs 本地 Agent',
    connected: '已连接', connecting: '连接中', connectionFailed: '连接失败', missingCredentials: '缺少席位凭证',
    series: '系列', gameRound: '场 / 局', diceCount: '骰数', rules: '规则',
    yourDice: '你的骰子', currentBid: '当前报价', controlEyebrow: '轮到你时', controlTitle: '选择动作',
    peek: '看骰', blind: '宣盲', zhai: '宣斋', raise: '抬', bid: '报价', challenge: '开！',
    quantity: '数量', face: '点数', say: '桌上说一句（可不填）', sayPlaceholder: '这口你敢不敢开？',
    talkTitle: '桌上对话', logTitle: '牌桌记录', privacy: '仅限本机 · 你只能看到自己的暗骰 · 对手的判断不会在赛中展示',
    switchLanguage: 'Switch to English', you: '你', referee: '裁判', seat: '席', opponent: '对手',
    flying: '飞局', noWilds: '斋局', notSeen: '未看', wild: '1，万能', points: '{face} 点',
    notPeeked: '还没有看骰', peeked: '已看骰 · 1 为万能', declaredBlind: '本局已宣盲',
    waiting: '等待', yourTurn: '轮到你', agentThinking: '{agent} 决策中', youWon: '你赢了', agentWon: '{agent} 获胜',
    noBid: '无报价', yourBid: '你的报价', agentBid: '{agent} 的报价', waitingFirstBid: '{who} 等待首报',
    noReveal: '尚未开牌', latestReveal: '上次开牌：实有 {actual} · 报价{result} · {loser} 掉骰',
    stands: '成立', fails: '不成立', noSpeech: '尚未发言', chooseAction: '选择一个合法动作',
    canPeek: '你可以先看骰', waitAgent: '等待 {agent}', seriesEnd: '系列结束：{winner}',
    useFullLink: '请使用启动命令输出的完整 PLAY 链接。', sentences: '{count} 句', lines: '{count} 条',
    noTalk: '还没有人说话', waitingGame: '等待开局', gameTag: '第 {game} 场',
    roundStart: '第 {round} 局开始，{who} 先报', peeks: '{who} 看骰', declares: '{who} 宣 {declaration}',
    bids: '{who} 报 {count} × {face}', challenges: '{who} 开 {target}',
    reveals: '开牌：实有 {actual}，报价{result}，{loser} 掉骰', winsGame: '{who} 赢下本场',
    declareBlind: '盲', declareZhai: '斋', declareRaise: '抬',
  },
  en: {
    title: 'You vs Local Agent · Liar\'s Dice', skip: 'Skip to controls', brand: 'You vs Local Agent',
    connected: 'Connected', connecting: 'Connecting', connectionFailed: 'Connection failed', missingCredentials: 'Missing seat credentials',
    series: 'Series', gameRound: 'Game / Round', diceCount: 'Dice', rules: 'Rules',
    yourDice: 'Your dice', currentBid: 'Current bid', controlEyebrow: 'On your turn', controlTitle: 'Choose an action',
    peek: 'Peek', blind: 'Blind', zhai: 'No wilds', raise: 'Raise stakes', bid: 'Bid', challenge: 'Challenge',
    quantity: 'Count', face: 'Face', say: 'Table talk (optional)', sayPlaceholder: 'Do you dare challenge this?',
    talkTitle: 'Table talk', logTitle: 'Table log', privacy: 'Local only · You can see only your hidden dice · Your opponent\'s private notes stay hidden during play',
    switchLanguage: '切换到中文', you: 'You', referee: 'Dealer', seat: 'Seat', opponent: 'Opponent',
    flying: 'Ones wild', noWilds: 'No wilds', notSeen: 'Hidden', wild: '1, wild', points: 'Face {face}',
    notPeeked: 'You have not peeked', peeked: 'Peeked · ones are wild', declaredBlind: 'Playing blind this round',
    waiting: 'Waiting', yourTurn: 'Your turn', agentThinking: '{agent} is deciding', youWon: 'You won', agentWon: '{agent} won',
    noBid: 'No bid', yourBid: 'Your bid', agentBid: '{agent}\'s bid', waitingFirstBid: '{who} to open',
    noReveal: 'No reveal yet', latestReveal: 'Last reveal: {actual} · bid {result} · {loser} lost a die',
    stands: 'stands', fails: 'fails', noSpeech: 'No table talk yet', chooseAction: 'Choose a legal action',
    canPeek: 'You may peek now', waitAgent: 'Waiting for {agent}', seriesEnd: 'Series over: {winner}',
    useFullLink: 'Open the complete PLAY link printed by the launcher.', sentences: '{count} messages', lines: '{count} events',
    noTalk: 'No one has spoken yet', waitingGame: 'Waiting for the game', gameTag: 'Game {game}',
    roundStart: 'Round {round} starts · {who} opens', peeks: '{who} peeks', declares: '{who} declares {declaration}',
    bids: '{who} bids {count} × {face}', challenges: '{who} challenges {target}',
    reveals: 'Reveal: {actual} · bid {result} · {loser} loses a die', winsGame: '{who} wins the game',
    declareBlind: 'blind', declareZhai: 'no wilds', declareRaise: 'raise',
  },
};

let language = localStorage.getItem('kai-human-play-language') === 'en' ? 'en' : 'zh';
let view = null;
let busy = false;
let timer = null;
let connectionKey = 'connecting';
let talkRenderKey = '';

function tr(key, values = {}) {
  return String(I18N[language][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function setConnection(key, tone) {
  connectionKey = key;
  $('connection').lastChild.textContent = tr(key);
  $('connection').dataset.tone = tone;
}

function who(id) {
  if (id === seat) return tr('you');
  if (id === opponent) return agentName();
  return id ?? tr('referee');
}

function agentName() {
  return String(view?.labels?.[opponent] ?? tr('opponent')).split(' · ')[0];
}

function declarationName(value) {
  return tr(value === 'blind' ? 'declareBlind' : value === 'zhai' ? 'declareZhai' : 'declareRaise');
}

function applyLanguage() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = tr('title');
  const bindings = {
    skipLink: 'skip', brandSubtitle: 'brand', seriesCaption: 'series', roundCaption: 'gameRound',
    diceCaption: 'diceCount', ruleCaption: 'rules', handTitle: 'yourDice', currentBidCaption: 'currentBid',
    controlEyebrow: 'controlEyebrow', controlTitle: 'controlTitle', peekBtn: 'peek', blindBtn: 'blind',
    zhaiBtn: 'zhai', raiseBtn: 'raise', bidCountCaption: 'quantity', bidFaceCaption: 'face',
    bidBtn: 'bid', challengeBtn: 'challenge', sayCaption: 'say', talkTitle: 'talkTitle', logTitle: 'logTitle',
    privacyFooter: 'privacy',
  };
  for (const [id, key] of Object.entries(bindings)) $(id).textContent = tr(key);
  $('sayInput').placeholder = tr('sayPlaceholder');
  $('languageToggle').textContent = language === 'zh' ? 'EN' : '中文';
  $('languageToggle').setAttribute('aria-label', tr('switchLanguage'));
  $('connection').lastChild.textContent = tr(connectionKey);
  render();
}

function actionAllowed(type, declaration = null) {
  return (view?.current?.legal ?? []).some((action) =>
    action.type === type && (declaration == null || action.declaration === declaration));
}

async function request(operation, body = {}) {
  const response = await fetch(`/seat/${seat}/${operation}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.current) view = data.current;
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

function diceMarkup(values, count) {
  const dice = values ?? Array.from({ length: count }, () => null);
  return dice.map((face) => {
    const text = face == null ? '·' : face === 1 ? '1*' : String(face);
    const label = face == null ? tr('notSeen') : face === 1 ? tr('wild') : tr('points', { face });
    return `<span class="die${face == null ? ' is-back' : ''}" aria-label="${label}">${text}</span>`;
  }).join('');
}

function lastEvent(type) {
  return (view?.newEvents ?? []).findLast((event) => event.type === type) ?? null;
}

function logText(event) {
  if (event.type === 'roundStart') return tr('roundStart', { round: event.round, who: who(event.first) });
  if (event.type === 'peek') return tr('peeks', { who: who(event.actor) });
  if (event.type === 'declare') return tr('declares', { who: who(event.actor), declaration: declarationName(event.declaration) });
  if (event.type === 'bid') return tr('bids', { who: who(event.actor), count: event.count, face: event.face });
  if (event.type === 'challenge') return tr('challenges', { who: who(event.actor), target: who(event.target) });
  if (event.type === 'reveal') return tr('reveals', {
    actual: event.actual, result: tr(event.stands ? 'stands' : 'fails'), loser: who(event.loser),
  });
  if (event.type === 'matchEnd') return tr('winsGame', { who: who(event.winner) });
  return null;
}

function renderTalk() {
  const items = (view?.tableTalk ?? []).slice(-40);
  $('talkMeta').textContent = tr('sentences', { count: items.length });
  const renderKey = `${language}:${JSON.stringify(items.map((item) => [item.id, item.game, item.round, item.speaker, item.text]))}`;
  if (renderKey === talkRenderKey) return;
  const root = $('talkLog');
  const wasPinnedToBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 48;
  const previousScrollTop = root.scrollTop;
  root.innerHTML = items.length ? items.map((item) =>
    `<div class="talk-row" data-self="${item.speaker === seat}">` +
      `<span>${esc(who(item.speaker))} · ${item.game ? esc(tr('gameTag', { game: item.game })) + ' · ' : ''}R${item.round}</span>` +
      `<p>${esc(item.text)}</p>` +
    `</div>`,
  ).join('') : `<p class="muted">${tr('noTalk')}</p>`;
  root.scrollTop = wasPinnedToBottom ? root.scrollHeight : previousScrollTop;
  talkRenderKey = renderKey;
}

function renderLog() {
  const rows = (view?.newEvents ?? [])
    .map((event) => ({ event, text: logText(event) }))
    .filter((item) => item.text)
    .slice(-60);
  $('logMeta').textContent = tr('lines', { count: rows.length });
  $('log').innerHTML = rows.length ? rows.map(({ event, text }) =>
    `<div class="log-row"><span>${event.game ? esc(tr('gameTag', { game: event.game })) : ''} R${event.round ?? '—'}</span><strong>${esc(text)}</strong></div>`,
  ).join('') : `<p class="muted">${tr('waitingGame')}</p>`;
  $('log').scrollTop = $('log').scrollHeight;
}

function syncBidOptions() {
  const current = view.current;
  const total = current.players.reduce((sum, player) => sum + player.diceCount, 0);
  const counts = Array.from({ length: Math.max(0, total - 1) }, (_, index) => index + 2);
  const faces = Array.from({ length: current.zhai ? 6 : 5 }, (_, index) => index + (current.zhai ? 1 : 2));
  const oldCount = Number($('bidCount').value);
  const oldFace = Number($('bidFace').value);
  $('bidCount').innerHTML = counts.map((value) => `<option value="${value}">${value}</option>`).join('');
  $('bidFace').innerHTML = faces.map((value) => `<option value="${value}">${value}</option>`).join('');
  const legal = [];
  for (const count of counts) for (const face of faces) {
    const bid = current.currentBid;
    if (!bid || count > bid.count || (count === bid.count && face > bid.face)) legal.push({ count, face });
  }
  const preferred = legal.find((bid) => bid.count === oldCount && bid.face === oldFace) ?? legal[0];
  if (preferred) {
    $('bidCount').value = String(preferred.count);
    $('bidFace').value = String(preferred.face);
  }
  return preferred != null;
}

function render() {
  if (!view) return;
  const current = view.current;
  const yourPlayer = current.players.find((player) => player.id === seat);
  const theirPlayer = current.players.find((player) => player.id === opponent);
  $('seatLabel').textContent = language === 'en' ? `${tr('seat')} ${seat} · ${tr('you')}` : `${seat} ${tr('seat')} · ${tr('you')}`;
  $('opponentSeat').textContent = language === 'en' ? `${tr('seat')} ${opponent} · ${tr('opponent')}` : `${opponent} ${tr('seat')} · ${tr('opponent')}`;
  const opponentLabel = view.labels?.[opponent] ?? tr('opponent');
  const currentAgentName = agentName();
  $('opponentName').textContent = opponentLabel;
  $('brandSubtitle').textContent = `${tr('you')} vs ${opponentLabel}`;
  document.title = `${tr('you')} vs ${opponentLabel} · ${language === 'en' ? "Liar's Dice" : '大话骰'}`;
  $('seriesLabel').textContent = `BO${view.series.bestOf} · ${view.series.wins[seat]}–${view.series.wins[opponent]}`;
  $('roundLabel').textContent = `${view.series.game} / ${current.round}`;
  $('diceCount').textContent = `${yourPlayer?.diceCount ?? 0}–${theirPlayer?.diceCount ?? 0}`;
  $('ruleLabel').textContent = tr(current.zhai ? 'noWilds' : 'flying');
  $('dice').setAttribute('aria-label', tr('yourDice'));
  $('dice').innerHTML = diceMarkup(current.yourDice, yourPlayer?.diceCount ?? 0);
  $('handMeta').textContent = current.blind?.[seat] ? tr('declaredBlind') : current.peeked?.[seat] ? tr('peeked') : tr('notPeeked');

  const yourTurn = !view.series.over && current.turn === seat;
  const claudeTurn = !view.series.over && current.turn === opponent;
  $('humanState').textContent = view.series.over ? (view.series.winner === seat ? tr('youWon') : tr('agentWon', { agent: currentAgentName })) : yourTurn ? tr('yourTurn') : tr('waiting');
  $('opponentState').textContent = view.series.over ? (view.series.winner === opponent ? tr('agentWon', { agent: currentAgentName }) : tr('youWon')) : claudeTurn ? tr('agentThinking', { agent: currentAgentName }) : tr('waiting');
  $('humanState').classList.toggle('is-active', yourTurn);
  $('opponentState').classList.toggle('is-active', claudeTurn);

  if (current.currentBid) {
    $('currentBid').textContent = `${current.currentBid.count} × ${current.currentBid.face}`;
    $('bidder').textContent = current.currentBid.player === seat ? tr('yourBid') : tr('agentBid', { agent: currentAgentName });
  } else {
    $('currentBid').textContent = tr('noBid');
    $('bidder').textContent = tr('waitingFirstBid', { who: who(current.turn) });
  }
  const reveal = lastEvent('reveal');
  $('lastResult').textContent = reveal ? tr('latestReveal', {
    actual: reveal.actual, result: tr(reveal.stands ? 'stands' : 'fails'), loser: who(reveal.loser),
  }) : tr('noReveal');
  const latestTalk = (view.tableTalk ?? []).findLast((item) => item.speaker === opponent);
  $('opponentSay').textContent = latestTalk?.text || tr('noSpeech');

  const bidPossible = syncBidOptions();
  $('peekBtn').disabled = busy || !actionAllowed('peek');
  $('blindBtn').disabled = busy || !actionAllowed('declare', 'blind');
  $('zhaiBtn').disabled = busy || !actionAllowed('declare', 'zhai');
  $('raiseBtn').disabled = busy || !actionAllowed('declare', 'raise');
  $('bidBtn').disabled = busy || !actionAllowed('bid') || !bidPossible;
  $('challengeBtn').disabled = busy || !actionAllowed('challenge');
  $('bidCount').disabled = $('bidBtn').disabled;
  $('bidFace').disabled = $('bidBtn').disabled;
  $('actionStatus').textContent = view.series.over
    ? tr('seriesEnd', { winner: view.series.winner === seat ? tr('youWon') : tr('agentWon', { agent: currentAgentName }) })
    : yourTurn ? tr('chooseAction') : actionAllowed('peek') ? tr('canPeek') : tr('waitAgent', { agent: currentAgentName });
  renderTalk();
  renderLog();
}

async function refresh() {
  clearTimeout(timer);
  if (busy) {
    timer = setTimeout(refresh, 300);
    return;
  }
  if (!view?.series?.over) {
    try {
      view = await request('observe', { afterEventId: -1, afterTalkId: -1 });
      setConnection('connected', 'live');
      render();
    } catch (error) {
      setConnection('connectionFailed', 'error');
      $('actionStatus').textContent = error.message;
    }
    timer = setTimeout(refresh, 700);
  }
}

async function act(action) {
  if (!view || busy) return;
  clearTimeout(timer);
  busy = true;
  render();
  let errorMessage = null;
  try {
    view = await request('act', {
      stateId: view.stateId,
      belief: '',
      note: '',
      say: $('sayInput').value.trim(),
      action,
      afterEventId: -1,
      afterTalkId: -1,
    });
    $('sayInput').value = '';
    setConnection('connected', 'live');
  } catch (error) {
    errorMessage = error.message;
  } finally {
    busy = false;
    render();
    if (errorMessage) $('actionStatus').textContent = errorMessage;
    if (!view?.series?.over) timer = setTimeout(refresh, 300);
  }
}

$('peekBtn').addEventListener('click', () => act({ type: 'peek' }));
$('blindBtn').addEventListener('click', () => act({ type: 'declare', declaration: 'blind' }));
$('zhaiBtn').addEventListener('click', () => act({ type: 'declare', declaration: 'zhai' }));
$('raiseBtn').addEventListener('click', () => act({ type: 'declare', declaration: 'raise' }));
$('bidBtn').addEventListener('click', () => act({ type: 'bid', count: Number($('bidCount').value), face: Number($('bidFace').value) }));
$('challengeBtn').addEventListener('click', () => act({ type: 'challenge', assert: ASSERT_FALSE }));
$('bidCount').addEventListener('change', render);
$('bidFace').addEventListener('change', render);
$('languageToggle').addEventListener('click', () => {
  language = language === 'zh' ? 'en' : 'zh';
  localStorage.setItem('kai-human-play-language', language);
  applyLanguage();
});

applyLanguage();
if (!['A', 'B'].includes(seat) || !token) {
  setConnection('missingCredentials', 'error');
  $('actionStatus').textContent = tr('useFullLink');
} else {
  refresh();
}
