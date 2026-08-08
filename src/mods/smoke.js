// 冒烟自对弈（Q39 第四道门）：带词条随机 bot 快打 N 场，抓死局/崩溃/不终局/守恒破坏。
// 引擎零依赖纯 JS——浏览器与 node 测试共用本模块。运行期无 LLM（沉默 bot 级随机合法行棋）。

import { createMatch, mulberry32 } from '../engine.js';
import { allLegalBids } from '../rules.js';

// 一场随机合法自对弈；返回事件流。actions 供回放测试复用。
export async function selfPlayMods(seed, { players = ['A', 'B'], mods = [], startDice } = {}) {
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const m = await createMatch({ seed, config: { players, mods, ...(startDice ? { startDice } : {}) } });
  const actions = [];
  for (let step = 0; step < 30_000; step++) {
    const obs = players.map((p) => m.observe(p));
    const actor =
      obs.find((o) => o.legal.some((a) => a.type !== 'peek')) ?? obs.find((o) => o.legal.length > 0);
    if (!actor) break;
    let a = pick(actor.legal);
    if (a.type === 'bid') {
      const bids = allLegalBids(actor.currentBid, actor.zhai, actor.diceCount.you + actor.diceCount.opp);
      a = { type: 'bid', ...pick(bids) };
    } else {
      // 词条参数：params='face' 的动作随机亮自己一颗（窗口保证已看骰）
      const meta = actor.mods?.flatMap((x) => x.actions).find((x) => x.type === a.type);
      if (meta?.params === 'face') a = { type: a.type, face: pick(actor.yourDice) };
    }
    await m.act(actor.you, a);
    actions.push({ p: actor.you, a });
  }
  const final = m.observe(players[0]);
  if (!final.over) throw new Error('对局未终止（可能死局）');
  return { events: final.events, actions };
}

// 不变量校验：终止、筹码守恒、转移零和、骰数增减合法（掐对+1 有上限、其余每局-1）
export function checkInvariants(events, { players, startDice = 5, startChips = 100 } = {}) {
  const chipSum = players.length * startChips;
  let prevDiceTotal = players.length * startDice;
  for (const e of events) {
    if (e.type === 'roundEnd') {
      const sum = Object.values(e.transfers).reduce((a, b) => a + b, 0);
      if (sum !== 0) throw new Error(`第${e.round}局转移不零和（${sum}）`);
      const cs = Object.values(e.chips).reduce((a, b) => a + b, 0);
      if (cs !== chipSum) throw new Error(`第${e.round}局筹码不守恒（${cs}≠${chipSum}）`);
      const total = Object.values(e.diceCount).reduce((a, b) => a + b, 0);
      const delta = total - prevDiceTotal;
      if (e.calza && e.exact) {
        if (delta !== 1 && delta !== 0) throw new Error(`第${e.round}局掐对骰数异动（${delta}）`);
      } else if (delta !== -1) {
        throw new Error(`第${e.round}局骰数异动（${delta}）`);
      }
      for (const n of Object.values(e.diceCount))
        if (n < 0 || n > startDice) throw new Error(`第${e.round}局骰数越界（${n}）`);
      prevDiceTotal = total;
    }
  }
  if (events.at(-1)?.type !== 'matchEnd') throw new Error('事件流未以 matchEnd 收尾');
}

// 跑一批：默认 200 场（Q39 口径）。onProgress 供浏览器渲染进度（内部让出事件循环）。
export async function smokeMods(mods, { games = 200, players = ['A', 'B'], seed0 = 1, onProgress } = {}) {
  const errors = [];
  let uses = 0;
  let rounds = 0;
  for (let g = 0; g < games; g++) {
    const seed = seed0 + g;
    try {
      const { events } = await selfPlayMods(seed, { players, mods });
      uses += events.filter((e) => e.type === 'modAction').length;
      rounds += events.at(-1)?.rounds ?? 0;
      checkInvariants(events, { players });
    } catch (err) {
      errors.push(`seed ${seed}: ${err.message}`);
      if (errors.length >= 5) break; // 五个样本足够定性，别刷屏
    }
    if (onProgress && g % 20 === 19) {
      onProgress(g + 1, games);
      await new Promise((r) => setTimeout(r)); // 让出事件循环，UI 不冻结
    }
  }
  return {
    ok: errors.length === 0,
    games,
    errors,
    uses, // 词条动作实际被行使的次数——0 说明窗口永远打不开，也算病
    avgRounds: games ? +(rounds / games).toFixed(1) : 0,
  };
}
