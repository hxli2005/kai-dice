# Kai · Human vs your own Codex

Requirements:

- Node.js 20 or newer
- Codex CLI installed and signed in

Run the package URL shown on the official Kai website. It starts a local-only referee, connects your own Codex through a seat-scoped MCP server, and opens the human play surface in your default browser.

Your Codex login, model usage, hidden dice, and match records stay on your computer. Records are written to `kai-liars-records/` under the directory where you start the command.

Options:

```text
--best-of N
--human-seat A|B
--codex-model MODEL_ID
--seed N
--out DIRECTORY
--timeout-minutes N
--no-open
```
