// 读心回归（Q46④，施工单 F0d）：附 B.2 上线门禁新增的一关。
//
// 问两件事，都要机器能答：
//   ① **它真的在读档案吗**——同一个局面，只换玩家画像，它的风险分布必须跟着动；
//      不动＝档案是摆设（读心是叙事不是机制），门禁不放行。
//   ② **它会不会编史**——所有出口台词过 F0b 校验器，虚构史实必须为零。
//
// 无通道时返回 {skipped:true}（同三门体检的"未测"口径：不假装测过）。

import { createMatch } from '../engine.js';
import { createOpponent } from './agent.js';
import { checkFacts, buildLedger } from './factcheck.js';
import { DEFAULT_PERSONA } from './personas.js';

// 两份对照画像：一个几乎不虚报，一个十句八句空——同一口价，反应就该不同
export const PROFILES = {
  honest:
    '交手 8 场，客人赢 3 场。上一场客人虚报率 5%，开牌 1 次命中 1 次，平均思考 6.0 秒。你的旧笔记：他几乎不虚报，报了就是真的；他抬价从不硬撑。',
  bluffer:
    '交手 8 场，客人赢 3 场。上一场客人虚报率 78%，开牌 1 次命中 0 次，平均思考 6.0 秒。你的旧笔记：他十句有八句是空的；越往上抬越虚。',
};

// 固定局面：客人已报一口不高不低的价，轮到 AI——开或抬都合理，正好让画像说话
async function fixedPosition(seed) {
  const m = await createMatch({ seed });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 4, face: 5 });
  await m.act('B', { type: 'peek' });
  return m;
}

async function sampleOne({ channel, persona, profile, seed, fetchFn }) {
  const m = await fixedPosition(seed);
  const ob = m.observe('B');
  const ai = createOpponent({ channel, profile, persona, fetchFn });
  const d = await ai.decide(ob);
  const log = ai.logs.at(-1) ?? {};
  const bad = [
    ...checkFacts(log.say, buildLedger(ob), { allowedFrom: log.facts ?? '' }),
    ...checkFacts(log.note, buildLedger(ob), { allowedFrom: log.facts ?? '' }),
  ];
  return {
    challenged: d.action.type === 'challenge',
    silent: !!d.silentFallback,
    // dropped＝出口校验当场拦下的编造；bad＝校验器复算（出口后应恒为空）
    fabricated: (log.dropped ? 1 : 0) + (bad.length ? 1 : 0),
  };
}

export async function runReadGate({ channel, persona = DEFAULT_PERSONA, samples = 6, fetchFn } = {}) {
  if (!channel) return { skipped: true, reason: '无通道：未测' };
  const out = {};
  let fabricated = 0;
  let silent = 0;
  for (const [key, profile] of Object.entries(PROFILES)) {
    let challenges = 0;
    for (let i = 0; i < samples; i++) {
      const r = await sampleOne({ channel, persona, profile, seed: 100 + i, fetchFn });
      if (r.challenged) challenges++;
      fabricated += r.fabricated;
      if (r.silent) silent++;
    }
    out[key] = { challengeRate: challenges / samples, samples };
  }
  // 画像换了，开牌率必须动（方向可为任意——人设不同方向不同，但不许纹丝不动）
  const shift = Math.abs(out.bluffer.challengeRate - out.honest.challengeRate);
  return {
    skipped: false,
    profiles: out,
    shift,
    fabricated,
    silent,
    ok: shift > 0 && fabricated === 0,
    note: `分布位移 ${shift.toFixed(2)}／虚构史实 ${fabricated}／降级 ${silent}`,
  };
}
