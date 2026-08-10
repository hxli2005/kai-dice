// 读心回归的真通道跑法（F0d）：机器只能证明"分布动了、没编史"，动得对不对靠人看。
//   KAI_BASE=https://kai-dice.pages.dev/api/llm KAI_KEY=暗号 npm run readgate
//   自带钥匙： KAI_BASE=https://api.deepseek.com/v1 KAI_KEY=sk-... KAI_MODEL=xxx npm run readgate

import { runReadGate } from '../src/ai/readgate.js';
import { PERSONAS, HOSTED_MODEL } from '../src/ai/personas.js';

// 默认保留模型原生推理；只有做历史对照实验时才可显式 KAI_THINK=off。
const base = process.env.KAI_BASE ?? 'https://kai-dice.pages.dev/api/llm';
const channel = process.env.KAI_KEY
  ? {
      baseUrl: base,
      apiKey: process.env.KAI_KEY,
      model: process.env.KAI_MODEL ?? HOSTED_MODEL,
      format: process.env.KAI_FORMAT ?? 'openai',
      ...(process.env.KAI_THINK === 'off' ? { extra: { thinking: { type: 'disabled' } } } : {}),
    }
  : null;

const persona = PERSONAS[process.env.KAI_PERSONA ?? `model:${HOSTED_MODEL}`] ?? PERSONAS[`model:${HOSTED_MODEL}`];
const samples = +(process.env.KAI_SAMPLES ?? 6);

const r = await runReadGate({ channel, persona, samples });
if (r.skipped) {
  console.log('未测：没给通道（设 KAI_KEY 后再跑）');
  process.exit(0);
}
console.log(`人设：${persona.name}　样本：${samples}/画像`);
console.log(`老实人画像 → 开牌率 ${r.profiles.honest.challengeRate}`);
console.log(`赌徒画像　 → 开牌率 ${r.profiles.bluffer.challengeRate}`);
console.log(r.note);
console.log(r.ok ? '✓ 过：档案确实在动它的手' : '✗ 不过：换了画像它纹丝不动——档案成了摆设');
console.log('（嘴上记歪只是观测项：Q49 场合律之下那是人设活性，不判罚）');
process.exit(r.ok ? 0 : 1);
