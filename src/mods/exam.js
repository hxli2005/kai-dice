// 三门体检（词条上桌前的自动前置，复活测试只当终审不当 CI）：
// 门一 静态与冒烟（Q23 语法成立 + Q39 第四道门）——schema 校验＋200 场自对弈不变量；
// 门二 张力守恒（Q35）——词条只许搬运不确定性不许消灭它，按原子 tension 标记静态判；
// 门三 歧义测试（Q36 判据机械化）——让 AI 为该动作写两条互相矛盾的动机假设，写不出即不合格。

import { chat } from '../ai/llm.js';
import { OPS, validateMod } from './catalog.js';
import { smokeMods } from './smoke.js';

// mod：canonical 词条对象 {id,name,card,actions}；channel 缺省时门三记"未测"。
export async function examMod(mod, { channel, fetchFn, games = 200, existingTypes = [], onProgress } = {}) {
  const gates = [];

  // 门一：静态校验＋冒烟自对弈（玩家口径：这张卡跑不跑得动）
  const v = validateMod({ name: mod.name, actions: mod.actions }, { existingTypes });
  const sm = v.ok ? await smokeMods([mod], { games, onProgress }) : null;
  const usesOk = sm ? sm.uses > 0 : false; // 窗口永远打不开也算病
  gates.push({
    id: 'static',
    name: '跑得动吗',
    pass: v.ok && !!sm?.ok && usesOk,
    detail: !v.ok
      ? `这张卡本身写坏了：${v.errors.slice(0, 2).join('；')}`
      : !sm.ok
        ? `试打时桌子出了乱子（${sm.errors[0]}）`
        : !usesOk
          ? `试打 ${sm.games} 场，这条规矩一次都没触发——出场条件太苛刻`
          : `试打 ${sm.games} 场没出过错，这条规矩被用了 ${sm.uses} 次（平均一场 ${sm.avgRounds} 局）`,
  });

  // 门二：张力守恒（Q35，玩家口径：它添的是变数还是直接送答案）
  const killOps = mod.actions.flatMap((a) => a.effect).filter((e) => OPS[e.op]?.tension === 'kills');
  gates.push({
    id: 'tension',
    name: '留得住悬念吗',
    pass: killOps.length === 0,
    detail: killOps.length
      ? `它在直接出售确定的答案（${killOps.map((e) => e.op).join('、')}）——把猜的乐趣抽干了，不许上桌`
      : '它给桌上添的是新变数，不是答案——悬念还在',
  });

  // 门三：歧义测试（AI 即检测器）：写不出两条相反动机＝动作只有一种读法＝读心场里没戏
  if (!channel) {
    gates.push({ id: 'ambiguity', name: '读不透吗', pass: null, detail: '这项没测——要先连上 AI（设置里填暗号，或客席卡填钥匙）' });
  } else {
    try {
      const raw = await chat(
        channel,
        {
          system:
            '你是骰子读心游戏《开！》的对手研究员。给你一个新词条动作，判断它"读不读得透"：想象对手在一局中途对你用了这个动作，写出两条互相矛盾的动机解读（他图什么），每条一句、必须互斥。写得出→严格输出一行 JSON {"reads":["解读一","解读二"]}；这个动作只有一种合理解读、写不出相反的→输出 {"fail":true,"why":"一句话"}。',
          user: `词条「${mod.name}」：${mod.card}`,
          maxTokens: 300,
          timeoutMs: 20_000,
        },
        fetchFn,
      );
      const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
      if (j.fail)
        gates.push({ id: 'ambiguity', name: '读不透吗', pass: false, detail: `对手一眼就能看穿这一手的用意（${j.why ?? '只有一种解读'}）——读心桌上没戏` });
      else {
        const reads = (j.reads ?? []).map((r) => String(r).slice(0, 60)).filter(Boolean);
        const pass = reads.length >= 2 && reads[0] !== reads[1];
        gates.push({
          id: 'ambiguity',
          name: '读不透吗',
          pass,
          detail: pass
            ? `老李头猜这一手的动机，猜出两种相反的：「${reads[0]}」还是「${reads[1]}」——他也吃不准，有戏`
            : '老李头没猜出两种像样的相反读法',
        });
      }
    } catch (e) {
      gates.push({ id: 'ambiguity', name: '读不透吗', pass: null, detail: `这项没测成（${e?.message ?? '网络不通'}），可以再点一次` });
    }
  }

  return { pass: gates.every((g) => g.pass !== false), gates };
}
