# Codex vs. Claude Code at Liar's Dice: the Winning Bluff Was the Truth

### One authoritative engine, two seat-locked MCP servers, three best-of-threes, and a 3-millisecond whodunit

> The matches are real: Codex CLI (`gpt-5.6-sol`) against Claude Code (Claude Opus 5), both playing through the same rules engine. Every number below was recomputed from the raw `run.json` and both session logs, and every game replays deterministically from its seed. Quotes from the agents are verbatim from decision-time records. None of this is a general model ranking.

I wired Codex CLI and Claude Code into the same Liar's Dice engine over MCP and had them play three best-of-3 series. Claude won all three, 2–0 each time. Its challenge calls hit 8 out of 11; Codex's hit 4 out of 26.

The score takes two sentences. The parts worth writing down took longer: how to build a table that two closed-source agents can't cheat at, two numbers that surprised me, and an incident where I almost blamed a model for something its CLI did.

## The table

Liar's Dice in sixty seconds: five dice each, and you only see your own. Players alternate bids of the form "there are at least N dice showing X across the whole table." On your turn you either raise the bid or challenge it. On a challenge everyone reveals; if the bid stands, the challenger loses a die, otherwise the bidder does. Run out of dice and you lose the match. Ones are wild by default.

The rules are the easy part. The hard part is making the result trustworthy. Codex and Claude Code ship with their own system prompts and tool loops, so the referee has to guarantee three things by construction: neither side can see the other's dice, the referee has no side channel that favors anyone, and the "what it was thinking" quotes you read afterward were actually written at decision time.

The setup is one in-process rules engine behind a localhost-only HTTP coordinator, with two stdio MCP servers doing nothing but forwarding:

```text
 Codex CLI (gpt-5.6-sol)       Claude Code (Opus 5)
       |  stdio MCP                 |  stdio MCP
       v                            v
  [seat-mcp A] --token A--+  +--token B-- [seat-mcp B]
                          |  |
                          v  v
              +------------------------+
              | coordinator @127.0.0.1 |
              |  - createMatch engine  |
              |  - stateId concurrency |
              |  - run.json audit log  |
              +-----------+------------+
                          | SSE
                          v
                    [ /spectate ]
```

The load-bearing decisions:

- **Tokens bind to seats at process start.** The tool schema has no `seat` parameter. A client that wanted to impersonate its opponent would have nowhere to type that.
- **Information hiding lives in the schema.** A seat's view reuses the game's `observe()` projection, and that JSON has no field for opponent dice. Removing the field beats writing "please don't peek" in a prompt.
- **Actions use optimistic concurrency.** Every observation carries a `stateId`; submit against a stale one and you get a 409. Concurrent peeks produce a handful of these per run (0–7), all preserved in the rejection log.
- **Thinking is recorded at act time.** Every action must include a private `belief` and may include one public `say`. The belief commits atomically with the action; the opponent never sees it and nobody can rewrite it afterward. Every quote below comes from there.
- **Latency is coarsened.** Raw milliseconds go only to the audit file; seats and spectators see "fast" or "slow." Without this, response time is a usable side channel.
- **Dice go through commit-reveal.** Each round opens by publishing hashes of both hands, and the reveal has to match them. The referee couldn't quietly reroll dice if it wanted to.
- **A challenge carries its meaning.** Challenges must include `assert: "current_bid_is_false"` or they're rejected. This came out of an earlier replay study: for one model, turning "challenge" from a bare verb into an assertion it has to type out cut guaranteed-loss challenges from 23% to 2%. Tool schemas change behavior, and that one is measured.

Both seats receive word-for-word identical instructions and the identical task prompt, each running in an isolated temp directory with user config ignored. One session plays the entire series, so cross-game memory is part of what's being tested. What I can't control is each CLI's internal prompting and scheduling, which is why the contestants are, and stay, two systems: Codex+Sol and Claude Code+Opus. Every claim here is scoped to that.

## Why trust the numbers

After the runs I did four checks:

- **Deterministic replay.** The engine is a pure function of seed and action sequence. A verifier takes each run's seed plus its accepted actions, replays all events, and diffs them item by item against the archive. Five runs, 8 games, 432 events: all identical, timing fields included.
- **Every rejection is logged**, with the raw action and a timestamp. Illegal actions never touch the game state, but they never vanish from the record either. Section five leans on this.
- **Model identity comes from receipts.** Every Claude gameplay response reports `claude-opus-5`; tokens, cost, and cache reads for both sides are archived.
- **Directories are frozen** with SHA-256 manifests.

The workflow:

```bash
# one continuous-session BO3; the mirror run just flips --codex-seat
node scripts/mcp/run-showdown.mjs --best-of 3 --seed 73019426 \
  --codex-seat A --codex-model gpt-5.6-sol --claude-model opus

# verify later: replay all events from seed + actions, diff against archive
node scripts/mcp/replay-showdown.mjs docs/showdown/<run-dir>
```

## Results

| Run | Setup | Series | Sol challenges | Opus challenges |
|---|---|---|---|---|
| E0 | Sol in seat A, continuous session | Opus 2–0 | 0/8 | 2/4 |
| E1 | same setup, fresh seeds | Opus 2–0 | 2/10 | 2/2 |
| E2 | E0's seeds, **agents swap seats** | Opus 2–0 | 2/8 | 4/5 |

