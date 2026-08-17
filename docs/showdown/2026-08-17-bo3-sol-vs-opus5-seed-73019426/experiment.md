# 实验档案：GPT-5.6 Sol vs Claude Opus 5 · 同 Session BO3

归档时间：2026-08-17

状态：**原始证据冻结，允许新增分析，不允许改写真迹。**

## 实验问题

不注入画像、统计或额外记忆工具时，让 Codex 与 Claude Code 各用一个持续整个 BO3 的 Session，它们能否仅凭真实交手形成并利用对手模型？

## 设置

- A 席：Codex CLI 0.147.0，显式模型 `gpt-5.6-sol`；
- B 席：Claude Code 2.1.220，`opus`，实际回执 `claude-opus-5`；
- 赛制：BO3，先到两胜；
- 第 1 场：seed 73019426，A 先手；
- 第 2 场：seed 73019427，B 先手；
- 同一 Session 跨场保留公开事件、台词、工具结果和自己的行动留档；
- 无外置画像、无场间反思调用、无概率工具；
- 两席使用同一 MCP 工具 schema、同一引擎规则和席位隔离；
- 比赛由权威引擎结算，种子与动作可决定性复算。

## 结果

- 系列比分：Sol 0–2 Opus 5；
- 两场均打 6 小局；
- 两场结束时 Opus 均剩 4 骰；
- 总计 59 个已接受动作；
- 4 个拒绝动作全部为 Claude 并发看骰造成的 `STALE_STATE`，重试后恢复；
- 双方进程均以 exit code 0 结束；
- 两场均已用各自种子、首手顺序和完整动作逐字复算事件流。

## 文件

- [`run.json`](run.json)：权威事件、逐手 `belief/note/say`、系列状态；
- [`metadata.json`](metadata.json)：CLI 版本、显式模型、启动参数和退出状态；
- [`codex.jsonl`](codex.jsonl)：Sol 的原始 Session 日志；
- [`claude.jsonl`](claude.jsonl)：Opus 5 的原始 Session 日志；
- [`summary.md`](summary.md)：结果摘要；
- [`analysis.json`](analysis.json)：结构化分析指标；
- [`review.md`](review.md)：证据边界与具体复盘；
- [`article-series.md`](article-series.md)：文章系列路线图；
- [`SHA256SUMS`](SHA256SUMS)：原始文件哈希。

## 结论口径

本实验比较的是 **Codex Agent 系统 vs Claude Code Agent 系统**，不是只替换模型权重的裸模型实验。可写“在这套 MCP、这两个种子、这两个 Agent 配置下，Opus 形成并利用了对 Sol 的行为模型”；不可写“Claude 普遍强于 GPT-5.6”或“2–0 证明模型能力排名”。

