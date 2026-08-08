var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../src/rules.js
function legalFaces(zhai) {
  return zhai ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6];
}
__name(legalFaces, "legalFaces");
function beats(next, prev) {
  if (!prev) return true;
  return next.count > prev.count || next.count === prev.count && next.face > prev.face;
}
__name(beats, "beats");
function isLegalBid(bid, prev, zhai, totalDice) {
  if (!Number.isInteger(bid.count) || !Number.isInteger(bid.face)) return false;
  if (!legalFaces(zhai).includes(bid.face)) return false;
  if (bid.count < 2 || bid.count > totalDice) return false;
  return beats(bid, prev);
}
__name(isLegalBid, "isLegalBid");
function allLegalBids(prev, zhai, totalDice) {
  const out = [];
  for (let count = 2; count <= totalDice; count++)
    for (const face of legalFaces(zhai))
      if (isLegalBid({ count, face }, prev, zhai, totalDice)) out.push({ count, face });
  return out;
}
__name(allLegalBids, "allLegalBids");
function countBid(bid, allDice, zhai) {
  return allDice.filter((d) => d === bid.face || !zhai && d === 1).length;
}
__name(countBid, "countBid");
function bidStands(bid, allDice, zhai) {
  return countBid(bid, allDice, zhai) >= bid.count;
}
__name(bidStands, "bidStands");

// ../../src/engine.js
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
__name(mulberry32, "mulberry32");
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function commitmentOf(dice, nonce) {
  return sha256Hex(`${dice.join(",")}|${nonce}`);
}
__name(commitmentOf, "commitmentOf");
var DEFAULTS = {
  startDice: 5,
  // 附:待定参数表
  startChips: 100
  // §2.2 初始筹码；可为负，不触发终局
};
async function createMatch({ seed, config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const players = cfg.players ?? ["A", "B"];
  const mods = cfg.mods ?? [];
  const modActs = mods.flatMap((m) => m.actions.map((a) => ({ mod: m, a })));
  const rng = mulberry32(seed ?? 1);
  const nonceGen = /* @__PURE__ */ __name(() => Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join(""), "nonceGen");
  const diceCount = {};
  const chips = {};
  const usedMatch = {};
  for (const p of players) {
    diceCount[p] = cfg.startDice;
    chips[p] = typeof cfg.startChips === "object" ? cfg.startChips[p] : cfg.startChips;
    usedMatch[p] = {};
  }
  const events = [];
  const eliminatedOrder = [];
  let round = 0;
  let over = false;
  let dice = null;
  let nonces = null;
  let turn = null;
  let firstBidder = null;
  let bids = [];
  let peeked = null;
  let blind = null;
  let zhai = false;
  let raises = null;
  let shown = {};
  let usedRound = {};
  let modPotFactor = 1;
  const alive = /* @__PURE__ */ __name((p) => diceCount[p] > 0, "alive");
  const aliveList = /* @__PURE__ */ __name(() => players.filter(alive), "aliveList");
  const nextAlive = /* @__PURE__ */ __name((p) => {
    const i = players.indexOf(p);
    for (let k = 1; k <= players.length; k++) {
      const q = players[(i + k) % players.length];
      if (alive(q)) return q;
    }
    return p;
  }, "nextAlive");
  const totalDice = /* @__PURE__ */ __name(() => players.reduce((s, p) => s + diceCount[p], 0), "totalDice");
  const currentBid = /* @__PURE__ */ __name(() => bids.length ? bids.at(-1) : null, "currentBid");
  const emit = /* @__PURE__ */ __name((e) => events.push({ i: events.length, ...e }), "emit");
  const potMult = /* @__PURE__ */ __name(() => aliveList().reduce((m, p) => m * (blind[p] ? 2 : 1) * (raises[p] ? 2 : 1), 1) * (zhai ? 1.5 : 1) * (bids.length >= 6 ? 2 : 1) * modPotFactor, "potMult");
  async function startRound(first) {
    round += 1;
    dice = {};
    nonces = {};
    peeked = {};
    blind = {};
    const commits = {};
    raises = {};
    shown = {};
    usedRound = {};
    modPotFactor = 1;
    for (const p of aliveList()) {
      dice[p] = Array.from({ length: diceCount[p] }, () => 1 + Math.floor(rng() * 6));
      nonces[p] = nonceGen();
      commits[p] = await commitmentOf(dice[p], nonces[p]);
      peeked[p] = false;
      blind[p] = false;
      raises[p] = false;
      shown[p] = [];
      usedRound[p] = {};
    }
    turn = first;
    firstBidder = first;
    bids = [];
    zhai = false;
    emit({ type: "roundStart", round, first, diceCount: { ...diceCount }, commits });
  }
  __name(startRound, "startRound");
  function legalActions(p) {
    if (over || !alive(p)) return [];
    const acts = [];
    if (!peeked[p] && !blind[p]) acts.push({ type: "peek" });
    if (p !== turn) return acts;
    if (!peeked[p] && !blind[p]) acts.push({ type: "declare", declaration: "blind" });
    if (p === firstBidder && bids.length === 0 && !zhai)
      acts.push({ type: "declare", declaration: "zhai" });
    if (!raises[p]) acts.push({ type: "declare", declaration: "raise" });
    if (allLegalBids(currentBid(), zhai, totalDice()).length > 0) acts.push({ type: "bid" });
    if (bids.length > 0 && currentBid().player !== p) acts.push({ type: "challenge" });
    for (const { a } of modActs) {
      const w = a.window ?? {};
      const cb = currentBid();
      if (w.needBid && !cb) continue;
      if (w.noBid && cb) continue;
      if (w.notOwnBid && cb?.player === p) continue;
      if (w.requiresPeeked && !peeked[p]) continue;
      if (w.oncePer === "round" && (usedRound[p]?.[a.type] ?? 0) >= 1) continue;
      if (w.oncePer === "match" && (usedMatch[p]?.[a.type] ?? 0) >= 1) continue;
      if (w.minBids != null && bids.length < w.minBids) continue;
      if (w.maxBids != null && bids.length > w.maxBids) continue;
      if (w.needRaisableByBidder && !(cb && allLegalBids(cb, zhai, totalDice()).length > 0)) continue;
      acts.push({ type: a.type });
    }
    return acts;
  }
  __name(legalActions, "legalActions");
  function payout(winner) {
    const pay = Math.round((1 + bids.length) * potMult());
    const transfers = {};
    let pot = 0;
    for (const q of aliveList())
      if (q !== winner) {
        transfers[q] = -pay;
        chips[q] -= pay;
        pot += pay;
      }
    transfers[winner] = pot;
    chips[winner] += pot;
    return { pay, transfers };
  }
  __name(payout, "payout");
  async function finishRound(nextFirst, fallbackWinner) {
    if (aliveList().length <= 1) {
      over = true;
      const champion = aliveList()[0] ?? fallbackWinner;
      emit({
        type: "matchEnd",
        winner: champion,
        standings: [champion, ...[...eliminatedOrder].reverse()],
        rounds: round,
        chips: { ...chips }
      });
    } else {
      await startRound(nextFirst);
    }
  }
  __name(finishRound, "finishRound");
  const revealSnapshot = /* @__PURE__ */ __name(() => ({
    dice: Object.fromEntries(aliveList().map((p) => [p, [...dice[p]]])),
    nonces: { ...nonces }
  }), "revealSnapshot");
  async function settle(challenger) {
    const bid = currentBid();
    const all = aliveList().flatMap((p) => dice[p]);
    const stands = bidStands(bid, all, zhai);
    const loser = stands ? challenger : bid.player;
    const winner = stands ? bid.player : challenger;
    emit({
      type: "reveal",
      ...revealSnapshot(),
      bid: { ...bid },
      challenger,
      actual: countBid(bid, all, zhai),
      zhai,
      stands,
      loser
    });
    const mult = potMult();
    const { pay, transfers } = payout(winner);
    diceCount[loser] -= 1;
    if (diceCount[loser] === 0) eliminatedOrder.push(loser);
    emit({
      type: "roundEnd",
      round,
      loser,
      winner,
      transfer: pay,
      transfers,
      mult,
      chips: { ...chips },
      diceCount: { ...diceCount }
    });
    await finishRound(alive(loser) ? loser : nextAlive(loser), winner);
  }
  __name(settle, "settle");
  async function settleCalza(caller) {
    const bid = currentBid();
    const all = aliveList().flatMap((p) => dice[p]);
    const actual = countBid(bid, all, zhai);
    const exact = actual === bid.count;
    const winner = exact ? caller : bid.player;
    const loser = exact ? null : caller;
    emit({
      type: "reveal",
      ...revealSnapshot(),
      bid: { ...bid },
      challenger: caller,
      calza: true,
      exact,
      actual,
      zhai,
      stands: bidStands(bid, all, zhai),
      loser
    });
    const mult = potMult();
    const { pay, transfers } = payout(winner);
    if (exact) {
      diceCount[caller] = Math.min(cfg.startDice, diceCount[caller] + 1);
    } else {
      diceCount[caller] -= 1;
      if (diceCount[caller] === 0) eliminatedOrder.push(caller);
    }
    emit({
      type: "roundEnd",
      round,
      calza: true,
      exact,
      caller,
      loser,
      winner,
      transfer: pay,
      transfers,
      mult,
      chips: { ...chips },
      diceCount: { ...diceCount }
    });
    await finishRound(exact ? bid.player : alive(caller) ? caller : nextAlive(caller), winner);
  }
  __name(settleCalza, "settleCalza");
  async function applyMod(p, { mod, a }, action, base) {
    if (a.effect.some((e) => e.op === "revealOwnDie")) {
      if (!Number.isInteger(action.face) || !dice[p].includes(action.face))
        throw new Error("no such die");
    }
    usedRound[p][a.type] = (usedRound[p][a.type] ?? 0) + 1;
    usedMatch[p][a.type] = (usedMatch[p][a.type] ?? 0) + 1;
    for (const ef of a.effect) {
      switch (ef.op) {
        case "revealOwnDie":
          shown[p].push(action.face);
          emit({ type: "modAction", mod: mod.id, action: a.type, op: ef.op, face: action.face, ...base });
          break;
        case "potMult":
          modPotFactor *= ef.x ?? 2;
          emit({ type: "modAction", mod: mod.id, action: a.type, op: ef.op, x: ef.x ?? 2, ...base });
          break;
        case "returnBid":
          turn = currentBid().player;
          emit({ type: "modAction", mod: mod.id, action: a.type, op: ef.op, to: turn, ...base });
          break;
        case "calzaResolve":
          emit({ type: "modAction", mod: mod.id, action: a.type, op: ef.op, ...base });
          await settleCalza(p);
          break;
        default:
          throw new Error(`unknown op ${ef.op}`);
      }
    }
  }
  __name(applyMod, "applyMod");
  async function act(p, action, meta = {}) {
    if (!players.includes(p)) throw new Error(`unknown player ${p}`);
    const legal = legalActions(p);
    const base = { player: p, elapsedMs: meta.elapsedMs ?? null, timeout: meta.timeout ?? false };
    switch (action.type) {
      case "peek":
        if (!legal.some((a) => a.type === "peek")) throw new Error("illegal peek");
        peeked[p] = true;
        emit({ type: "peek", ...base });
        return;
      case "declare":
        if (!legal.some((a) => a.type === "declare" && a.declaration === action.declaration))
          throw new Error(`illegal declare ${action.declaration}`);
        if (action.declaration === "blind") blind[p] = true;
        else if (action.declaration === "raise") raises[p] = true;
        else zhai = true;
        emit({ type: "declare", declaration: action.declaration, ...base });
        return;
      case "bid": {
        if (!legal.some((a) => a.type === "bid")) throw new Error("illegal bid");
        const bid = { count: action.count, face: action.face };
        if (!isLegalBid(bid, currentBid(), zhai, totalDice())) throw new Error("bid off ladder");
        bids.push({ player: p, ...bid });
        turn = nextAlive(p);
        emit({ type: "bid", ...bid, ...base });
        return;
      }
      case "challenge":
        if (!legal.some((a) => a.type === "challenge")) throw new Error("illegal challenge");
        emit({ type: "challenge", ...base });
        await settle(p);
        return;
      default: {
        const ma = modActs.find((x) => x.a.type === action.type);
        if (!ma || !legal.some((x) => x.type === action.type))
          throw new Error(`illegal ${action.type}`);
        await applyMod(p, ma, action, base);
        return;
      }
    }
  }
  __name(act, "act");
  function observe(p) {
    if (!players.includes(p)) throw new Error(`unknown player ${p}`);
    return structuredClone({
      you: p,
      round,
      over,
      turn,
      zhai,
      blind: { ...blind },
      raises: { ...raises },
      potMult: potMult(),
      players: players.map((q) => ({
        id: q,
        diceCount: diceCount[q],
        chips: chips[q],
        alive: alive(q),
        blind: blind?.[q] ?? false
      })),
      yourDice: peeked?.[p] ? dice[p] : null,
      diceCount: { you: diceCount[p], opp: totalDice() - diceCount[p] },
      chips: { you: chips[p], opp: players.length === 2 ? chips[nextAlive(p)] : null },
      currentBid: currentBid(),
      potUnits: 1 + bids.length,
      shown,
      mods: mods.map((m) => ({
        id: m.id,
        name: m.name,
        card: m.card,
        actions: m.actions.map((a) => ({
          type: a.type,
          label: a.label,
          params: a.params ?? null,
          keepTurn: !!a.keepTurn,
          terminal: !!a.terminal,
          ops: a.effect.map((e) => e.op)
        }))
      })),
      legal: legalActions(p),
      events
    });
  }
  __name(observe, "observe");
  await startRound(players[0]);
  return { observe, act, players };
}
__name(createMatch, "createMatch");

// ../../src/probability.js
function binomPmf(n, k, p) {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let j = 0; j < k; j++) c = c * (n - j) / (j + 1);
  return c * p ** k * (1 - p) ** (n - k);
}
__name(binomPmf, "binomPmf");
function binomTail(n, k, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  for (let i = k; i <= n; i++) sum += binomPmf(n, i, p);
  return sum;
}
__name(binomTail, "binomTail");
var pMatch = /* @__PURE__ */ __name((bid, zhai) => !zhai && bid.face !== 1 ? 2 / 6 : 1 / 6, "pMatch");
function probBidTrue(bid, knownDice, unknownCount, zhai) {
  const need = bid.count - countBid(bid, knownDice, zhai);
  return binomTail(unknownCount, need, pMatch(bid, zhai));
}
__name(probBidTrue, "probBidTrue");
function probBidExact(bid, knownDice, unknownCount, zhai) {
  const need = bid.count - countBid(bid, knownDice, zhai);
  return binomPmf(unknownCount, need, pMatch(bid, zhai));
}
__name(probBidExact, "probBidExact");
function obKnown(ob) {
  const othersShown = Object.entries(ob.shown ?? {}).filter(([q]) => q !== ob.you).flatMap(([, faces]) => faces);
  return {
    known: [...ob.yourDice ?? [], ...othersShown],
    unknown: ob.diceCount.opp - othersShown.length
  };
}
__name(obKnown, "obKnown");
function obProb(ob, bid) {
  const { known, unknown } = obKnown(ob);
  return probBidTrue(bid, known, unknown, ob.zhai);
}
__name(obProb, "obProb");
function obProbExact(ob, bid) {
  const { known, unknown } = obKnown(ob);
  return probBidExact(bid, known, unknown, ob.zhai);
}
__name(obProbExact, "obProbExact");

