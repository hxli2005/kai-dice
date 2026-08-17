# Codex vs Claude Code：大话骰 MCP 对局

一个权威对局协调器，两个固定席位的 stdio MCP。每个 Agent Session 贯穿整场比赛（含全部小局），没有跨场画像或额外记忆工具；双方可以在每个动作上附一条公开发言。

## 一键真实对局

本机已登录 Codex CLI 与 Claude Code 时：

```bash
node scripts/mcp/run-showdown.mjs --seed 20260817
```

同一个 Codex / Claude Session 连续打一组 BO3：

```bash
node scripts/mcp/run-showdown.mjs \
  --best-of 3 \
  --seed 20260817 \
  --codex-seat A \
  --codex-model gpt-5.6-sol \
  --claude-model opus
```

系列赛每场使用连续新种子，并在 A／B 之间轮换首手；先到两胜即止。公开事件、台词和当手留档跨场保留在同一 Session 内，但不注入画像或额外记忆。

`--codex-seat A|B` 把 Codex 固定到指定席位（默认 `A`），Claude Code 自动绑定另一席。要在同一引擎种子和席位序列下做 Agent 换席镜像，第二次使用相同 `--seed` 与 `--best-of`，只把参数改为 `--codex-seat B`。席位 MCP 令牌、直播名称、元数据和摘要都会跟随这个映射。

命令启动后会先输出：

```text
LIVE http://127.0.0.1:<port>/spectate
```

用本机浏览器打开即可实时观战。直播页默认只显示公开动作、骰面、报价与台词；顶部可以分别开启 Codex / Claude Code 的行动当时 `belief` 与 `note`。它们是可审计留档，不是模型隐藏思维链。页面和 SSE 只绑定本机协调器，协调器退出后直播结束，最终证据仍写入 `run.json`。

可选参数：

```bash
node scripts/mcp/run-showdown.mjs \
  --seed 7 \
  --codex-seat B \
  --timeout-minutes 30 \
  --codex-model gpt-5.6-sol \
  --claude-model opus \
  --out docs/showdown/my-run
```

产物包括：

- `run.json`：引擎事件、公开发言、双方当手留档与胜负；
- `codex.jsonl` / `claude.jsonl`：两个真实 Session 的原始运行日志；
- `metadata.json`：命令、版本入口、退出状态与验收结果。
- `summary.md`：可直接阅读的小局结果摘要。

## 你 vs Claude Code

让浏览器中的你控制一席、Claude Code 控制另一席：

```bash
node scripts/mcp/run-human-vs-claude.mjs \
  --best-of 3 \
  --human-seat A \
  --claude-model opus
```

命令会输出一个带本席临时凭证的本机链接：

```text
PLAY http://127.0.0.1:<port>/play#seat=A&token=...
```

浏览器打开后可看自己的骰子、报价、开牌、宣盲／斋／抬，并附一句桌上发言；「桌上对话」保留双方完整发言流水，右上角可在中文与 English 界面间即时切换，双方原话不做赛后翻译。Claude 仍通过固定席位 MCP 行动。为避免玩家从观战页偷看 Claude 暗骰，人机模式不开放 `/spectate`；完整事件、Claude 原始日志、metadata 与摘要仍会写入输出目录。

可选参数包括 `--seed`、`--best-of`、`--human-seat A|B`、`--claude-model`、`--timeout-minutes` 和 `--out`。默认随机种子、单场、Human=A、Claude=`opus`、等待两小时。

## 手工启动

先开权威协调器：

```bash
node scripts/mcp/coordinator.mjs --seed 7 --out /tmp/liars-run.json
```

它会输出协调器 URL、私有直播 URL 与 A/B 席令牌。两个 Agent 分别连接同一 URL，但使用不同席位令牌；`seat-server.mjs` 的工具面完全相同，席位不出现在工具参数中，因此客户端无法切换身份。
