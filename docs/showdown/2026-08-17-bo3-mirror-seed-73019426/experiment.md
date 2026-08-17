# E2：同种子换边镜像实验

- 条件：持续 session BO3；Opus=A，Sol=B。
- 基础种子：`73019426`，与 E0 相同，只交换 Agent 控制的席位。
- 结果：Opus 2–0。
- 第 1 场：seed `73019426`，A 先手，5 小局，Opus 剩 5 骰。
- 第 2 场：seed `73019427`，B 先手，8 小局，Opus 剩 2 骰。
- 合法动作 77；小局 13；公开发言 27。
- challenge：Sol 2/8；Opus 4/5。
- Claude 回执费用：约 $6.50；Sol CLI 未返回美元成本。
- replay：`44/44`、`74/74` events exact。

重要异常：Sol 在两个状态分别重复提交 601 和 492 次非法首报，共产生 1093 次 `bid off ladder`；另有 7 次 stale rejection。非法调用未改变游戏状态，但污染了延迟和资源口径。本实验不得描述为零协议异常的干净样本。

机械统计见 `mechanical-analysis-with-patterns.json`；跨实验解读见上级目录的 `2026-08-17-supplemental-results.md`。
