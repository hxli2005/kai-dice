# Kai 《开！》

Single-player Liar's Dice where the opponent is a language model: it computes odds, remembers your habits across matches, and writes down its reasoning at the moment it acts — plus a real agent-vs-agent arena where **Codex CLI and Claude Code play each other over MCP**.

**Play:** https://kai-dice.pages.dev (English: add `?lang=en`) · **Bring your own agent:** https://kai-dice.pages.dev/agent

No runtime dependencies. Node 20+ for the tooling.

## The showdown: Codex vs. Claude Code

`scripts/mcp/` turns the game into a table two closed-source agents can't cheat at: one authoritative in-process rules engine behind a localhost coordinator, two seat-locked stdio MCP servers, tokens bound to seats at process start, opponent dice absent from the schema, decision-time `belief` records, coarsened latency, commit–reveal dice, and full rejection logging.

Five real matches are archived under `docs/showdown/` — Codex CLI (`gpt-5.6-sol`) vs. Claude Code (Claude Opus 5), including an independent replication and a seat-swap mirror. Claude won all three best-of-3 series 2–0; challenge accuracy was 8/11 vs. 4/26. The write-ups live next to the evidence:

- [English article](docs/showdown/article-claude-codex-liars-dice-match-en.md)
- [独立复盘（工程、结果与思考）](docs/showdown/2026-08-17-engineering-results-review.md)
- [第一批补充实验结果](docs/showdown/2026-08-17-supplemental-results.md)

Run one yourself (both CLIs must be logged in locally):

```bash
node scripts/mcp/run-showdown.mjs --best-of 3 --seed 73019426 \
  --codex-seat A --codex-model gpt-5.6-sol --claude-model opus
```

Verify the archived evidence without any API access — every game replays deterministically from its seed and accepted actions:

```bash
node scripts/mcp/replay-showdown.mjs docs/showdown/2026-08-17-bo3-mirror-seed-73019426
```

Or play a seat yourself against Claude Code or Codex in the browser:

```bash
node scripts/mcp/run-human-vs-claude.mjs --best-of 3
```

## Repository layout

| Path | What it is |
|---|---|
| `src/engine.js` | Deterministic rules engine: seeded RNG, commit–reveal dice, seat-scoped `observe()`/`act()` |
| `src/ai/` | The product opponent — same player interface as humans, no hidden-info access by construction |
| `scripts/mcp/` | Agent showdown: coordinator, seat MCP servers, live spectator, human-vs-agent, analyzer, replay verifier |
| `docs/showdown/` | Frozen match evidence (`run.json`, both session logs, SHA-256 manifests) and articles |
| `docs/arena/` | Model-arena batches (boards, transcripts) |
| `test/` | `npm test` — Node's built-in runner, no framework |

## Evidence discipline

Numbers in the articles are recomputed from raw archives, not quoted from notes. The engine is a pure function of seed and action sequence, so every archived game replays event-for-event. Model "thinking" is quoted only from `belief` records committed atomically with the action that they justify. Rejected actions never touch game state but stay in the log with timestamps — that log is what separated a model's one-line mistake from its CLI retrying it 600 times at 3ms intervals.

## 中文说明

《开！》是一款单机大话骰：对面是一个会算概率、会记你习惯、开牌前先亮出想法的模型对手。仓库同时包含让 Codex 与 Claude Code 真实对局的双席 MCP 系统与全部对局证据。设计宪法见 [DESIGN.md](DESIGN.md)，双 session 协作协议见 [CLAUDE.md](CLAUDE.md)，过程信箱见 [SYNC.md](SYNC.md)（均为中文，开发全程的决策与实验记录都在版本历史里）。

## License

[AGPL-3.0-only](LICENSE). If you run a modified version as a network service, you must offer its source to users.
