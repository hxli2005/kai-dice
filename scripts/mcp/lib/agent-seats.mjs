const SEATS = new Set(['A', 'B']);

export const AGENT_NAMES = Object.freeze({
  codex: 'Codex',
  claude: 'Claude Code',
});

export function resolveAgentSeats(codexSeat = 'A') {
  const normalized = String(codexSeat ?? '').toUpperCase();
  if (!SEATS.has(normalized)) throw new Error('--codex-seat must be A or B');
  const claudeSeat = normalized === 'A' ? 'B' : 'A';
  return {
    codex: normalized,
    claude: claudeSeat,
    bySeat: { [normalized]: 'codex', [claudeSeat]: 'claude' },
  };
}

export function labelsForAgentSeats(agentSeats, { codexModel, claudeModel } = {}) {
  return {
    [agentSeats.codex]: codexModel ? `Codex · ${codexModel}` : AGENT_NAMES.codex,
    [agentSeats.claude]: claudeModel ? `Claude Code · ${claudeModel}` : AGENT_NAMES.claude,
  };
}

export function mcpArgsForAgent(agent, agentSeats, { seatServer, coordinator, tokens }) {
  if (!['codex', 'claude'].includes(agent)) throw new Error(`unknown agent ${agent}`);
  const seat = agentSeats[agent];
  return [seatServer, '--seat', seat, '--coordinator', coordinator, '--token', tokens[seat]];
}

export function summarizeAgentResult(snapshot, agentSeats) {
  const seatScore = snapshot.series?.wins ?? {
    A: snapshot.winner === 'A' ? 1 : 0,
    B: snapshot.winner === 'B' ? 1 : 0,
  };
  const actionCount = { A: 0, B: 0 };
  for (const decision of snapshot.decisions ?? []) actionCount[decision.seat] += 1;
  const winnerAgent = agentSeats.bySeat[snapshot.winner] ?? null;
  return {
    winnerSeat: snapshot.winner ?? null,
    winnerAgent,
    winnerName: winnerAgent ? AGENT_NAMES[winnerAgent] : '—',
    score: {
      codex: seatScore[agentSeats.codex] ?? 0,
      claude: seatScore[agentSeats.claude] ?? 0,
    },
    actions: {
      codex: actionCount[agentSeats.codex] ?? 0,
      claude: actionCount[agentSeats.claude] ?? 0,
    },
  };
}

export function renderSummary(snapshot, metadata, agentSeats) {
  const rounds = snapshot.events.filter((event) => event.type === 'roundEnd');
  const result = summarizeAgentResult(snapshot, agentSeats);
  const nameForSeat = (seat) => AGENT_NAMES[agentSeats.bySeat[seat]] ?? seat ?? '—';
  const roundRows = rounds.map((round) =>
    `| ${round.game ?? 1} | ${round.round} | ${nameForSeat(round.winner)} | ${nameForSeat(round.loser)} | ${round.diceCount[agentSeats.codex]}–${round.diceCount[agentSeats.claude]} |`,
  );
  return `# Codex vs Claude Code · 大话骰真实${snapshot.bestOf > 1 ? ` BO${snapshot.bestOf} 系列赛` : '对局'}\n\n` +
    `- 种子：${snapshot.seed}\n` +
    `- 席位：Codex ${agentSeats.codex} 席 / Claude Code ${agentSeats.claude} 席\n` +
    `- 系列比分：Codex ${result.score.codex}–${result.score.claude} Claude Code\n` +
    `- 胜者：**${result.winnerName}（${result.winnerSeat ?? '—'} 席）**\n` +
    `- 完整场：${snapshot.series?.completedGames?.length ?? 1}；小局：${rounds.length}\n` +
    `- 已接受动作：${snapshot.decisions.length}（Codex ${result.actions.codex} / Claude Code ${result.actions.claude}）\n` +
    `- 公开发言：${snapshot.dialogue.length}\n` +
    `- 拒绝动作：${snapshot.rejections?.length ?? 0}\n` +
    `- CLI：Codex ${metadata.versions.codex ?? 'unknown'} / Claude Code ${metadata.versions.claude ?? 'unknown'}\n\n` +
    `| 场 | 小局 | 胜者 | 败者 | 剩余骰 Codex–Claude |\n|---:|---:|---|---|---:|\n${roundRows.join('\n')}\n\n` +
    `完整证据见 \`run.json\`、\`codex.jsonl\` 与 \`claude.jsonl\`。\n`;
}