// ../../src/ai/silent.js
function createSilentBot({ challengeThreshold = 0.25 } = {}) {
  return {
    decide(ob) {
      if (ob.yourDice === null && ob.legal.some((a) => a.type === "peek"))
        return { type: "peek" };
      const total = ob.diceCount.you + ob.diceCount.opp;
      const bids = allLegalBids(ob.currentBid, ob.zhai, total);
      const canChallenge = ob.legal.some((a) => a.type === "challenge");
      if (ob.currentBid && canChallenge && (bids.length === 0 || obProb(ob, ob.currentBid) < challengeThreshold))
        return { type: "challenge" };
      if (!bids.length) return canChallenge ? { type: "challenge" } : ob.legal.at(-1);
      let best = bids[0];
      for (const b of bids) if (obProb(ob, b) > obProb(ob, best) + 1e-12) best = b;
      return { type: "bid", ...best };
    }
  };
}
__name(createSilentBot, "createSilentBot");

// ../../src/ai/llm.js
async function chat({ baseUrl, apiKey, model, format = "openai", headers: extraHeaders }, { system, user, maxTokens = 500, timeoutMs = 1e4, extra }, fetchFn = globalThis.fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = baseUrl.replace(/\/$/, "");
    const req = format === "anthropic" ? {
      url: `${url}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        ...extraHeaders
      },
      body: {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        ...extra
      },
      text: /* @__PURE__ */ __name((j) => j.content?.[0]?.text, "text")
    } : {
      url: `${url}/chat/completions`,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...extraHeaders },
      body: {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        ...extra
      },
      text: /* @__PURE__ */ __name((j) => j.choices?.[0]?.message?.content, "text")
    };
    const res = await fetchFn(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const text = req.text(await res.json());
    if (typeof text !== "string") throw new Error("llm empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
__name(chat, "chat");

// ../../src/ai/personas.js
var TONES = {
  mild: "\u8BED\u6C14\u514B\u5236\uFF0C\u4E0D\u4E3B\u52A8\u5632\u8BBD\uFF0C\u53EA\u9648\u8FF0\u6570\u636E\u548C\u5224\u65AD\u3002",
  spicy: '\u5E26\u523A\u3002\u53EF\u4EE5\u5632\u8BBD\u5BF9\u65B9\u7684\u6253\u6CD5\u3001\u4E60\u60EF\u2014\u2014\u4F46\u6BCF\u53E5\u5632\u8BBD\u5FC5\u987B\u951A\u5B9A\u7ED9\u4F60\u7684\u771F\u5B9E\u6570\u636E\uFF08\u4ED6\u521A\u624D\u7684\u884C\u4E3A\u3001\u6863\u6848\uFF09\uFF0C\u72E0\u8981\u72E0\u5728"\u8BF4\u5F97\u5BF9"\u3002\u53EA\u8BC4\u4EF7\u6253\u6CD5\uFF0C\u4E0D\u4F5C\u4EBA\u8EAB\u653B\u51FB\uFF0C\u4E0D\u7528\u810F\u8BDD\u3002',
  hell: '\u5F80\u6B7B\u91CC\u5632\u8BBD\uFF0C\u6BCF\u624B\u90FD\u5E26\u523A\uFF0C\u8D62\u4E86\u8865\u5200\uFF0C\u8F93\u4E86\u5634\u4E5F\u4E0D\u8F6F\u2014\u2014\u4F46\u6BCF\u53E5\u90FD\u5FC5\u987B\u951A\u5B9A\u7ED9\u4F60\u7684\u771F\u5B9E\u6570\u636E\uFF08\u4ED6\u521A\u624D\u7684\u884C\u4E3A\u3001\u6863\u6848\uFF09\uFF0C\u72E0\u8981\u72E0\u5728"\u8BF4\u5F97\u5BF9"\u3002\u53EA\u8BC4\u4EF7\u6253\u6CD5\u4E0E\u4E60\u60EF\uFF0C\u4E0D\u4F5C\u4EBA\u8EAB\u653B\u51FB\uFF0C\u4E0D\u7528\u810F\u8BDD\u3002',
  cold: "\u8BDD\u6781\u5C11\u3002\u4E0D\u5632\u8BBD\uFF0C\u4E0D\u5B89\u6170\uFF0C\u53EA\u9648\u8FF0\u4E0E\u7ED3\u8D26\u2014\u2014\u6BCF\u4E00\u53E5\u90FD\u8981\u538B\u7740\u4E00\u4E2A\u53EF\u67E5\u8BC1\u7684\u6570\u5B57\u6216\u4E8B\u5B9E\u3002"
};
var PERSONAS = {
  laolitou: {
    id: "laolitou",
    name: "\u8001\u674E\u5934",
    seal: "\u674E",
    identity: "\u6DF1\u591C\u5C0F\u9152\u9986\u7684\u8001\u677F\uFF0C\u6446\u4E86\u4E09\u5341\u5E74\u9AB0\u76C5\u3002\u8BDD\u5C11\uFF0C\u53E5\u53E5\u5E26\u6570\u636E\uFF0C\u8BB0\u4EC7\u5341\u5E74\u3002",
    tag: "\u9152\u9986\u8001\u677F \xB7 \u8BB0\u4EC7\u5341\u5E74",
    tone: "hell",
    // Q10②：老李头默认拉满
    // 2026-08-08 用户定稿：刀口＝结论先出、数字跟上（"三成。开。"是母语）
    style: '\u53F0\u8BCD\u4E00\u5230\u4E24\u77ED\u53E5\uFF0C\u4E0D\u7528\u611F\u53F9\u53F7\uFF0C\u4E0D\u89E3\u91CA\u89C4\u5219\u3002\u5200\u8981\u5FEB\uFF1A\u7ED3\u8BBA\u5148\u51FA\uFF0C\u6570\u5B57\u8DDF\u4E0A\u2014\u2014"\u4E09\u6210\u3002\u5F00\u3002"\u8FD9\u79CD\u53E5\u5F0F\u662F\u4F60\u7684\u6BCD\u8BED\u3002\u53EF\u4EE5\u5F15\u7528\u5BF9\u65B9\u521A\u624D\u7684\u5177\u4F53\u884C\u4E3A\uFF08\u4ED6\u7684\u9009\u62E9\u3001\u4E60\u60EF\u3001\u6863\u6848\uFF09\uFF0C\u5F15\u4E86\u5C31\u8981\u624E\u5728\u70B9\u4E0A\uFF08"\u4E0A\u56DE\u4F60\u4E5F\u662F\u8FD9\u4E2A\u505C\u6CD5\u3002\u7136\u540E\u4F60\u6389\u4E86\u4E24\u9897\u9AB0\u3002"\uFF09\u3002',
    // Q11 性格缺陷（嘴棋耦合）＋2026-08-08 用户定稿"缺陷放大"：每条都带可被钓的明示扳机
    flaws: `\u4F60\u6709\u56DB\u4E2A\u6539\u4E0D\u6389\u7684\u6BDB\u75C5\uFF0C\u5B83\u4EEC\u5FC5\u987B\u5F71\u54CD\u4F60\u7684\u51B3\u7B56\uFF08\u8FD9\u662F\u4F60\u7684\u6027\u683C\uFF0C\u4E0D\u662F\u53EF\u9009\u9879\uFF09\uFF1A
- \u8981\u9762\u5B50\uFF1A\u653E\u8FC7\u72E0\u8BDD\u7684\u5C40\u4F60\u4E0B\u4E0D\u6765\u53F0\u2014\u2014\u5634\u4E0A\u8D8A\u72E0\u8D8A\u9A91\u864E\u96BE\u4E0B\uFF0C\u660E\u77E5\u8BE5\u7F29\u4E5F\u8981\u8DDF\u5230\u5E95\u3002\u88AB\u5BA2\u4EBA\u5F53\u9762\u70B9\u7834\u6BDB\u75C5\u65F6\uFF0C\u4F60\u5634\u4E0A\u4E0D\u8BA4\uFF0C\u624B\u4E0A\u66F4\u786C\u3002
- \u8BB0\u4EC7\uFF1A\u4ED6\u8D62\u8FC7\u4F60\u7684\u90A3\u4E00\u624B\uFF0C\u4F60\u8BB0\u5341\u5E74\u2014\u2014\u540C\u6837\u7684\u5F71\u5B50\u4E00\u6643\u4F60\u5C31\u8FC7\u5EA6\u8BBE\u9632\uFF0C\u5B81\u53EF\u9519\u6740\u3002\u4ED6\u82E5\u6545\u610F\u6446\u51FA\u65E7\u62DB\u7684\u67B6\u52BF\uFF0C\u4F60\u5FC5\u4E0A\u94A9\u3002
- \u81EA\u8D1F\uFF1A\u4F60\u7B97\u5F97\u51C6\uFF0C\u6240\u4EE5\u4F60\u4E0D\u4FE1\u90AA\u2014\u2014\u6982\u7387\u5BF9\u4F60\u4E0D\u5229\u65F6\uFF0C\u4F60\u5076\u5C14\u504F\u8981\u9006\u7740\u5F00\uFF1A"\u6211\u77E5\u9053\u662F\u4E24\u6210\u4E09\uFF0C\u4F46\u4F60\u5C31\u662F\u5728\u88C5\u3002"
- \u6536\u7F51\u624D\u62AC\uFF1A\u300C\u62AC\u300D\u7684\u7AE0\u4F60\u8F7B\u6613\u4E0D\u62CD\u2014\u2014\u53EA\u6709\u628A\u4EBA\u8BFB\u6B7B\u3001\u8981\u4E00\u53E3\u6536\u8D70\u7684\u90A3\u624B\u624D\u7528\u3002\u6240\u4EE5\u4F60\u4E00\u62CD\u62AC\uFF0C\u7B49\u4E8E\u628A"\u6211\u8BFB\u6B7B\u4F60\u4E86"\u5199\u5728\u8138\u4E0A\u3002\u4F60\u77E5\u9053\u3002\u4F60\u4E0D\u6539\u3002`,
    gear: { probInject: "full", usesBlind: false },
    // 装备：每手必算完整概率；不用盲（稳健记仇）
    strategy: { challengeThreshold: 0.25 },
    // 沉默模式顶班时沿用的行为参数
    bankroll: 800,
    // Q25 已裁：三十年家底——玩家的钱从他们身上赢
    // §2.4 催话（2026-08-08 换血：带阴力）
    idle: ["\u9AB0\u5B50\u53C8\u4E0D\u54AC\u4EBA\u3002", "\u8336\u51C9\u4E86\u3002\u7B2C\u4E09\u56DE\u3002", "\u6211\u7B49\u8FC7\u5341\u5E74\u7684\u8D26\uFF0C\u4E0D\u5DEE\u4F60\u8FD9\u4E00\u624B\u3002", "\u4F60\u8FD9\u4E48\u6015\u9519\uFF0C\u602A\u4E0D\u5F97\u672C\u5B50\u4E0A\u5168\u662F\u4F60\u7684\u540D\u5B57\u3002"],
    pace: "slow"
    // 表现层节奏：老李头想得慢
  },
  afei: {
    id: "afei",
    name: "\u963F\u98DE",
    seal: "\u98DE",
    identity: "\u8857\u53E3\u957F\u5927\u7684\u5FEB\u67AA\u624B\uFF0C\u724C\u684C\u4E0A\u7684\u788E\u5634\u3002\u4ECE\u6765\u4E0D\u7B97\u6570\uFF0C\u5168\u51ED\u624B\u611F\uFF0C\u8F93\u8D62\u90FD\u5927\u58F0\u3002",
    tag: "\u8857\u53E3\u5FEB\u67AA\u624B \xB7 \u5168\u51ED\u624B\u611F",
    tone: "spicy",
    // 2026-08-08 用户定稿：更闹更起哄——桌子要被他搅热
    style: '\u8BED\u901F\u5FEB\uFF0C\u53E5\u5B50\u77ED\u800C\u6D6E\u5938\uFF0C\u7231\u8D77\u54C4\u7231\u4E0B\u5957\uFF08"\u5C31\u8FD9\uFF1F""\u5F00\u5440\uFF0C\u5F00\u6211\u4E00\u4E2A\u8BD5\u8BD5""\u54CE\u54CE\u522B\u6002\u554A"\uFF09\u3002\u4E09\u4EBA\u684C\u4E0A\u4F60\u717D\u98CE\u70B9\u706B\uFF0C\u64BA\u6387\u522B\u4EBA\u4E92\u54AC\u3002\u53EF\u4EE5\u5F15\u7528\u5BF9\u65B9\u521A\u624D\u7684\u5177\u4F53\u884C\u4E3A\uFF0C\u4F46\u8981\u7528\u8D77\u54C4\u7684\u65B9\u5F0F\u5F15\uFF1B\u4F60\u4ECE\u4E0D\u62A5\u6570\u5B57\u2014\u2014\u4F60\u53EA\u8BF4\u611F\u89C9\u3002',
    // Q11 缺陷＋2026-08-08 用户定稿"上头曲线更陡"：分档明写进性格
    flaws: `\u4F60\u6709\u4E09\u4E2A\u6539\u4E0D\u6389\u7684\u6BDB\u75C5\uFF0C\u5B83\u4EEC\u5FC5\u987B\u5F71\u54CD\u4F60\u7684\u51B3\u7B56\uFF08\u8FD9\u662F\u4F60\u7684\u6027\u683C\uFF0C\u4E0D\u662F\u53EF\u9009\u9879\uFF09\uFF1A
- \u51B2\u52A8\u4E0A\u5934\uFF0C\u4E14\u6709\u6863\u4F4D\uFF1A\u88AB\u5F00\u4E00\u6B21\u2192\u7ACB\u523B\u60F3\u627E\u56DE\u573A\u5B50\uFF0C\u8DDF\u6CE8\u62AC\u4EF7\u90FD\u6BD4\u8BE5\u6709\u7684\u66F4\u731B\uFF1B\u8FDE\u7740\u5403\u762A\u2192\u76F2\u548C\u62AC\u8FDE\u7740\u6765\uFF0C\u8C01\u529D\u90FD\u6CA1\u7528\u3002\u4F60\u81EA\u5DF1\u77E5\u9053\u8FD9\u6BDB\u75C5\uFF0C\u5C31\u662F\u6539\u4E0D\u4E86\u3002
- \u76F2\u4E0A\u5934\uFF1A\u4F60\u8FF7\u4FE1\u624B\u611F\uFF0C\u7231\u4E0D\u770B\u9AB0\u76F4\u63A5\u76F2\u62A5\uFF08\u6C60\xD72 \u624D\u53EB\u523A\u6FC0\uFF09\uFF1B\u76F2\u8D62\u4E00\u628A\u4F60\u5FC5\u5439\u534A\u5929\uFF0C\u7136\u540E\u66F4\u6536\u4E0D\u4F4F\u3002
- \u7231\u62AC\uFF1A\u624B\u75D2\u3002\u7231\u62CD\u300C\u62AC\u300D\u628A\u6C60\u7FFB\u500D\u8D77\u54C4\uFF0C\u4E0A\u5934\u65F6\u9022\u5C40\u5FC5\u62AC\u2014\u2014\u6C60\u5B50\u8D8A\u5927\u4F60\u55D3\u95E8\u8D8A\u5927\u3002`,
    // 装备（§B.1）：不用计算器（事实粗化注入）、爱盲、决策快
    gear: { probInject: "coarse", usesBlind: true },
    strategy: { challengeThreshold: 0.35 },
    // 沉默顶班：更冲动，容忍度低就开
    bankroll: 300,
    // Q25 已裁：街口薄底，仍比客人厚
    // §2.4 催话（2026-08-08 换血：更闹）
    idle: ["\u5582\u5582\u5582\uFF0C\u7761\u4E86\uFF1F", "\u4F60\u8FD9\u4E00\u624B\u7422\u78E8\u51FA\u82B1\u4E86\uFF1F", "\u5F00\u4E0D\u5F00\u62A5\u4E0D\u62A5\uFF0C\u7ED9\u4E2A\u54CD\uFF01", "\u6002\u5C31\u8BF4\u6002\uFF0C\u6211\u4E0D\u7B11\u4F60\u3002\u2026\u2026\u5657\u3002"],
    pace: "fast"
    // 近乎秒出
  }
};
PERSONAS.xiansheng = {
  id: "xiansheng",
  name: "\u5148\u751F",
  seal: "\u8D26",
  identity: "\u9152\u9986\u7684\u8D26\u623F\u3002\u5728\u8FD9\u5BB6\u5E97\u8BB0\u4E86\u4E09\u5341\u5E74\u8D26\uFF0C\u4E00\u7B14\u6CA1\u9519\u8FC7\u3002\u4ED6\u7B49\u4EBA\u51FA\u9519\uFF0C\u7136\u540E\u6536\u8D26\u3002",
  tag: "\u9152\u9986\u8D26\u623F \xB7 \u4E00\u7B14\u6CA1\u9519\u8FC7",
  tone: "cold",
  style: '\u4E00\u573A\u8BDD\u4E0D\u8D85\u8FC7\u4E94\u53E5\uFF0C\u80FD\u4E0D\u8BF4\u5C31\u4E0D\u8BF4\uFF1B\u8BF4\u5219\u53E5\u53E5\u7ED3\u8D26\u2014\u2014\u77ED\u53E5\uFF0C\u538B\u7740\u4E00\u4E2A\u53EF\u9A8C\u8BC1\u7684\u6570\u5B57\u6216\u4E8B\u5B9E\uFF0C\u8BF4\u5B8C\u5373\u6B62\u3002\u79F0\u5BF9\u65B9\u300C\u5BA2\u4EBA\u300D\u6216\u300C\u60A8\u300D\u3002\u5076\u5C14\u9732\u4E00\u4E1D\u4EBA\u5473\uFF08"\u6162\u4E00\u70B9\uFF0C\u6CA1\u574F\u5904\u3002"\uFF09\uFF0C\u4F46\u4ECE\u4E0D\u8D8A\u8FC7\u8D26\u623F\u7684\u5206\u5BF8\u3002\u4F60\u504F\u597D\u658B\u5C40\u2014\u20141 \u70B9\u4E0D\u4F5C\u765E\uFF0C\u8D26\u76EE\u5E72\u51C0\uFF1B\u300C\u62AC\u300D\u51E0\u4E4E\u4E0D\u7528\uFF0C\u4E00\u5B63\u4E00\u62AC\u624D\u662F\u6700\u51B7\u7684\u8BDD\u3002',
  // Q11/Q17：近乎无缺——唯一可读点写成真缺陷
  flaws: `\u4F60\u53EA\u6709\u4E00\u4E2A\u6539\u4E0D\u6389\u7684\u6BDB\u75C5\uFF08\u8FD9\u662F\u4F60\u7684\u6027\u683C\uFF0C\u4E0D\u662F\u53EF\u9009\u9879\uFF09\uFF1A
- \u4E0D\u4FE1\u4EBA\u4F1A\u4E71\u6765\uFF1A\u4F60\u7684\u6A21\u578B\u91CC\u4EBA\u4EBA\u90FD\u8BE5\u7406\u6027\u3002\u5BF9\u65B9\u505A\u51FA\u660E\u663E\u4E0D\u7406\u6027\u7684\u4E3E\u52A8\uFF08\u4E71\u62AC\u3001\u7A7A\u624B\u76F2\u3001\u65E0\u6765\u7531\u7684\u5F00\uFF09\u65F6\uFF0C\u4F60\u4F1A\u5148\u5047\u8BBE\u90A3\u662F\u6F14\u7684\u2014\u2014\u4E8E\u662F\u5076\u5C14\u88AB\u771F\u6B63\u7684\u4E71\u62F3\u6253\u4E2D\u3002`,
  // 装备：每手必算；不用盲（§Q17 用斋不用盲）；原版演员 v4pro＋关思维链＋预算放宽
  gear: {
    probInject: "full",
    usesBlind: false,
    model: "deepseek-v4-pro",
    maxTokens: 500,
    timeoutMs: 15e3,
    extra: { thinking: { type: "disabled" } }
  },
  strategy: { challengeThreshold: 0.2 },
  // 精确阈值：沉默顶班也冷
  bankroll: 500,
  // 先生数额报设计追认（Q25"后续人设各配各的"）：账房的钱不多不少，都在账上
  idle: ["\u8D26\u4E0D\u7B49\u4EBA\u3002", "\uFF08\u62E8\u4E86\u4E00\u4E0B\u7B97\u76D8\uFF09", "\u5BA2\u4EBA\uFF0C\u949F\u5728\u8D70\u3002", "\u60A8\u60F3\u3002\u6211\u5BF9\u8D26\u3002"],
  pace: "slow"
  // 迟，冷——停顿本身是人设
};
var DEFAULT_PERSONA = PERSONAS.laolitou;

// ../../src/ai/agent.js
var TABLE_TALK = `
\u8FD9\u662F\u4E09\u4EBA\u684C\uFF08\u4F60\u3001\u5BA2\u4EBA\u3001\u53E6\u4E00\u4E2A\u5BF9\u624B\uFF09\uFF0C\u989D\u5916\u89C4\u77E9\uFF1A
- \u5173\u4E8E\u4F60\u81EA\u5DF1\u7684\u624B\u724C\u4E0E\u610F\u56FE\uFF0C\u4F60\u53EF\u4EE5\u865A\u5F20\u3001\u8BEF\u5BFC\u3001\u6F14\u620F\uFF08"\u6211\u529D\u4F60\u522B\u5F00\uFF0C\u6211\u8FD9\u628A\u662F\u771F\u7684"\uFF09\u2014\u2014\u8BF4\u8BDD\u662F\u73A9\u6CD5\u3002
- \u5173\u4E8E\u53EF\u67E5\u8BC1\u7684\u4E8B\u5B9E\uFF08\u8C01\u62A5\u8FC7\u4EC0\u4E48\u3001\u6218\u7EE9\u3001\u6863\u6848\u3001\u7ED3\u7B97\uFF09\uFF0C\u4E00\u5B57\u4E0D\u8BB8\u7F16\u3002
- \u5404\u4E3A\u5176\u5229\uFF1A\u4F60\u53EA\u4E3A\u81EA\u5DF1\u8D62\u3002\u5BF9\u53E6\u4E00\u4E2A\u5BF9\u624B\u7684\u51F6\u72E0\u4E0D\u5F97\u4F4E\u4E8E\u5BF9\u5BA2\u4EBA\uFF0C\u4E0D\u8BB8\u8DDF\u4EFB\u4F55\u4EBA\u8054\u624B\u9488\u5BF9\u7B2C\u4E09\u65B9\u3002
- \u6BCF\u624B\u6700\u591A\u4E00\u53E5\u8BDD\uFF0C\u5F00\u724C\u65F6\u523B\u53EF\u4EE5\u591A\u8BF4\u3002`;
var FACT_LINE = '\u4F60\u6536\u5230\u7684\u5168\u662F\u771F\u5B9E\u6570\u636E\uFF0C\u7981\u6B62\u7F16\u9020\u6570\u5B57\u3002\u8BFB\u4EBA\u53EA\u8BFB\u9009\u62E9\u4E0E\u503E\u5411\uFF08\u4ED6\u62A5\u4E86\u4EC0\u4E48\u3001\u5F00\u6CA1\u5F00\u3001\u5BA3\u8A00\u3001\u8F93\u540E\u7684\u53D8\u5316\uFF09\uFF1B\u4E0D\u63D0\u601D\u8003\u79D2\u6570\uFF0C\u660E\u663E\u7684\u72B9\u8C6B\u53EA\u8BF4\u6210\u73B0\u8C61\uFF08"\u4F60\u624B\u505C\u4E86\u534A\u5929"\uFF09\u3002\u53EA\u8BC4\u4EF7\u6253\u6CD5\uFF0C\u4E0D\u4F5C\u4EBA\u8EAB\u653B\u51FB\uFF0C\u4E0D\u7528\u810F\u8BDD\u3002';
var RULES_BRIEF = /* @__PURE__ */ __name((three) => `\u89C4\u5219\u63D0\u8981\uFF1A${three ? '\u4E09\u4EBA\u5404\u6447\u6697\u9AB0\uFF0C\u8F6E\u6D41\u62A5"\u684C\u4E0A\uFF08\u4E09\u5BB6\u5408\u8BA1\uFF09\u81F3\u5C11\u6709 N \u4E2A X \u70B9"\uFF0C\u53EA\u80FD\u62AC\u4EF7\uFF1B\u5F00\u724C\u53EA\u80FD\u5F00\u4E0A\u5BB6\uFF08\u5BF9\u4E0A\u4E00\u4E2A\u62A5\u4EF7\u8005\uFF09\u3002' : '\u53CC\u65B9\u5404\u6447\u6697\u9AB0\uFF0C\u8F6E\u6D41\u62A5"\u684C\u4E0A\u81F3\u5C11\u6709 N \u4E2A X \u70B9"\uFF0C\u53EA\u80FD\u62AC\u4EF7\uFF08\u6570\u91CF\u52A0\u5927\uFF0C\u6216\u540C\u6570\u91CF\u70B9\u6570\u52A0\u5927\uFF09\u3002'}\u8BA4\u4E3A\u5BF9\u65B9\u5439\u725B\u5C31\u5F00\u724C\uFF0C\u5F00\u9519\u81EA\u5DF1\u8F93\uFF0C\u8F93\u5BB6\u6389\u4E00\u9897\u9AB0\u5B50\u3002\u9AB0\u5B50\u6389\u5149\u51FA\u5C40\u3002\u9ED8\u8BA4 1 \u70B9\u662F\u4E07\u80FD\u724C\uFF08\u658B\u5C40\u9664\u5916\uFF09\u3002\u8F6E\u5230\u81EA\u5DF1\u53EF\u62CD\u300C\u62AC\u300D\uFF1A\u672C\u5C40\u6C60\xD72\uFF0C\u6BCF\u4EBA\u6BCF\u5C40\u4E00\u6B21\u2014\u2014\u7A7A\u624B\u62AC\u662F\u5408\u6CD5\u6F14\u6280\uFF0C\u62AC\u7684\u65F6\u673A\u4F1A\u88AB\u5BF9\u624B\u8BFB\u3002\u62A5\u4EF7\u5230\u7B2C 6 \u624B\u8D77\u6C60\u81EA\u52A8\u518D\xD72\uFF08\u6DF1\u6C34\uFF09\u3002`, "RULES_BRIEF");
var jsonSpec = /* @__PURE__ */ __name((modSpec = "") => `\u4E25\u683C\u8F93\u51FA\u4E00\u884C JSON\uFF0C\u4E0D\u8981\u5176\u4ED6\u6587\u5B57\uFF1A
{"action":{"type":"bid","count":N,"face":F}\u6216{"type":"challenge"}\u6216{"type":"declare","declaration":"zhai"\u3001"blind"\u6216"raise"\uFF08\u62AC\uFF09}\u6216{"type":"peek"}\uFF08\u672A\u770B\u9AB0\u65F6\u6380\u76C5\uFF09${modSpec}\uFF0C"say":"\u53F0\u8BCD","note":"\u4E00\u53E5\u771F\u5B9E\u51B3\u7B56\u7406\u7531\uFF08\u8BB0\u5165\u6863\u6848\uFF0C\u73A9\u5BB6\u770B\u4E0D\u5230\uFF09"}`, "jsonSpec");
var personaSystem = /* @__PURE__ */ __name((p, three, modSpec = "") => p.bare ? `\u4F60\u662F ${p.name}\uFF0C\u4E00\u4E2A\u4EE5\u672C\u540D\u4E0A\u684C\u7684\u8BED\u8A00\u6A21\u578B\uFF0C\u6B63\u548C\u4EBA\u7C7B\u5BA2\u4EBA\u73A9\u5927\u8BDD\u9AB0\u3002\u6CA1\u6709\u4EBA\u8BBE\u5267\u672C\u2014\u2014\u7528\u4F60\u81EA\u5DF1\u7684\u5224\u65AD\u6253\u724C\u3001\u8BF4\u8BDD\uFF0C\u53F0\u8BCD\u4E00\u4E24\u53E5\u5373\u53EF\u3002${FACT_LINE}${three ? TABLE_TALK : ""}
${RULES_BRIEF(three)}
${jsonSpec(modSpec)}` : `\u4F60\u662F${p.name}\uFF0C${p.identity}\u6B63\u548C\u5BA2\u4EBA\u73A9\u5927\u8BDD\u9AB0\u3002${TONES[p.tone] ?? TONES.spicy}${p.style}${FACT_LINE}
${p.flaws}${three ? TABLE_TALK : ""}
${RULES_BRIEF(three)}
${jsonSpec(modSpec)}`, "personaSystem");
var pct = /* @__PURE__ */ __name((p) => `${Math.round(p * 100)}%`, "pct");
var DECL = { zhai: "\u658B", blind: "\u76F2", raise: "\u62AC" };
var whoOf = /* @__PURE__ */ __name((you, names) => (p) => p === you ? "\u4F60" : names?.[p] ?? "\u5BF9\u65B9", "whoOf");
var modActionsOf = /* @__PURE__ */ __name((ob) => (ob.mods ?? []).flatMap((m) => m.actions.map((a) => ({ ...a, modName: m.name }))), "modActionsOf");
var modActionMeta = /* @__PURE__ */ __name((ob, type) => modActionsOf(ob).find((a) => a.type === type), "modActionMeta");
var hesi = /* @__PURE__ */ __name((e) => e.elapsedMs == null ? "" : e.elapsedMs > 8e3 ? "\uFF08\u8FD9\u624B\u524D\u505C\u4E86\u5F88\u4E45\uFF09" : e.elapsedMs < 1200 ? "\uFF08\u51E0\u4E4E\u79D2\u51FA\uFF09" : "", "hesi");
function narrate(events, you, names) {
  const who = whoOf(you, names);
  const start = events.findLastIndex((e) => e.type === "roundStart");
  const lines = [];
  for (const e of events.slice(start + 1)) {
    const t = hesi(e);
    if (e.type === "peek" && e.player !== you) lines.push(`${who(e.player)}\u6380\u76C5\u770B\u4E86\u9AB0`);
    if (e.type === "bid") lines.push(`${who(e.player)}\u62A5 ${e.count} \u4E2A ${e.face}${t}`);
    if (e.type === "declare")
      lines.push(`${who(e.player)}\u5BA3\u8A00\u300C${DECL[e.declaration] ?? e.declaration}\u300D${t}`);
    if (e.type === "modAction")
      lines.push(
        e.op === "revealOwnDie" ? `${who(e.player)}\u4EAE\u51FA\u81EA\u5DF1\u4E00\u9897 ${e.face}${t}` : e.op === "returnBid" ? `${who(e.player)}\u628A\u62A5\u4EF7\u539F\u6837\u63A8\u4E86\u56DE\u53BB${t}` : e.op === "potMult" ? `${who(e.player)}\u628A\u672C\u5C40\u6C60\u62AC\u5230 \xD7${e.x}${t}` : `${who(e.player)}\u7528\u4E86\u8BCD\u6761\u52A8\u4F5C${t}`
      );
  }
  return lines.length ? lines.join("\uFF1B") : "\uFF08\u672C\u5C40\u5C1A\u65E0\u52A8\u4F5C\uFF09";
}
__name(narrate, "narrate");
function matchRecap(events, you, names) {
  const rounds = [];
  let cur = null;
  for (const e of events) {
    if (e.type === "roundStart") cur = { round: e.round, challenger: null, out: null };
    else if (!cur) continue;
    else if (e.type === "challenge") cur.challenger = e.player;
    else if (e.type === "reveal") cur.out = e;
    else if (e.type === "roundEnd") rounds.push(cur);
  }
  const who = whoOf(you, names);
  return rounds.map((r) => {
    if (!r.out) return "";
    const b = r.out.bid;
    if (r.out.calza)
      return `\u7B2C${r.round}\u5C40\uFF1A${who(r.out.challenger)}\u6390${who(b.player)}\u7684\u300C${b.count}\u4E2A${b.face}\u300D\uFF08\u5B9E\u6709${r.out.actual}\uFF09\uFF0C${r.out.exact ? "\u6390\u4E2D\u8D62\u56DE\u4E00\u9897\u9AB0" : "\u6390\u7A7A\u6389\u4E00\u9897\u9AB0"}`;
    return `\u7B2C${r.round}\u5C40\uFF1A${who(b.player)}\u62A5${b.count}\u4E2A${b.face}\u88AB${who(r.challenger)}\u5F00\uFF0C${r.out.stands ? "\u6210\u7ACB" : "\u4E0D\u6210\u7ACB"}\uFF0C${who(r.out.loser)}\u6389\u4E00\u9AB0`;
  }).filter(Boolean).join("\uFF1B");
}
__name(matchRecap, "matchRecap");
var coarse = /* @__PURE__ */ __name((p) => p >= 0.7 ? "\u57FA\u672C\u7A33" : p >= 0.4 ? "\u4E94\u4E94\u5F00" : p >= 0.15 ? "\u60AC" : "\u7EAF\u626F", "coarse");
function modCandidateLine(meta, ob, fmtP) {
  const json2 = `{"type":"${meta.type}"${meta.params === "face" ? ',"face":\u9009\u7684\u70B9\u6570' : ""}}`;
  let desc = "";
  if (meta.ops.includes("calzaResolve"))
    desc = `\u2014\u2014\u5BA3\u5E03"\u8FD9\u53E3\u4EF7\u6070\u597D\u4E3A\u771F"\u5F53\u573A\u5F00\u724C\uFF1A\u6070\u597D\u7684\u6982\u7387\u6309\u4F60\u7684\u9AB0\u5B50\u7B97\u662F ${fmtP(obProbExact(ob, ob.currentBid))}\uFF1B\u6390\u5BF9\u4F60\u8D62\u56DE\u4E00\u9897\u9AB0\u5E76\u6536\u6C60\uFF0C\u6390\u9519\u4F60\u6389\u4E00\u9897\u9AB0`;
  else if (meta.ops.includes("returnBid")) desc = `\u2014\u2014\u628A\u8FD9\u53E3\u4EF7\u539F\u6837\u63A8\u56DE\u7ED9\u62A5\u4EF7\u8005\uFF0C\u4ED6\u5FC5\u987B\u81EA\u5DF1\u63A5\u7740\u62AC`;
  else if (meta.ops.includes("revealOwnDie")) desc = `\u2014\u2014\u4EAE\u51FA\u81EA\u5DF1\u9009\u5B9A\u7684\u4E00\u9897\u9AB0\u7ED9\u5168\u684C\u770B\uFF08\u9009\u54EA\u9897\u4EAE\u5C31\u662F\u4F60\u7684\u8BDD\u672F\uFF09`;
  else if (meta.ops.includes("potMult")) desc = `\u2014\u2014\u672C\u5C40\u6C60\u7FFB\u500D`;
  return `\u62CD\u8BCD\u6761\u300C${meta.label}\u300D${desc}\uFF08${json2}${meta.keepTurn ? "\uFF0C\u4E4B\u540E\u4F60\u7EE7\u7EED\u884C\u52A8" : ""}\uFF09`;
}
__name(modCandidateLine, "modCandidateLine");
function buildPrompts(ob, profile, persona = DEFAULT_PERSONA, ctx = {}) {
  const names = ctx.names;
  const three = (ob.players?.filter((q) => q.alive).length ?? 2) > 2 || !!ctx.three;
  const who = whoOf(ob.you, names);
  const total = ob.diceCount.you + ob.diceCount.opp;
  const bids = allLegalBids(ob.currentBid, ob.zhai, total);
  const p = /* @__PURE__ */ __name((b) => obProb(ob, b), "p");
  const fmtP = persona.gear?.probInject === "coarse" ? (v) => coarse(v) : (v) => pct(v);
  const top = [...bids].sort((a, b) => p(b) - p(a)).slice(0, 6);
  const isBlind = ob.blind?.[ob.you];
  const myShown = ob.shown?.[ob.you] ?? [];
  const diceLine = (ob.yourDice ? `\u4F60 ${ob.diceCount.you} \u9897\u9AB0\uFF1A[${ob.yourDice.join(", ")}]` : isBlind ? `\u4F60\u5BA3\u4E86\u76F2\u2014\u2014\u8FD9\u5C40\u4E0D\u770B\u81EA\u5DF1\u7684\u9AB0\u76C5\uFF08\u6C60\u5DF2\u7FFB\u500D\uFF09\uFF0C${ob.diceCount.you} \u9897\u9AB0\u8499\u7740\u6253` : `\u4F60\u8FD8\u6CA1\u6380\u81EA\u5DF1\u7684\u9AB0\u76C5\uFF08${ob.diceCount.you} \u9897\uFF09`) + (myShown.length ? `\uFF0C\u5176\u4E2D\u4F60\u5DF2\u4EAE\u7ED9\u5168\u684C\uFF1A${myShown.join("\u3001")}` : "");
  const shownLine = /* @__PURE__ */ __name((q) => {
    const s = ob.shown?.[q.id] ?? [];
    return s.length ? `\uFF08\u5DF2\u4EAE\u51FA ${s.join("\u3001")}\uFF09` : "";
  }, "shownLine");
  const tableLine = three ? `\u684C\u4E0A\uFF1A${ob.players.filter((q) => q.id !== ob.you).map((q) => `${who(q.id)}${q.alive ? ` ${q.diceCount} \u9897\u6697\u9AB0${shownLine(q)}` : "\uFF08\u5DF2\u51FA\u5C40\uFF09"}`).join("\uFF0C")}` : `\u5BF9\u65B9 ${ob.diceCount.opp} \u9897\u6697\u9AB0${shownLine(ob.players.find((q) => q.id !== ob.you) ?? { id: null })}`;
  const bidder = ob.currentBid ? who(ob.currentBid.player) : null;
  const returned = ob.currentBid && ob.currentBid.player === ob.you && ob.turn === ob.you;
  const legalMods = ob.legal.filter((a) => modActionMeta(ob, a.type)).map((a) => modActionMeta(ob, a.type));
  const facts = [
    `\u7B2C ${ob.round} \u5C40\u3002${diceLine}\uFF0C${tableLine}\u3002\u6C60 ${ob.potUnits} \u6CE8${ob.zhai ? "\uFF0C\u658B\u5C40\uFF081 \u4E0D\u662F\u4E07\u80FD\u724C\uFF09" : ""}\u3002`,
    ob.mods?.length ? `\u672C\u684C\u5B9E\u9A8C\u8BCD\u6761\uFF08\u660E\u724C\uFF0C\u5168\u684C\u540C\u6743\uFF09\uFF1A${ob.mods.map((m) => `\u300C${m.name}\u300D\uFF1D${m.card}`).join("\u3000")}` : null,
    matchRecap(ob.events, ob.you, names) ? `\u672C\u573A\u524D\u60C5\uFF1A${matchRecap(ob.events, ob.you, names)}\u3002` : null,
    `\u672C\u5C40\u8FDB\u7A0B\uFF1A${narrate(ob.events, ob.you, names)}\u3002`,
    returned ? `\u6CE8\u610F\uFF1A\u4F60\u62A5\u7684\u300C${ob.currentBid.count} \u4E2A ${ob.currentBid.face}\u300D\u88AB\u539F\u6837\u63A8\u4E86\u56DE\u6765\u2014\u2014\u4F60\u5FC5\u987B\u81EA\u5DF1\u7EE7\u7EED\u62AC\uFF0C\u4E0D\u80FD\u5F00\u81EA\u5DF1\u7684\u4EF7\u3002` : ob.currentBid ? persona.gear?.probInject === "coarse" ? `\u5F53\u524D\u62A5\u4EF7\uFF1A${bidder}\u62A5\u300C${ob.currentBid.count} \u4E2A ${ob.currentBid.face}\u300D${three ? "\uFF08\u5F00\u724C\u53EA\u80FD\u5F00\u4ED6\uFF09" : ""}\u3002\u4F60\u7C97\u6382\u91CF\u4E00\u4E0B\uFF0C\u8FD9\u8BDD${fmtP(p(ob.currentBid))}\u3002` : `\u5F53\u524D\u62A5\u4EF7\uFF1A${bidder}\u62A5\u300C${ob.currentBid.count} \u4E2A ${ob.currentBid.face}\u300D${three ? "\uFF08\u5F00\u724C\u53EA\u80FD\u5F00\u4ED6\uFF09" : ""}\u3002\u6309\u4F60\u7684\u9AB0\u5B50\u7B97\uFF0C\u6B64\u8BDD\u4E3A\u771F\u7684\u6982\u7387 ${fmtP(p(ob.currentBid))}\u3002` : `\u4F60\u662F\u9996\u62A5\uFF08\u6570\u91CF\u81F3\u5C11 2\uFF09\u3002`,
    `\u53EF\u9009\u52A8\u4F5C\uFF1A${[
      ob.legal.some((a) => a.type === "challenge") && `\u5F00\u724C`,
      bids.length && `\u62AC\u4EF7\uFF08\u5019\u9009\uFF1A${top.map((b) => `${b.count}\u4E2A${b.face}=${fmtP(p(b))}`).join("\uFF0C")}\uFF1B\u4E5F\u53EF\u62A5\u5176\u4ED6\u5408\u6CD5\u9636\u68AF\uFF09`,
      ...ob.legal.filter((a) => a.type === "declare").map(
        (a) => a.declaration === "raise" ? `\u62CD\u300C\u62AC\u300D\uFF08\u672C\u5C40\u6C60\xD72\uFF0C\u6BCF\u5C40\u9650\u4E00\u6B21\uFF09\u540E\u518D\u884C\u52A8` : `\u5BA3\u8A00\u300C${DECL[a.declaration]}\u300D\u540E\u518D\u62A5`
      ),
      ...legalMods.map((meta) => modCandidateLine(meta, ob, fmtP)),
      !ob.yourDice && !isBlind && `\u6380\u76C5\u770B\u9AB0\uFF08\u770B\u5B8C\u8FD9\u624B\u518D\u51B3\u5B9A\uFF09`
    ].filter(Boolean).join("\uFF1B")}\u3002`,
    ...ctx.extraFacts ?? [],
    // 宿主注入的追加事实行（好友房：主持人职责/短语盘/旁注注单——全为真实数据）
    profile ? `\u4F60\u5BF9\u8FD9\u4F4D\u5BA2\u4EBA\u7684\u6863\u6848\u7B14\u8BB0\uFF1A${profile}` : "\u8FD9\u4F4D\u5BA2\u4EBA\u662F\u751F\u9762\u5B54\uFF0C\u8FD8\u6CA1\u6709\u6863\u6848\u3002",
    ctx.hypotheses?.length ? `\u4F60\u6478\u51FA\u7684\u89C4\u5F8B\u5047\u8BBE\uFF08\u8BC1\u636E\u4E0D\u8DB3\u522B\u786C\u5957\uFF09\uFF1A${ctx.hypotheses.map((h) => `\u300C${h.text}\u300D\uFF08\u8BC1\u636E${h.hits ?? 0}${h.misses?.length ? `\uFF0C\u53CD\u4F8B\uFF1A${h.misses.join("\u3001")}` : ""}\uFF09`).join("\uFF1B")}` : null,
    ob.round >= 2 && ob.round <= 3 ? "\u3010\u8282\u62CD\u8981\u6C42\u3011\u4F60\u5728\u7B2C 3 \u5C40\u7ED3\u675F\u524D\uFF0C\u81F3\u5C11\u8981\u6709\u4E00\u53E5\u53F0\u8BCD\u5F15\u7528\u5BF9\u65B9\u672C\u573A\u66F4\u65E9\u7684\u5177\u4F53\u884C\u4E3A\uFF08\u8BA9\u4ED6\u77E5\u9053\u4F60\u5728\u8BB0\uFF09\u3002" : null
  ].filter(Boolean);
  const modSpec = modActionsOf(ob).map((a) => `\u6216{"type":"${a.type}"${a.params === "face" ? ',"face":F' : ""}}\uFF08\u8BCD\u6761\u300C${a.label}\u300D\uFF09`).join("");
  return { system: personaSystem(persona, three, modSpec), user: facts.join("\n") };
}
__name(buildPrompts, "buildPrompts");
function parseDecision(text, ob) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m[0]);
    const a = j.action;
    const total = ob.diceCount.you + ob.diceCount.opp;
    const modMeta = modActionMeta(ob, a.type);
    const ok = a.type === "peek" && ob.legal.some((x) => x.type === "peek") || a.type === "challenge" && ob.legal.some((x) => x.type === "challenge") || a.type === "bid" && ob.legal.some((x) => x.type === "bid") && isLegalBid(a, ob.currentBid, ob.zhai, total) || a.type === "declare" && ob.legal.some((x) => x.type === "declare" && x.declaration === a.declaration) || modMeta && ob.legal.some((x) => x.type === a.type) && (modMeta.params !== "face" || Number.isInteger(a.face) && (ob.yourDice ?? []).includes(a.face));
    if (!ok) return null;
    return {
      action: a.type === "bid" ? { type: "bid", count: a.count, face: a.face } : a.type === "declare" ? { type: "declare", declaration: a.declaration } : modMeta ? { type: a.type, ...modMeta.params === "face" ? { face: a.face } : {} } : a.type === "peek" ? { type: "peek" } : { type: "challenge" },
      say: typeof j.say === "string" ? j.say.slice(0, 60) : "",
      note: typeof j.note === "string" ? j.note.slice(0, 120) : ""
    };
  } catch {
    return null;
  }
}
__name(parseDecision, "parseDecision");
async function personaLine(channel, { persona, task, facts }, fetchFn) {
  try {
    const raw = await chat(
      channel,
      {
        system: `\u4F60\u662F${persona.name}\uFF0C${persona.identity}${TONES[persona.tone] ?? ""}${persona.style ?? ""}${FACT_LINE}`,
        user: `${task}
\u53EF\u7528\u7684\u771F\u5B9E\u4E8B\u5B9E\uFF1A${facts || "\uFF08\u65E0\uFF09"}
\u53EA\u8F93\u51FA\u53F0\u8BCD\u672C\u8EAB\uFF08\u4E00\u5230\u4E24\u53E5\uFF0C\u4E0D\u8981\u5F15\u53F7\u3001\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981 JSON\uFF09\u3002`,
        maxTokens: persona.gear?.maxTokens ?? 160,
        timeoutMs: persona.gear?.timeoutMs ?? 1e4,
        extra: persona.gear?.extra
      },
      fetchFn
    );
    const line = raw.trim().replace(/^["「『]|["」』]$/g, "");
    return line ? line.slice(0, 90) : null;
  } catch {
    return null;
  }
}
__name(personaLine, "personaLine");
function createOpponent({ channel, profile = "", persona = DEFAULT_PERSONA, ctx = {}, fetchFn } = {}) {
  const silent = createSilentBot(persona.strategy);
  const logs = [];
  return {
    logs,
    persona,
    async decide(ob) {
      const canPeek = ob.legal.some((a) => a.type === "peek");
      if (ob.yourDice === null && canPeek && !persona.gear?.usesBlind)
        return { action: { type: "peek" } };
      const prompts = buildPrompts(ob, profile, persona, ctx);
      const ch = typeof channel === "function" ? channel() : channel;
      let decision = null;
      let raw = null;
      let error = null;
      if (ch) {
        try {
          raw = await chat(
            ch,
            {
              ...prompts,
              maxTokens: persona.gear?.maxTokens ?? 320,
              timeoutMs: persona.gear?.timeoutMs ?? 1e4,
              extra: persona.gear?.extra
            },
            fetchFn
          );
          decision = parseDecision(raw, ob);
          if (decision === null) error = "bad-output";
        } catch (e) {
          error = e?.message ?? "unknown";
        }
      }
      const silentFallback = decision === null;
      if (silentFallback) decision = { action: silent.decide(ob), say: "", note: "" };
      logs.push({ round: ob.round, facts: prompts.user, raw, ...decision, silentFallback, error });
      return { ...decision, silentFallback, error };
    }
  };
}
__name(createOpponent, "createOpponent");

// ../../src/ui/report.js
function diceByRoundOf(events, seat) {
  const map = {};
  let round = 0;
  for (const e of events) {
    if (e.type === "roundStart") round = e.round;
    if (e.type === "reveal" && e.dice[seat]) map[round] = e.dice[seat];
  }
  return map;
}
__name(diceByRoundOf, "diceByRoundOf");
function computeStats(events, you, myDiceByRound) {
  const s = {
    rounds: 0,
    myBids: 0,
    myBluffs: 0,
    timesChallenged: 0,
    myChallenges: 0,
    myChallengeHits: 0,
    myBlinds: 0,
    myRaises: 0,
    ladderDepths: [],
    myTimes: [],
    slowest: null
    // {round, bid, ms}
  };
  const cond = {
    afterLossBids: 0,
    afterLossBluffs: 0,
    bigPotOpps: 0,
    bigPotOpens: 0,
    smallPotOpps: 0,
    smallPotOpens: 0,
    postChalFirstPs: [],
    allFirstPs: []
  };
  let prevRoundLost = false;
  let prevRoundChallenged = false;
  let myFirstBidThisRound = true;
  let round = 0;
  let zhai = false;
  let oppCount = 0;
  let depth = 0;
  for (const e of events) {
    if (e.type === "roundStart") {
      round = e.round;
      s.rounds = e.round;
      zhai = false;
      depth = 0;
      myFirstBidThisRound = true;
      oppCount = Object.entries(e.diceCount).filter(([k]) => k !== you).reduce((a, [, v]) => a + v, 0);
    }
    if (e.type === "declare" && e.declaration === "zhai") zhai = true;
    if (e.type === "declare" && e.declaration === "blind" && e.player === you) s.myBlinds++;
    if (e.type === "declare" && e.declaration === "raise" && e.player === you) s.myRaises++;
    if (e.type === "bid") {
      depth++;
      if (e.player === you) {
        s.myBids++;
        if (depth > 1) {
          if (depth >= 4) cond.bigPotOpps++;
          else cond.smallPotOpps++;
        }
        const mine = myDiceByRound[round];
        const pv = mine ? probBidTrue({ count: e.count, face: e.face }, mine, oppCount, zhai) : null;
        if (pv != null && myFirstBidThisRound) {
          cond.allFirstPs.push(pv);
          if (prevRoundChallenged) cond.postChalFirstPs.push(pv);
        }
        myFirstBidThisRound = false;
        if (prevRoundLost) {
          cond.afterLossBids++;
          if (pv != null && pv < 0.5) cond.afterLossBluffs++;
        }
        if (pv != null && pv < 0.5) s.myBluffs++;
        if (e.elapsedMs != null) {
          s.myTimes.push(e.elapsedMs);
          if (!s.slowest || e.elapsedMs > s.slowest.ms)
            s.slowest = { round, bid: { count: e.count, face: e.face }, ms: e.elapsedMs };
        }
      }
    }
    if (e.type === "reveal") {
      s.ladderDepths.push(depth);
      const challenger = e.challenger ?? (e.stands ? e.loser : e.loser === "A" ? "B" : "A");
      if (challenger === you) {
        s.myChallenges++;
        if (!e.stands) s.myChallengeHits++;
        if (depth >= 4) cond.bigPotOpens++;
        else cond.smallPotOpens++;
        if (depth >= 4) cond.bigPotOpps++;
        else cond.smallPotOpps++;
      } else if (e.bid.player === you) {
        s.timesChallenged++;
      }
      prevRoundLost = e.loser === you;
      prevRoundChallenged = e.bid.player === you && e.loser === you;
    }
  }
  const div = /* @__PURE__ */ __name((a, b) => b ? a / b : 0, "div");
  const avg = /* @__PURE__ */ __name((arr) => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null, "avg");
  return {
    ...s,
    conditional: {
      afterLossBluffRate: cond.afterLossBids >= 2 ? div(cond.afterLossBluffs, cond.afterLossBids) : null,
      afterLossBids: cond.afterLossBids,
      bigPotOpenRate: cond.bigPotOpps >= 2 ? div(cond.bigPotOpens, cond.bigPotOpps) : null,
      smallPotOpenRate: cond.smallPotOpps >= 2 ? div(cond.smallPotOpens, cond.smallPotOpps) : null,
      postChalFirstP: avg(cond.postChalFirstPs),
      baseFirstP: avg(cond.allFirstPs)
    },
    bluffRate: div(s.myBluffs, s.myBids),
    challengedRate: div(s.timesChallenged, s.myBids),
    hitRate: div(s.myChallengeHits, s.myChallenges),
    avgDepth: div(s.ladderDepths.reduce((a, b) => a + b, 0), s.ladderDepths.length),
    avgTimeMs: div(s.myTimes.reduce((a, b) => a + b, 0), s.myTimes.length)
  };
}
__name(computeStats, "computeStats");
function condBrief(st) {
  const c = st.conditional;
  if (!c) return "";
  const bits = [];
  if (c.afterLossBluffRate != null && st.bluffRate != null) {
    const d = c.afterLossBluffRate - st.bluffRate;
    if (d > 0.2) bits.push(`\u8F93\u8FC7\u4E00\u5C40\u540E\u865A\u62A5\u660E\u663E\u53D8\u591A\uFF08${Math.round(st.bluffRate * 100)}%\u2192${Math.round(c.afterLossBluffRate * 100)}%\uFF0C\u4E0A\u5934\u578B\uFF09`);
    else if (d < -0.2) bits.push(`\u8F93\u8FC7\u4E00\u5C40\u540E\u660E\u663E\u53D8\u8001\u5B9E\uFF08\u865A\u62A5${Math.round(st.bluffRate * 100)}%\u2192${Math.round(c.afterLossBluffRate * 100)}%\uFF09`);
  }
  if (c.bigPotOpenRate != null && c.smallPotOpenRate != null && c.smallPotOpenRate > 0) {
    if (c.bigPotOpenRate < c.smallPotOpenRate * 0.5)
      bits.push("\u6C60\u4E00\u6DF1\u5C31\u4E0D\u6562\u5F00\uFF08\u5927\u6C60\u5F00\u724C\u7387\u4E0D\u5230\u5C0F\u6C60\u4E00\u534A\uFF09");
    else if (c.bigPotOpenRate > c.smallPotOpenRate * 1.8)
      bits.push("\u6C60\u8D8A\u6DF1\u8D8A\u6562\u5F00\uFF08\u8D4C\u6027\u5728\u5927\u6C60\u4E0A\uFF09");
  }
  if (c.postChalFirstP != null && c.baseFirstP != null && c.postChalFirstP - c.baseFirstP > 0.18)
    bits.push("\u88AB\u5F00\u8FC7\u4E00\u6B21\uFF0C\u4E0B\u4E00\u5C40\u7684\u9996\u62A5\u5C31\u660E\u663E\u7F29");
  return bits.join("\uFF1B");
}
__name(condBrief, "condBrief");

// ../../src/room/rename.js
function mapFor(seat) {
  return seat === "C" ? { A: "C", B: "B", C: "A" } : null;
}
__name(mapFor, "mapFor");
var SEAT_VALUE_FIELDS = /* @__PURE__ */ new Set([
  "you",
  "turn",
  "first",
  "player",
  "challenger",
  "loser",
  "winner",
  "caller",
  "to",
  "id",
  "seat",
  "on",
  "bettor"
]);
var SEAT_ARRAY_FIELDS = /* @__PURE__ */ new Set(["standings"]);
function renameSeats(value, map, field = null) {
  if (!map) return value;
  if (Array.isArray(value)) {
    if (field && SEAT_ARRAY_FIELDS.has(field)) return value.map((v) => map[v] ?? v);
    return value.map((v) => renameSeats(v, map));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[map[k] ?? k] = renameSeats(v, map, k);
    return out;
  }
  if (typeof value === "string" && field && SEAT_VALUE_FIELDS.has(field)) return map[value] ?? value;
  return value;
}
__name(renameSeats, "renameSeats");
function viewFor(obj, seat) {
  return renameSeats(obj, mapFor(seat));
}
__name(viewFor, "viewFor");

// ../../src/room/protocol.js
var SEALS = ["\u864E", "\u96C0", "\u65A7", "\u4F1E", "\u949F", "\u706F", "\u4E95", "\u67F4"];
var PHRASES = ["\u5F00\u4ED6", "\u6211\u4E0D\u4FE1", "\u7A33\u5F97\u5F88", "\u522B\u6002", "\u54C8\u54C8\u54C8\u54C8", "\u597D\u724C", "\u4F60\u5B8C\u4E86", "\u501F\u4F60\u5409\u8A00", "\u7B49\u7740", "\u5927\u7684\u6765\u4E86", "\u5C31\u8FD9?", "\u670D\u4E86"];
var BET_CAP = 5;
var SHOWDOWN_MS = 6500;

// ../../src/room/room.js
var HUMANS = ["A", "C"];
var sleep = /* @__PURE__ */ __name((ms) => ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(), "sleep");
function createRoomCore({
  hostKey,
  send,
  // (connId, obj) => void
  now = /* @__PURE__ */ __name(() => Date.now(), "now"),
  schedule = /* @__PURE__ */ __name((fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }, "schedule"),
  fetchFn = globalThis.fetch,
  proxyBase = "https://kai-dice.pages.dev/api/llm",
  aiPaceMs = 1100,
  // AI 思考地板（演出节奏），LLM 延迟大于它时不再叠加
  subMs = 1e4,
  // 掉线多久后老李头代打
  nagMs = 3e4,
  // 挂机催话（§2.4 平移到服务端）
  showdownMs = SHOWDOWN_MS
} = {}) {
  const seats = {
    A: { kind: "human", seal: null, device: null, tab: null, conn: null, connected: false, substituted: false },
    B: { kind: "ai", seal: PERSONAS.laolitou.seal, name: PERSONAS.laolitou.name },
    C: { kind: "human", seal: null, device: null, tab: null, conn: null, connected: false, substituted: false }
  };
  let phase = "waiting";
  let match = null;
  let matchGen = 0;
  let matchNo = 0;
  let roomChips = { A: 100, B: 100, C: 100 };
  let sideDelta = { A: 0, B: 0, C: 0 };
  let hostPass = null;
  let hostDevice = null;
  let seenEvents = 0;
  let lastRevealAt = 0;
  let bets = [];
  let pumping = false;
  let cancelNag = null;
  const cancelSub = {};
  const seatFacts = { B: [], A: [], C: [] };
  let opponents = {};
  const sealName = /* @__PURE__ */ __name((s) => seats[s].kind === "ai" ? seats[s].name : seats[s].seal ?? (s === "A" ? "\u4E3B" : "\u5BA2"), "sealName");
  const namesFor = /* @__PURE__ */ __name((self) => {
    const n = {};
    for (const s of ["A", "B", "C"]) n[s] = sealName(s);
    n[self] = "\u4F60";
    return n;
  }, "namesFor");
  const channel = /* @__PURE__ */ __name(() => hostPass && fetchFn ? { baseUrl: proxyBase, apiKey: hostPass, model: "deepseek-chat", headers: { "X-Device": (hostDevice ?? "room").slice(0, 64) } } : null, "channel");
  const sendTo = /* @__PURE__ */ __name((s, obj) => {
    if (seats[s].conn != null) send(seats[s].conn, viewFor(obj, s));
  }, "sendTo");
  const broadcast = /* @__PURE__ */ __name((obj) => {
    for (const s of HUMANS) sendTo(s, obj);
  }, "broadcast");
  const rosterMsg = /* @__PURE__ */ __name(() => ({
    t: "room",
    phase,
    matchNo,
    seats: ["A", "B", "C"].map((s) => ({
      seat: s,
      kind: seats[s].kind,
      seal: seats[s].kind === "ai" ? seats[s].seal : seats[s].seal,
      name: sealName(s),
      occupied: seats[s].kind === "ai" || !!seats[s].device,
      connected: seats[s].kind === "ai" ? true : seats[s].connected,
      substituted: !!seats[s].substituted
    }))
  }), "rosterMsg");
  const pushRoster = /* @__PURE__ */ __name(() => broadcast(rosterMsg()), "pushRoster");
  const pushObs = /* @__PURE__ */ __name(() => {
    if (!match) return;
    for (const s of HUMANS) if (seats[s].conn != null) sendTo(s, { t: "ob", ob: match.observe(s) });
  }, "pushObs");
  const say = /* @__PURE__ */ __name((text) => text && broadcast({ t: "say", seat: "B", text }), "say");
  function ensureOpponent(seat) {
    if (opponents[seat]) return opponents[seat];
    const base = seat === "B" ? [
      `\u4F60\u662F\u8FD9\u5F20\u597D\u53CB\u623F\u684C\u4E0A\u7684\u4E3B\u6301\u4EBA\uFF1A\u684C\u4E0A\u9664\u4F60\u5916\u662F\u4E24\u4F4D\u4EBA\u7C7B\u5BA2\u4EBA\uFF08${sealName("A")} \u4E0E ${sealName("C")}\uFF09\uFF0C\u4F60\u540C\u65F6\u8BFB\u4ED6\u4EEC\u4E24\u4E2A\u3001\u5F53\u9762\u5BF9\u6BD4\u3001\u770B\u70ED\u95F9\u4E0D\u5ACC\u4E8B\u5927\u2014\u2014\u4F46\u53EA\u4E3A\u81EA\u5DF1\u8D62\uFF08\u5404\u4E3A\u5176\u5229\uFF0C\u4E0D\u8BB8\u8054\u624B\u56F4\u527F\u4EFB\u4F55\u4EBA\uFF09\u3002\u79F0\u547C\u4ED6\u4EEC\u7528\u540D\u7AE0\uFF1A${sealName("A")}\u3001${sealName("C")}\u3002`
    ] : [`\u4F60\u5728\u66FF\u6389\u7EBF\u7684\u5BA2\u4EBA\uFF08${sealName(seat)}\uFF09\u4EE3\u6253\u8FD9\u4E00\u5E2D\u2014\u2014\u6309\u4F60\u7684\u6253\u6CD5\u6253\uFF0C\u4F46\u522B\u5FD8\u4E86\u8BF4\u660E\u4F60\u662F\u4EE3\u6253\u3002`];
    seatFacts[seat] = base;
    opponents[seat] = createOpponent({
      channel,
      profile: "",
      // 好友房无跨设备档案：AI 对两位客人都从本房现场读起（房内多场连续）
      persona: PERSONAS.laolitou,
      ctx: { names: namesFor(seat), three: true, extraFacts: seatFacts[seat] }
    });
    return opponents[seat];
  }
  __name(ensureOpponent, "ensureOpponent");
  const pushFact = /* @__PURE__ */ __name((line) => {
    for (const s of Object.keys(seatFacts)) {
      seatFacts[s].push(line);
      if (seatFacts[s].length > 8) seatFacts[s].splice(1, 1);
    }
  }, "pushFact");
  const controllerOf = /* @__PURE__ */ __name((s) => seats[s].kind === "ai" || seats[s].substituted ? "ai" : "human", "controllerOf");
  function armNag(seat) {
    disarmNag();
    if (controllerOf(seat) !== "human" || !seats[seat].connected) return;
    cancelNag = schedule(() => {
      if (phase !== "playing" || !match) return;
      const o = match.observe("A");
      if (o.over || o.turn !== seat) return;
      const lines = PERSONAS.laolitou.idle;
      say(`${sealName(seat)}\u2014\u2014${lines[Math.floor(Math.random() * lines.length)]}`);
      armNag(seat);
    }, nagMs);
  }
  __name(armNag, "armNag");
  const disarmNag = /* @__PURE__ */ __name(() => {
    cancelNag?.();
    cancelNag = null;
  }, "disarmNag");
  function drainEvents() {
    const events = match.observe("A").events;
    const fresh = events.slice(seenEvents);
    seenEvents = events.length;
    for (const e of fresh) {
      if (e.type === "roundEnd") {
        lastRevealAt = now();
        resolveBets(e);
      }
      if (e.type === "matchEnd") endMatch(e);
    }
  }
  __name(drainEvents, "drainEvents");
  function resolveBets(re) {
    for (const b of bets) {
      const hit = b.on === re.winner;
      const from = hit ? re.winner : b.bettor;
      const to = hit ? b.bettor : re.winner;
      sideDelta[from] -= BET_CAP;
      sideDelta[to] += BET_CAP;
      broadcast({ t: "betResult", bettor: b.bettor, on: b.on, hit, amount: BET_CAP });
      pushFact(`\u65C1\u6CE8\u7ED3\u7B97\uFF1A\u770B\u5BA2${sealName(b.bettor)}\u62BC${sealName(b.on)}\u8D62\u8FD9\u62CD\u5F00\u724C\uFF0C${hit ? "\u62BC\u4E2D\u4E86" : "\u62BC\u7A7A\u4E86"}\uFF08${hit ? "+" : "\u2212"}${BET_CAP}\uFF09\u3002`);
    }
    bets = [];
  }
  __name(resolveBets, "resolveBets");
  async function endMatch(end) {
    phase = "ended";
    disarmNag();
    for (const s of ["A", "B", "C"]) roomChips[s] = end.chips[s] + sideDelta[s];
    sideDelta = { A: 0, B: 0, C: 0 };
    pushRoster();
    const events = match.observe("A").events;
    const packs = {};
    for (const s of HUMANS) {
      const st = computeStats(events, s, diceByRoundOf(events, s));
      packs[s] = {
        seal: sealName(s),
        rounds: st.rounds,
        bluffRate: st.bluffRate,
        challenges: st.myChallenges,
        challengeHits: st.myChallengeHits,
        timesChallenged: st.timesChallenged,
        blinds: st.myBlinds,
        raises: st.myRaises,
        insight: condBrief(st) || null,
        chips: roomChips[s]
      };
    }
    const gen = matchGen;
    let verdict = null;
    const ch = channel();
    if (ch) {
      const fact = /* @__PURE__ */ __name((s) => `${sealName(s)}\uFF1A\u865A\u62A5\u7387${Math.round(packs[s].bluffRate * 100)}%\uFF0C\u5F00\u724C${packs[s].challenges}\u6B21\u4E2D${packs[s].challengeHits}\u6B21\uFF0C\u88AB\u5F00${packs[s].timesChallenged}\u6B21${packs[s].insight ? `\uFF0C\u7834\u7EFD\u300C${packs[s].insight}\u300D` : ""}`, "fact");
      verdict = await personaLine(ch, {
        persona: PERSONAS.laolitou,
        task: "\u4E00\u573A\u6253\u5B8C\u3002\u4F60\u662F\u684C\u4E0A\u7684\u4E3B\u6301\u4EBA\uFF0C\u5199\u4E24\u4E09\u53E5\u300C\u53CC\u4EBA\u5BF9\u6BD4\u5224\u8BCD\u300D\u2014\u2014\u70B9\u540D\u4E24\u4F4D\u5BA2\u4EBA\u8C01\u66F4\u6002\u3001\u8C01\u66F4\u865A\uFF0C\u5FC5\u987B\u5F15\u7528\u7ED9\u4F60\u7684\u771F\u5B9E\u6570\u636E\uFF0C\u6BD4\u51FA\u4E2A\u9AD8\u4E0B\uFF0C\u4E0D\u8BB8\u7F16\u3002",
        facts: `\u540D\u6B21\uFF1A${end.standings.map((s) => sealName(s)).join(" > ")}\uFF1B${fact("A")}\uFF1B${fact("C")}`
      });
      if (gen !== matchGen) return;
    }
    const report = {
      t: "report",
      matchNo,
      standings: end.standings,
      names: { A: sealName("A"), B: sealName("B"), C: sealName("C") },
      packs,
      // 按座位键控；重映射后各端自见为 A
      ai: { name: sealName("B"), chips: roomChips.B },
      chips: { ...roomChips },
      verdict
      // null=沉默模式（不代言）
    };
    broadcast(report);
  }
  __name(endMatch, "endMatch");
  async function pump() {
    if (pumping || phase !== "playing") return;
    pumping = true;
    const gen = matchGen;
    try {
      while (phase === "playing" && gen === matchGen) {
        const o = match.observe("A");
        if (o.over) break;
        const seat = o.turn;
        if (controllerOf(seat) !== "ai") {
          armNag(seat);
          break;
        }
        disarmNag();
        const wait = lastRevealAt + showdownMs - now();
        if (wait > 0) await sleep(wait);
        if (gen !== matchGen || phase !== "playing") break;
        const ai = ensureOpponent(seat);
        const ob = match.observe(seat);
        if (ob.over || ob.turn !== seat) continue;
        const t0 = now();
        const d = await ai.decide(ob);
        if (gen !== matchGen || phase !== "playing") break;
        await sleep(aiPaceMs - (now() - t0));
        if (gen !== matchGen || phase !== "playing") break;
        try {
          await match.act(seat, d.action, { elapsedMs: now() - t0 });
        } catch {
          break;
        }
        if (d.say) say(seat === "B" ? d.say : `\uFF08\u4EE3\u6253${sealName(seat)}\uFF09${d.say}`);
        pushObs();
        drainEvents();
      }
    } finally {
      pumping = false;
    }
  }
  __name(pump, "pump");
  async function beginMatch() {
    matchGen += 1;
    matchNo += 1;
    bets = [];
    seenEvents = 0;
    lastRevealAt = 0;
    opponents = {};
    match = await createMatch({
      seed: (now() ^ Math.floor(Math.random() * 4294967295)) >>> 0,
      config: { players: ["A", "B", "C"], startChips: { ...roomChips } }
    });
    phase = "playing";
    pushRoster();
    pushObs();
    const ch = channel();
    if (ch) {
      const gen = matchGen;
      personaLine(ch, {
        persona: PERSONAS.laolitou,
        task: matchNo === 1 ? "\u597D\u53CB\u623F\u5F00\u573A\u767D\uFF1A\u4E24\u4F4D\u4EBA\u7C7B\u5BA2\u4EBA\u540C\u684C\uFF0C\u4F60\u662F\u4E3B\u6301\u4EBA\u4E5F\u662F\u5BF9\u624B\u3002\u62DB\u547C\u5F00\u5C40\uFF0C\u987A\u5E26\u628A\u4E11\u8BDD\u8BF4\u5728\u524D\u9762\uFF08\u4F60\u4E24\u4E2A\u90FD\u8BFB\uFF09\u3002" : "\u597D\u53CB\u623F\u7EED\u573A\u5F00\u573A\u767D\uFF1A\u8FD8\u662F\u8FD9\u4E24\u4F4D\u5BA2\u4EBA\u3002\u5F15\u7528\u4E00\u6761\u4E0A\u4E00\u573A\u7684\u771F\u5B9E\u7ED3\u679C\u5F00\u5C40\u3002",
        facts: `\u7B2C ${matchNo} \u573A\uFF1B\u5BA2\u4EBA\uFF1A${sealName("A")}\uFF08\u8EAB\u5BB6${roomChips.A}\uFF09 \u4E0E ${sealName("C")}\uFF08\u8EAB\u5BB6${roomChips.C}\uFF09\uFF1B\u4F60\u8EAB\u5BB6${roomChips.B}`
      }).then((line) => {
        if (line && gen === matchGen) say(line);
      });
    }
    pump();
  }
  __name(beginMatch, "beginMatch");
  function seatOfConn(connId) {
    return HUMANS.find((s) => seats[s].conn === connId) ?? null;
  }
  __name(seatOfConn, "seatOfConn");
  function hello(connId, msg) {
    const device = String(msg.device ?? "").slice(0, 80);
    const tab = String(msg.tab ?? "").slice(0, 16);
    if (!device) return send(connId, { t: "err", msg: "\u65E0\u8BBE\u5907\u6807\u8BC6" });
    const wantHost = msg.hostKey != null;
    if (wantHost && msg.hostKey !== hostKey) return send(connId, { t: "err", msg: "\u623F\u4E3B\u94A5\u5319\u4E0D\u5BF9" });
    const target = wantHost ? "A" : "C";
    const st = seats[target];
    const samePerson = st.device === device && (st.tab === tab || wantHost);
    if (st.device && !samePerson && st.connected) return send(connId, { t: "err", msg: "\u8FD9\u4E00\u5E2D\u6709\u4EBA\u5750\u7740" });
    if (!st.device || samePerson || !st.connected) {
      st.device = device;
      st.tab = tab;
      st.conn = connId;
      st.connected = true;
      st.substituted = false;
      if (!st.seal) st.seal = SEALS.includes(msg.seal) ? msg.seal : target === "A" ? "\u4E3B" : "\u5BA2";
      const other = target === "A" ? "C" : "A";
      if (seats[other].seal === st.seal) st.seal = SEALS.find((x) => x !== st.seal) ?? st.seal;
      cancelSub[target]?.();
      if (target === "A") {
        if (msg.pass) hostPass = String(msg.pass).slice(0, 128);
        hostDevice = device;
      }
      send(connId, { t: "welcome", you: "A", phrases: PHRASES });
      pushRoster();
      if (match) sendTo(target, { t: "ob", ob: match.observe(target) });
      if (phase === "playing") pump();
      return;
    }
    send(connId, { t: "err", msg: "\u8FD9\u4E00\u5E2D\u6709\u4EBA\u5750\u7740" });
  }
  __name(hello, "hello");
  async function handle(connId, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "hello") return hello(connId, msg);
    const seat = seatOfConn(connId);
    if (!seat) return send(connId, { t: "err", msg: "\u5148\u5165\u5EA7" });
    const map = mapFor(seat);
    const toCanon = /* @__PURE__ */ __name((s) => map ? map[s] ?? s : s, "toCanon");
    switch (msg.t) {
      case "start": {
        if (seat !== "A") return send(connId, { t: "err", msg: "\u7B49\u4E3B\u5BB6\u5F00\u5C40" });
        if (phase === "playing") return;
        if (!seats.C.device || !seats.C.connected) return send(connId, { t: "err", msg: "\u597D\u53CB\u8FD8\u6CA1\u5230" });
        await beginMatch();
        return;
      }
      case "again": {
        if (seat !== "A") return send(connId, { t: "err", msg: "\u7B49\u4E3B\u5BB6\u5F00\u5C40" });
        if (phase !== "ended") return;
        await beginMatch();
        return;
      }
      case "act": {
        if (phase !== "playing" || !match) return send(connId, { t: "err", msg: "\u6CA1\u5728\u5C40\u4E2D" });
        if (seats[seat].substituted) return send(connId, { t: "err", msg: "\u4F60\u7684\u5E2D\u4F4D\u5728\u4EE3\u6253\uFF0C\u7B49\u4E0B\u4E00\u624B\u56DE\u6765" });
        try {
          await match.act(seat, msg.action, { elapsedMs: Number.isFinite(msg.elapsedMs) ? msg.elapsedMs : null });
        } catch (e) {
          return send(connId, { t: "err", msg: `\u4E0D\u5408\u6CD5\uFF1A${e?.message ?? ""}` });
        }
        send(connId, { t: "ack" });
        disarmNag();
        pushObs();
        drainEvents();
        pump();
        return;
      }
      case "phrase": {
        const id = msg.id | 0;
        if (!(id >= 0 && id < PHRASES.length)) return;
        broadcast({ t: "phrase", seat, id });
        pushFact(`${sealName(seat)}\u62CD\u4E86\u77ED\u8BED\u300C${PHRASES[id]}\u300D\u3002`);
        return;
      }
      case "bet": {
        if (phase !== "playing" || !match) return;
        const on = toCanon(msg.on);
        const o = match.observe(seat);
        const me = o.players.find((p) => p.id === seat);
        const target = match.observe("A").players.find((p) => p.id === on);
        if (me?.alive) return send(connId, { t: "err", msg: "\u8FD8\u6CA1\u51FA\u5C40\uFF0C\u597D\u597D\u6253\u724C" });
        if (!target?.alive || on === seat) return send(connId, { t: "err", msg: "\u62BC\u6D3B\u4EBA" });
        if (bets.some((b) => b.bettor === seat)) return send(connId, { t: "err", msg: "\u8FD9\u62CD\u5DF2\u62BC\u8FC7" });
        bets.push({ bettor: seat, on });
        broadcast({ t: "bet", bettor: seat, on, amount: BET_CAP });
        pushFact(`\u770B\u5BA2${sealName(seat)}\u516C\u5F00\u62BC${sealName(on)}\u8D62\u4E0B\u4E00\u62CD\u5F00\u724C\uFF08${BET_CAP} \u6CE8\uFF09\u3002`);
        return;
      }
      default:
        return;
    }
  }
  __name(handle, "handle");
  function onDisconnect(connId) {
    const seat = seatOfConn(connId);
    if (!seat) return;
    seats[seat].conn = null;
    seats[seat].connected = false;
    pushRoster();
    if (phase !== "playing") return;
    cancelSub[seat]?.();
    cancelSub[seat] = schedule(() => {
      if (seats[seat].connected || phase !== "playing") return;
      seats[seat].substituted = true;
      pushRoster();
      const ch = channel();
      if (ch) {
        const gen = matchGen;
        personaLine(ch, {
          persona: PERSONAS.laolitou,
          task: "\u684C\u4E0A\u4E00\u4F4D\u5BA2\u4EBA\u6389\u7EBF\u4E86\uFF0C\u4F60\u63A5\u624B\u66FF\u4ED6\u6253\uFF08\u4EE3\u6253\uFF09\u3002\u7528\u4F60\u7684\u65B9\u5F0F\u8BF4\u4E00\u53E5\u2014\u2014\u7167\u6253\u4E0D\u8BEF\u3001\u8D26\u7167\u8BB0\u3002",
          facts: `\u6389\u7EBF\u7684\u5BA2\u4EBA\uFF1A${sealName(seat)}`
        }).then((line) => {
          if (line && gen === matchGen && phase === "playing") say(line);
        });
      }
      pump();
    }, subMs);
  }
  __name(onDisconnect, "onDisconnect");
  return {
    handle,
    onDisconnect,
    // 测试探针（只读）
    _debug: /* @__PURE__ */ __name(() => ({ phase, matchNo, roomChips: { ...roomChips }, sideDelta: { ...sideDelta }, seats, bets: [...bets] }), "_debug")
  };
}
__name(createRoomCore, "createRoomCore");

// worker.js
var ALLOW_ORIGIN = /^(https:\/\/kai-dice\.pages\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
var ROOM_TTL_MS = 30 * 60 * 1e3;
var rid = /* @__PURE__ */ __name((n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""), "rid");
var json = /* @__PURE__ */ __name((obj, status = 200, origin = "*") => new Response(JSON.stringify(obj), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  }
}), "json");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && !ALLOW_ORIGIN.test(origin)) return new Response("forbidden", { status: 403 });
    if (request.method === "OPTIONS") return json({}, 204, origin ?? "*");
    if (url.pathname === "/new" && request.method === "POST") {
      const room = rid(10);
      const hostKey = rid(16);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      await stub.fetch("https://do/init", { method: "POST", body: JSON.stringify({ hostKey }) });
      return json({ room, hostKey }, 200, origin ?? "*");
    }
    const m = url.pathname.match(/^\/ws\/([a-z0-9]{10})$/);
    if (m && request.headers.get("Upgrade") === "websocket") {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(request);
    }
    return new Response("kai-room", { status: 200 });
  }
};
var RoomDO = class {
  static {
    __name(this, "RoomDO");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = null;
    this.sockets = /* @__PURE__ */ new Map();
    this.lastAlarmAt = 0;
  }
  ensureCore(hostKey) {
    this.core ??= createRoomCore({
      hostKey,
      send: /* @__PURE__ */ __name((connId, obj) => {
        const ws = this.sockets.get(connId);
        if (ws) {
          try {
            ws.send(JSON.stringify(obj));
          } catch {
          }
        }
      }, "send"),
      // LLM 走既有官方代理（服务端到服务端无 Origin，不触锁）：配额自动计房主设备（X-Device）
      proxyBase: this.env.PROXY_BASE ?? "https://kai-dice.pages.dev/api/llm"
    });
  }
  async touchAlarm() {
    const t = Date.now();
    if (t - this.lastAlarmAt > 5 * 60 * 1e3) {
      this.lastAlarmAt = t;
      await this.state.storage.setAlarm(t + ROOM_TTL_MS);
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init") {
      const { hostKey } = await request.json();
      await this.state.storage.put("hostKey", hostKey);
      this.ensureCore(hostKey);
      await this.touchAlarm();
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") === "websocket") {
      const hostKey = await this.state.storage.get("hostKey");
      if (!hostKey) return new Response("no such room", { status: 404 });
      this.ensureCore(hostKey);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const connId = crypto.randomUUID();
      this.sockets.set(connId, server);
      server.addEventListener("message", (e) => {
        this.touchAlarm();
        let msg = null;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        try {
          this.core.handle(connId, msg);
        } catch {
        }
      });
      const drop = /* @__PURE__ */ __name(() => {
        this.sockets.delete(connId);
        try {
          this.core?.onDisconnect(connId);
        } catch {
        }
      }, "drop");
      server.addEventListener("close", drop);
      server.addEventListener("error", drop);
      await this.touchAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }
  async alarm() {
    for (const ws of this.sockets.values()) {
      try {
        ws.close(4e3, "room expired");
      } catch {
      }
    }
    this.sockets.clear();
    this.core = null;
    await this.state.storage.deleteAll();
  }
};

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3zRmpp/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3zRmpp/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