E2 is the control that matters. It reuses E0's seeds exactly and only swaps which agent sits where. All four paired games followed Opus rather than the seat, which crosses off "seat A is better," "going second is better," and "that seat got luckier dice." To be precise about what the mirror controls: the random stream is anchored per seat, so round-one hands match the original run die for die, and later rounds drift as dice counts diverge.

Then there's the stat that made me stop. Across the three series, when Codex challenged one of Claude's bids, the bid was true 22 times out of 26. When Claude challenged Codex, the bid was false 8 times out of 11. In a bluffing game, the side doing most of the truth-telling was the one running the traps.

## Where Sol lost

Sol's strategy reads straight out of its own logs: peek; open on your longest suit at "own count + 1"; when a bid comes in, compute a binomial probability that it stands; challenge below a threshold. Clean, stable, locally correct at every step.

The flaw is in what the computation assumes about the opponent. It answers: if the opponent's dice were uniformly random, how likely is this bid to stand? But the opponent's bids aren't random draws. Opus only pushed a count high when its own hand already covered most of it, so the fact that Opus chose that bid carries information. Sol's formula has no term for that, and it kept converting correct arithmetic into wrong decisions.

Opus worked the gap methodically. During game one it decoded Sol's openings ("longest suit + 1" amounts to announcing your hand). Then it learned Sol's challenge threshold. Then it started manufacturing bids that look suspicious under the random assumption and happen to be true. The worst stretch ran three consecutive rounds: a true bid placed right at the edge of standing, a challenge, a lost die, three times over. In the middle of it Opus said, publicly: "Three fives. You skipped past my fives twice now instead of testing them — I don't think that's an accident." A true statement about a true bid. Sol challenged anyway.

Opus wasn't reading hidden dice, and it wasn't infallible. It challenged one of Sol's borderline-true bids and paid a die for it. Its opponent model was wrong now and then; it kept updating regardless.

The cross-game gap is visible in the logs too. Counting explicit references to game one inside game-two decision records: Opus made 5, 2, and 3 across the three series. Sol made zero in all three. Both sides had the same continuous session. One of them used it.

## The 1,093-call whodunit

The mirror run had an incident. In two opening states Sol submitted a bid with count 1 — the floor is 2, in both the rules and the tool schema — and after the rejection it submitted the same action again. And again: 1,093 times across the two states.

My first reading was "the model is melting down." The rejection log says otherwise. Pull the timestamps and 601 of those rejections land inside 22 seconds, median gap 3ms; the other 492 land inside 12 seconds, also 3ms. A model forward pass takes hundreds of milliseconds at best, so nothing was deciding forty times a second. That cadence is a retry loop. The independent-seed series provides the cross-check: the same count-1 mistake appeared there exactly once, got rejected once, and was corrected on the next call. So the ledger splits: writing an illegal bid was the model's error; repeating it six hundred times was the CLI's retry machinery.

Without per-rejection logging, the aggregate line "Sol submitted 1,093 illegal actions" would have read as model behavior, and it would have made great copy about a panicking AI. I've been burned by this category before — [my earlier piece on harness-vs-model attribution](https://dev.to/haoxiang_li_a709204042e6b/are-you-benchmarking-the-model-or-the-harness-2bke) came out of four bugs that had all been masquerading as model personality. The question worth running before any "the model is X" claim: swap only the harness — does the behavior survive?

The incident also exposed a debt in my coordinator. It needs a circuit breaker: collapse repeated identical rejections, back off, flag the sample as contaminated. It held up under six hundred hits this time. It shouldn't have to next time.

## The ledger

**Two systems played, and the biggest confound is compute.** Opus generated about 300k output tokens across the three series; Sol generated 19k. That is a 16x gap, $17.63 in receipts on the Claude side. How much of the win is better conditioning and how much is simply more thinking, I can't separate yet.

**The sample is small.** Six games across three series, and the two games inside a series aren't independent, because cross-game memory is the mechanism under test.

**One line points the other way.** The very first match I ran used Codex's default model — not Sol, no best-of-3 — and it was close: 5–4 in rounds. Every blowout happened under the combination "fixed strategy × continuous session," which reads like the gap was learned during play rather than innate. That's a testable claim, not a conclusion.

The experiment queue, in order: restart sessions every game (how much of the edge is cross-game memory), mute table talk (separate action signals from speech), equalize compute budgets, and replay pivotal states repeatedly (stable strategy or sampling luck). Each one attacks a specific sentence above.

## Closing

Benchmark problems hand the model every premise and grade the answer. A table adds an opponent who adapts, and who rewrites your problem while you solve it. Sol spent the series solving probability exercises. Opus spent it asking why this bid, and what should I let him see next. They weren't playing the same game.

My favorite part is still those three rounds: one player told the truth three times in a row, and the other never once believed it.

---

*The full system (authoritative coordinator, seat-locked MCP servers, live spectator page), the mechanical analyzer, the replay verifier, and the complete raw archives of all five runs are open source: [github.com/hxli2005/kai-dice](https://github.com/hxli2005/kai-dice). The evidence lives under `docs/showdown/`, and every game replays offline with `node scripts/mcp/replay-showdown.mjs <run-dir>`.*

*This article was translated into English with AI assistance.*
