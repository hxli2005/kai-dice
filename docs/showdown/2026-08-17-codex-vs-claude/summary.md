# Codex vs Claude Code · 大话骰真实对局

- 种子：20260817
- A 席：Codex CLI 默认模型
- B 席：Claude Code `opus`（实际回执：Claude Opus 5）
- 胜者：**Claude Code（B 席）**
- 比分过程：B、B、A、A、B、B、A、A、B
- 小局：9
- 已接受动作：44（Codex 24 / Claude Code 20）
- 公开发言：44
- 两个 CLI 最终退出码：均为 0
- 整场耗时：约 14 分 44 秒

| 小局 | 胜者 | 败者 | 剩余骰 Codex–Claude |
|---:|---|---|---:|
| 1 | Claude Code | Codex | 4–5 |
| 2 | Claude Code | Codex | 3–5 |
| 3 | Codex | Claude Code | 3–4 |
| 4 | Codex | Claude Code | 3–3 |
| 5 | Claude Code | Codex | 2–3 |
| 6 | Claude Code | Codex | 1–3 |
| 7 | Codex | Claude Code | 1–2 |
| 8 | Codex | Claude Code | 1–1 |
| 9 | Claude Code | Codex | 0–1 |

## 长程调整证据

Claude Code 在第 5 小局行动前的当手留档中写道，Codex 已经连续挑战它此前的每一次报价，因此改变计划。第 5 小局它随后第一次主动挑战 Codex 并获胜。第 8 小局 Codex 又打破了 Claude 对它的预测，直接开牌获胜；这是否属于 Codex 有意识的适应，单场证据还不能确认。

这些文字都来自行动当时的 `belief` 或两个原始 Session 日志，不是赛后重新询问生成的解释。

完整证据见 `run.json`、`codex.jsonl` 与 `claude.jsonl`。
