const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const DECLARATIONS = { blind: '盲', zhai: '斋', raise: '抬' };
let snapshot = null;

function setConnection(text, tone) {
  const node = $('connection');
  node.dataset.tone = tone;
  node.querySelector('.connection__text').textContent = text;
}

function actionText(action) {
  if (!action) return '—';
  if (action.type === 'peek') return '看骰';
  if (action.type === 'bid') return `报 ${action.count} × ${action.face}`;
  if (action.type === 'challenge') return '开牌';
  if (action.type === 'declare') return `宣${DECLARATIONS[action.declaration] ?? action.declaration}`;
  return action.type;
}

function diceMarkup(hand, count) {
  const values = hand ?? Array.from({ length: count }, () => null);
  return values.slice(0, count).map((face) => {
    const label = face == null ? '未看' : face === 1 ? '1，万能' : `${face} 点`;
    const text = face == null ? '·' : face === 1 ? '1*' : String(face);
    return `<span class="die${face == null ? ' is-back' : ''}" aria-label="${label}">${text}</span>`;
  }).join('');
}

function latestFor(items, seat) {
  return items.findLast((item) => item.seat === seat || item.speaker === seat) ?? null;
}

function renderSeat(seat, data) {
  const player = data.current.players.find((item) => item.id === seat);
  const hand = data.current.hands[seat];
  const decision = latestFor(data.decisions, seat);
  const speech = latestFor(data.dialogue, seat);
  const name = data.labels?.[seat] ?? seat;
  const article = document.querySelector(`.seat--${seat.toLowerCase()}`);
  article.classList.toggle('is-turn', !data.over && data.current.turn === seat);
  $(`seat${seat}Name`).textContent = name;
  $(`thoughtToggle${seat}`).textContent = `${name} 判断`;
  $(`dice${seat}`).setAttribute('aria-label', `${name} 骰子`);
  $(`seat${seat}State`).textContent = data.over
    ? (data.winner === seat ? '胜' : '负')
    : data.current.turn === seat ? '决策中' : '等待';
  $(`dice${seat}`).innerHTML = diceMarkup(hand, player?.diceCount ?? 0);
  const states = [
    `${player?.diceCount ?? 0} 颗`,
    data.current.blind?.[seat] ? '盲' : data.current.peeked?.[seat] ? '已看' : '未看',
    data.current.raises?.[seat] ? '已抬' : null,
    decision?.timing === 'slow' ? '上一手较慢' : decision?.timing === 'fast' ? '上一手很快' : null,
  ].filter(Boolean);
  $(`meta${seat}`).textContent = states.join(' · ');
  $(`say${seat}`).textContent = speech?.text || '尚未发言';
  $(`belief${seat}`).textContent = decision?.belief || '等待第一手判断。';
  $(`note${seat}`).textContent = decision?.note || '';
}

function latestReveal(data) {
  return data.events.findLast((event) => event.type === 'reveal') ?? null;
}

function renderTable(data) {
  const current = data.current;
  const players = Object.fromEntries(current.players.map((player) => [player.id, player]));
  $('roundLabel').textContent = `第 ${current.game}/${current.bestOf} 场 · 第 ${current.round} 局`;
  $('ruleLabel').textContent = `${current.zhai ? '斋局' : '飞局'} · ${current.wins.A}–${current.wins.B}`;
  $('diceScore').textContent = `${players.A?.diceCount ?? 0}–${players.B?.diceCount ?? 0}`;
  $('potScore').textContent = `${current.potUnits} × ${current.potMult}`;
  $('actionCount').textContent = String(data.decisions.length);

  if (data.over) {
    $('currentBid').textContent = `${data.labels?.[data.winner] ?? data.winner} 胜`;
    $('bidder').textContent = `${data.labels?.[data.winner] ?? data.winner} 留在桌上`;
  } else if (current.currentBid) {
    $('currentBid').textContent = `${current.currentBid.count} × ${current.currentBid.face}`;
    $('bidder').textContent = `${data.labels?.[current.currentBid.player] ?? current.currentBid.player} 报价`;
  } else {
    $('currentBid').textContent = '无报价';
    $('bidder').textContent = `${data.labels?.[current.turn] ?? current.turn} 等待首报`;
  }

  const reveal = latestReveal(data);
  if (!reveal) $('lastResult').textContent = '比赛尚未开牌。';
  else {
    const result = reveal.stands ? '报价成立' : '报价不成立';
    $('lastResult').textContent = `上次开牌：实有 ${reveal.actual} · ${result} · ${data.labels?.[reveal.loser] ?? reveal.loser} 掉骰`;
  }
}

function renderTimeline(data) {
  const root = $('timelineRows');
  $('timelineMeta').textContent = `${data.decisions.length} 个动作`;
  if (!data.decisions.length) {
    root.innerHTML = '<p class="empty">等待第一个合法动作。</p>';
    return;
  }

  const parts = [];
  let round = null;
  for (const decision of data.decisions.slice(-80)) {
    const roundKey = `${decision.game ?? 1}:${decision.round}`;
    if (roundKey !== round) {
      round = roundKey;
      parts.push(`<div class="round-row">第 ${decision.game ?? 1} 场 · 第 ${decision.round} 局</div>`);
    }
    const name = data.labels?.[decision.seat] ?? decision.seat;
    parts.push(
      `<div class="timeline-row" data-seat="${decision.seat}">` +
      `<span class="timeline-row__seat">${decision.seat}</span>` +
      `<span class="timeline-row__action">${esc(actionText(decision.action))}</span>` +
      `<span class="timeline-row__say">${esc(decision.say || `${name} 没有发言`)}</span>` +
      `</div>`,
    );
  }
  const pinnedToBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 80;
  root.innerHTML = parts.join('');
  if (pinnedToBottom) root.scrollTop = root.scrollHeight;
}

function render(data) {
  snapshot = data;
  $('matchLabel').textContent = data.over
    ? `BO${data.bestOf} 结束 · ${data.series.wins.A}–${data.series.wins.B}`
    : `第 ${data.current.game}/${data.bestOf} 场 · 第 ${data.current.round} 局`;
  $('seedLabel').textContent = `seed ${data.seed}`;
  renderSeat('A', data);
  renderSeat('B', data);
  renderTable(data);
  renderTimeline(data);
  setConnection(data.over ? '已结束' : '直播中', 'live');
  document.title = data.over
    ? `BO${data.bestOf} 结束 · ${data.winner} 席获胜`
    : `第 ${data.current.game}/${data.bestOf} 场 · 第 ${data.current.round} 局`;
}

for (const seat of ['A', 'B']) {
  const input = $(`showThought${seat}`);
  const stored = localStorage.getItem(`kai-live-thought-${seat}`) === '1';
  input.checked = stored;
  $(`thought${seat}`).hidden = !stored;
  input.addEventListener('change', () => {
    $(`thought${seat}`).hidden = !input.checked;
    localStorage.setItem(`kai-live-thought-${seat}`, input.checked ? '1' : '0');
  });
}

const stream = new EventSource('/spectate/events');
stream.addEventListener('open', () => setConnection('已连接', 'live'));
stream.addEventListener('snapshot', (event) => {
  try {
    render(JSON.parse(event.data));
  } catch {
    setConnection('数据错误', 'error');
  }
});
stream.addEventListener('error', () => {
  if (!snapshot?.over) setConnection('重连中', 'error');
});
