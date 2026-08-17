import { createMatch } from '../../../src/engine.js';

export const CHALLENGE_ASSERTION = 'current_bid_is_false';

const SEATS = new Set(['A', 'B']);
const clone = (value) => (value == null ? value : structuredClone(value));

function requireSeat(seat) {
  if (!SEATS.has(seat)) throw new Error(`unknown seat ${seat}`);
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function publicEvent(event) {
  const { elapsedMs, ...rest } = event;
  if (elapsedMs == null) return rest;
  if (elapsedMs > 8000) return { ...rest, timing: 'slow' };
  if (elapsedMs < 1200) return { ...rest, timing: 'fast' };
  return rest;
}

function spectatorDecision(decision) {
  const { thinkMs, ...rest } = decision;
  if (thinkMs == null) return rest;
  if (thinkMs > 8000) return { ...rest, timing: 'slow' };
  if (thinkMs < 1200) return { ...rest, timing: 'fast' };
  return rest;
}

function publicAction(action) {
  if (!action || typeof action !== 'object') throw new Error('action must be an object');
  switch (action.type) {
    case 'peek':
      return { type: 'peek' };
    case 'declare':
      if (!['blind', 'zhai', 'raise'].includes(action.declaration))
        throw new Error('unknown declaration');
      return { type: 'declare', declaration: action.declaration };
    case 'bid':
      if (!Number.isInteger(action.count) || !Number.isInteger(action.face))
        throw new Error('bid count and face must be integers');
      return { type: 'bid', count: action.count, face: action.face };
    case 'challenge':
      if (action.assert !== CHALLENGE_ASSERTION)
        throw new Error(`challenge must assert ${CHALLENGE_ASSERTION}`);
      return { type: 'challenge', assert: CHALLENGE_ASSERTION };
    default:
      throw new Error(`unknown action ${action.type ?? '(missing type)'}`);
  }
}

export async function createShowdown({ seed = 1, startDice = 5, bestOf = 1, labels = {}, onSnapshot } = {}) {
  const seriesLength = Math.max(1, Math.floor(Number(bestOf) || 1));
  const winsNeeded = Math.floor(seriesLength / 2) + 1;
  const startedAt = new Date().toISOString();
  const dialogue = [];
  const decisions = [];
  const rejections = [];
  const games = [];
  const wins = { A: 0, B: 0 };
  const lastDeliveredAt = { A: null, B: null };
  let revision = 0;
  let completedAt = null;
  let gameNumber = 1;
  let seriesOver = false;
  let seriesWinner = null;

  const gameSeed = (number) => seed + number - 1;
  const firstSeat = (number) => (number % 2 === 1 ? 'A' : 'B');
  const createGame = (number) => {
    const first = firstSeat(number);
    const players = first === 'A' ? ['A', 'B'] : ['B', 'A'];
    return createMatch({ seed: gameSeed(number), config: { players, startDice } });
  };
  let match = await createGame(gameNumber);

  const seriesView = () => ({
    bestOf: seriesLength,
    winsNeeded,
    game: gameNumber,
    wins: { ...wins },
    over: seriesOver,
    winner: seriesWinner,
    completedGames: games.map((game) => ({
      game: game.game,
      seed: game.seed,
      firstSeat: game.firstSeat,
      winner: game.winner,
      rounds: game.rounds,
      chips: clone(game.chips),
    })),
  });

  const allEvents = () => {
    const entries = games.map((game) => ({ game: game.game, events: game.events }));
    if (!games.some((game) => game.game === gameNumber))
      entries.push({ game: gameNumber, events: match.observe('A').events });
    const out = [];
    let offset = 0;
    for (const entry of entries) {
      for (const event of entry.events) {
        out.push({
          ...clone(event),
          ...(seriesLength > 1 ? { game: entry.game, gameEventId: event.i } : {}),
          i: offset + event.i,
        });
      }
      offset += entry.events.length;
    }
    return out;
  };

  const stateIdOf = (ob) => {
    const eventId = allEvents().at(-1)?.i ?? -1;
    return `g${gameNumber}:r${ob.round}:e${eventId}:v${revision}:t${ob.turn ?? '-'}`;
  };

  const fullSnapshot = () => {
    const ob = match.observe('A');
    const terminal = ob.events.findLast((event) => event.type === 'matchEnd') ?? null;
    return {
      schemaVersion: 1,
      seed,
      startDice,
      bestOf: seriesLength,
      labels: { A: labels.A ?? 'A', B: labels.B ?? 'B' },
      startedAt,
      completedAt,
      revision,
      over: seriesOver,
      winner: seriesWinner,
      standings: clone(seriesOver ? [seriesWinner, seriesWinner === 'A' ? 'B' : 'A'] : null),
      chips: clone(terminal?.chips ?? ob.players.reduce((out, player) => {
        out[player.id] = player.chips;
        return out;
      }, {})),
      series: seriesView(),
      games: clone(games),
      events: allEvents(),
      dialogue: clone(dialogue),
      decisions: clone(decisions),
      rejections: clone(rejections),
    };
  };

  const persist = async () => {
    if (onSnapshot) await onSnapshot(fullSnapshot());
  };

  const observe = (seat, { afterEventId = -1, afterTalkId = -1, markDelivered = true } = {}) => {
    requireSeat(seat);
    const ob = match.observe(seat);
    const { events: _engineEvents, ...current } = ob;
    const events = allEvents();
    const eventCursor = events.at(-1)?.i ?? -1;
    const talkCursor = dialogue.at(-1)?.id ?? -1;
    const view = {
      schemaVersion: 1,
      stateId: stateIdOf(ob),
      seat,
      opponent: seat === 'A' ? 'B' : 'A',
      labels: { A: labels.A ?? 'A', B: labels.B ?? 'B' },
      series: seriesView(),
      current,
      // 原始毫秒只留在审计回放；席位只收到现象分类，沿用产品提示词的数据纪律。
      newEvents: clone(events.filter((event) => event.i > afterEventId).map(publicEvent)),
      tableTalk: clone(dialogue.filter((item) => item.id > afterTalkId)),
      eventCursor,
      talkCursor,
      historyFromStart: afterEventId < 0,
    };
    if (markDelivered) lastDeliveredAt[seat] = Date.now();
    return view;
  };

  const act = async (seat, input = {}) => {
    requireSeat(seat);
    const cursors = {
      afterEventId: Number.isInteger(input.afterEventId) ? input.afterEventId : -1,
      afterTalkId: Number.isInteger(input.afterTalkId) ? input.afterTalkId : -1,
    };
    const before = observe(seat, { ...cursors, markDelivered: false });
    const reject = async (code, message) => {
      rejections.push({
        id: rejections.length,
        seat,
        game: gameNumber,
        stateId: input.stateId ?? null,
        action: clone(input.action ?? null),
        code,
        message,
        rejectedAt: new Date().toISOString(),
      });
      await persist();
      const error = new Error(message);
      error.code = code;
      error.current = before;
      throw error;
    };
    if (input.stateId !== before.stateId) {
      await reject('STALE_STATE', `stale state: expected ${before.stateId}`);
    }

    let action;
    try {
      action = publicAction(input.action);
    } catch (error) {
      await reject('INVALID_ACTION', error.message);
    }
    const round = before.current.round;
    const decision = {
      id: decisions.length,
      seat,
      game: gameNumber,
      round,
      stateId: before.stateId,
      action: clone(action),
      belief: cleanText(input.belief, 1200),
      say: cleanText(input.say, 300),
      note: cleanText(input.note, 1200),
      thinkMs: lastDeliveredAt[seat] == null ? null : Math.max(0, Date.now() - lastDeliveredAt[seat]),
      acceptedAt: new Date().toISOString(),
    };

    try {
      await match.act(seat, action, { elapsedMs: decision.thinkMs });
    } catch (cause) {
      await reject('ILLEGAL_ACTION', cause?.message ?? String(cause));
    }

    revision += 1;
    if (decision.say) {
      dialogue.push({
        id: dialogue.length,
        game: gameNumber,
        round,
        speaker: seat,
        action: clone(action),
        text: decision.say,
      });
    }
    decisions.push(decision);

    const finished = match.observe('A');
    if (finished.over) {
      const terminal = finished.events.findLast((event) => event.type === 'matchEnd');
      wins[terminal.winner] += 1;
      games.push({
        game: gameNumber,
        seed: gameSeed(gameNumber),
        firstSeat: firstSeat(gameNumber),
        winner: terminal.winner,
        rounds: terminal.rounds,
        chips: clone(terminal.chips),
        events: clone(finished.events),
      });
      if (wins[terminal.winner] >= winsNeeded || games.length >= seriesLength) {
        seriesOver = true;
        seriesWinner = terminal.winner;
        if (!completedAt) completedAt = new Date().toISOString();
      } else {
        gameNumber += 1;
        match = await createGame(gameNumber);
      }
    }

    const after = observe(seat, {
      ...cursors,
      markDelivered: true,
    });
    decision.resultingStateId = after.stateId;
    await persist();
    return after;
  };

  const waitForChange = async (
    seat,
    { stateId, afterEventId = -1, afterTalkId = -1, timeoutMs = 15_000 } = {},
  ) => {
    requireSeat(seat);
    const timeout = Math.max(250, Math.min(Number(timeoutMs) || 15_000, 20_000));
    const deadline = Date.now() + timeout;
    while (true) {
      const view = observe(seat, { afterEventId, afterTalkId, markDelivered: false });
      if (
        view.stateId !== stateId ||
        view.current.over ||
        view.current.legal.length > 0 ||
        Date.now() >= deadline
      ) {
        lastDeliveredAt[seat] = Date.now();
        return { changed: view.stateId !== stateId, timedOut: Date.now() >= deadline, ...view };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  // 私用观战层只拼接两个合法席位视图，不向任何 Agent 开额外查询口。
  // 未看骰时 yourDice 仍为 null；原始毫秒只保留在 run.json 审计文件。
  const spectate = () => {
    const a = match.observe('A');
    const b = match.observe('B');
    const snapshot = fullSnapshot();
    return {
      ...snapshot,
      games: snapshot.games.map((game) => ({
        ...game,
        events: game.events.map(publicEvent),
      })),
      events: snapshot.events.map(publicEvent),
      decisions: snapshot.decisions.map(spectatorDecision),
      current: {
        game: gameNumber,
        bestOf: seriesLength,
        wins: { ...wins },
        round: a.round,
        over: seriesOver,
        turn: a.turn,
        firstBidder: a.firstBidder,
        bidCount: a.bidCount,
        zhai: a.zhai,
        potMult: a.potMult,
        potUnits: a.potUnits,
        currentBid: clone(a.currentBid),
        players: clone(a.players),
        peeked: clone(a.peeked),
        blind: clone(a.blind),
        raises: clone(a.raises),
        hands: { A: clone(a.yourDice), B: clone(b.yourDice) },
      },
    };
  };

  await persist();
  return { observe, act, waitForChange, snapshot: fullSnapshot, spectate };
}
