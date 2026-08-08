// 愿望编译器（Q39：散文进，DSL 出）。编译期一次 LLM 调用把人话译成词条 AST；
// 静态校验（catalog.validateMod）→ 回译确认（renderCard，锁编译幻觉）→ 冒烟自对弈（smoke.js）；
// 运行期引擎纯确定执行，LLM 零裁判。表达力=原子库闭包：编译失败的拒绝信指明缺失钩子，
// 许愿失败日志=原子库需求清单（边界从墙变路线图）。

import { chat } from '../ai/llm.js';
import { atomsDoc, validateMod, renderCard } from './catalog.js';

const SYSTEM = `你是骰子游戏《开！》的规则编译器。玩家用人话许愿一条新规则（词条），你把它编译成词条 AST（JSON）。

游戏底盘（不可改动）：多人各摇暗骰，轮流报"桌上至少有 N 个 X 点"、只能抬价；可开上家的牌（开错自己输）；输家掉一颗骰，掉光出局。词条只能在这个底盘上加一个新动作。

AST 语法（只许用下列原子，引擎按原子确定性执行，没有的能力就是做不到）：
{"name":"词条名（1–6字）","actions":[{"type":"英文小写slug","label":"按钮名（1–2字）","window":{…窗口谓词…},"params":"face"或省略,"keepTurn":true或省略,"terminal":true或省略,"effect":[{"op":"原子名"}]}]}

${atomsDoc()}

组合规则：
- calzaResolve / returnBid 必须是动作的唯一效果；revealOwnDie 与 potMult 可以组合（最多 2 个效果）。
- 纯声明式效果（revealOwnDie/potMult）必须 keepTurn=true（做完照常行动）。
- 所有动作 window.turn=true（只在自己回合）。

判断纪律：
- 玩家愿望能被上述原子表达 → 输出 AST，严格一行 JSON，不要其他文字。
- 表达不了（需要不存在的原子/钩子）→ 输出 {"error":"一句话说明为什么编不出来","missing":"缺的钩子（如：查看他人骰、重掷、禁言、跳过回合）"}。宁可拒绝，不许发明原子、不许曲解愿望硬凑。
- 愿望里的数值倍率只能落在 potMult 的 x（2 或 3）上。`;

// 返回：{ok:true, ast, card} 或 {ok:false, reason, missing?, retryable?}
export async function compileWish(text, channel, { existingTypes = [], fetchFn } = {}) {
  let raw;
  try {
    raw = await chat(
      channel,
      { system: SYSTEM, user: `许愿：${text}`, maxTokens: 700, timeoutMs: 30_000 },
      fetchFn,
    );
  } catch (e) {
    return { ok: false, reason: `编译调用失败（${e?.message ?? '网络不通'}）`, retryable: true };
  }
  let j;
  try {
    j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch {
    return { ok: false, reason: '编译器说了胡话（产物不是 JSON）', retryable: true };
  }
  if (j.error) return { ok: false, reason: String(j.error).slice(0, 120), missing: j.missing ? String(j.missing).slice(0, 60) : null };
  const v = validateMod(j, { existingTypes });
  if (!v.ok)
    return {
      ok: false,
      reason: `产物没过静态校验：${v.errors.slice(0, 3).join('；')}`,
      missing: v.missing.length ? v.missing.join('、') : null,
    };
  const ast = { name: j.name.trim(), actions: j.actions };
  return { ok: true, ast, card: renderCard(ast) }; // card=引擎回译——作者点头才生效
}
