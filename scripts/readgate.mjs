// 读心回归的真通道跑法（F0d）：机器只能证明"分布动了、没编史"，动得对不对靠人看。
//   KAI_BASE=https://kai-dice.pages.dev/api/llm KAI_KEY=暗号 npm run readgate
//   自带钥匙： KAI_BASE=https://api.deepseek.com/v1 KAI_KEY=sk-... KAI_MODEL=deepseek-chat npm run readgate

import { runReadGate } from '../src/ai/readgate.js';
import { PERSONAS } from '../src/ai/personas.js';

const channel = process.env.KAI_KEY
  ? {
      baseUrl: process.env.KAI_BASE ?? 'https://kai-dice.pages.dev/api/llm',
      apiKey: process.env.KAI_KEY,
      model: process.env.KAI_MODEL ?? 'deepseek-chat',
      format: process.env.KAI_FORMAT ?? 'openai',
    }
  : null;

const persona = PERSONAS[process.env.KAI_PERSONA ?? 'laolitou'];
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
console.log(r.ok ? '✓ 过：档案确实在动它的手，且没编史' : '✗ 不过：分布没动（档案是摆设）或出现虚构史实');
process.exit(r.ok ? 0 : 1);
