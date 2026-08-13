// 心算审计（Q102 验收工具，2026-08-13）：算盘删除后，模型自己判断的质量掉了没有？
//
// 这是 Q102 看空段第 ③ 条的判据——「'模型心算够用'只有一个型号的正样本，弱模型算错会
// 直接体现为棋力下降」。**用决策，不用它嘴上的数。**
//
// 为什么不看它自称的概率：第一版这么干过，"未命中"里几乎全是假阳性——belief 里的百分比
// 常在说别的事（对手的历史开牌命中率、"他 2 骰至少出 1 个 3 的概率"、抬价后被开的胜率）。
// 实测 deepseek 一条被判"偏离 44 点"的留档，人工复核是**完全算对**的。
// 自然语言里的数字认不准指代，这条路测不出东西。
//
// 现在的口径：每一手都用引擎发的权威快照（自见骰＋总骰＋斋否）复算 P(当前报价为真)，
// 然后只问一件**没有解释空间**的事——**它拿这个局面做了什么决定**：
//   · 开牌时 p 越低越对（p<50% ＝ 开得有理）；
//   · **p≥95% 还开牌＝必败开牌**——这口价靠它自己手里的骰就已经成立，开牌是送一颗骰。
//     ⚠️ **不要把这一类归因于「没有算盘」**（本文件初版这么写过，实测被推翻）：
//     全库 361 个「自己的骰已让报价成立」的局面里误开 33 次，其中 **10 次是拨过算盘的**，
//     13 次的留档明写「必然成立／100%」然后照样开——claude-haiku-4.5 更是 8 次误开
//     **8 次都拨过算盘**。工具把 100% 拍在脸上也拦不住，因为错的不是算术，是**胜负方向**
//     （以为开一口「必然成立」的价是稳赢）。详见 SYNC 待决 Q103。
//   · p≤20% 却选择抬价＝漏开（放过了一次几乎白拿的开牌）。
// 三个数都与"它说了什么"无关，只与"它做了什么"有关。
//
// ⚠️ 口径边界：① p 按**该席自己看得见的信息**算（未看骰＝全场未知），这正是它当时能算到的
// 上限，不是上帝视角；② v3 批次里拨过算盘的手单独计数并**排除出心算样本**——那些手的数
// 是引擎发的；③ 三人桌不适用（开只能开上家，p 的语义不同），本工具只跑单挑批次。
//
// 用法：
//   node scripts/audit-mental-math.mjs docs/arena/<批次目录> [更多批次…]
//   node scripts/audit-mental-math.mjs --list docs/arena/<批次目录>   # 附必败开牌的逐条留档
import fs from 'node:fs';
import path from 'node:path';
import { probBidTrue } from '../src/probability.js';

const argv = process.argv.slice(2);
const LIST = argv.includes('--list');
const dirs = argv.filter((a) => !a.startsWith('--'));
if (!dirs.length) {
  console.error('用法：node scripts/audit-mental-math.mjs docs/arena/<批次目录> [...]');
  process.exit(2);
}

const DOOMED = 95; // p≥95%：这口价已经成立，开牌基本是送一颗骰
const FREE = 20; // p≤20%：几乎白拿的开牌机会

// 从引擎发的【当前状态】读回权威事实（serializeCurrent() 生成，格式稳定）。
// ⚠️ 必须**只在【当前状态】区里**找：提示词的【档案】区会回灌模型前几局的留档原文，
// 而那些原文里常有"我骰面[2,5]"这样的句子——不锚定就会把上一局的骰子当成本手的，
// 算出来的 p 全错（第一版就踩了这个坑，v3 基线一度把 [2,5] 读成 [3,1,2,1]）。
function stateOf(facts) {
  const whole = String(facts ?? '');
  const i = whole.lastIndexOf('【当前状态');
  if (i < 0) return null;
  const s = whole.slice(i);
  const cur = s.match(/当前报价：(?:你|对方)报(\d+)个(\d+)/);
  if (!cur) return null;
  if (/这口自己的价被原样推回/.test(s)) return null; // 词条「让报」：自己的价，语义不同
  const dice = s.match(/骰面\[([\d,]+)\]/);
  const own = dice ? dice[1].split(',').map(Number) : [];
  let total = +(s.match(/报价边界：总骰(\d+)/)?.[1] ?? 0);
  if (!total) for (const m of s.matchAll(/：(\d+)骰，筹码/g)) total += +m[1];
  if (!total) return null;
  return {
    bid: { count: +cur[1], face: +cur[2] },
    zhai: /斋：是/.test(s),
    own,
    total,
    calced: /你已拨算盘/.test(s), // v3 批次：引擎发过数的手
    canChallenge: /开牌（\{"type":"challenge"\}）/.test(s),
  };
}

const rows = new Map();
const doomed = [];

for (const dir of dirs) {
  const file = path.join(dir, 'run.json');
  if (!fs.existsSync(file)) {
    console.error(`✗ ${file} 不存在，跳过`);
    continue;
  }
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pv = run.provenance?.promptVersion ?? '?';
  for (const m of run.matches ?? []) {
    for (const [seat, logs] of Object.entries(m.logs ?? {})) {
      const label = `${m.seats[seat]} [${pv}]`;
      if (!rows.has(label))
        rows.set(label, { hands: 0, calced: 0, chal: [], doomedN: 0, missed: 0, freeChances: 0 });
      const r = rows.get(label);
      for (const l of logs) {
        if (l.silentFallback || !l.facts) continue;
        const st = stateOf(l.facts);
        if (!st || !st.canChallenge) continue;
        r.hands++;
        if (st.calced) {
          r.calced++;
          continue; // 引擎发过数：不是心算样本
        }
        const p = probBidTrue(st.bid, st.own, st.total - st.own.length, st.zhai) * 100;
        const isChal = l.action?.type === 'challenge';
        if (isChal) {
          r.chal.push(p);
          if (p >= DOOMED) {
            r.doomedN++;
            doomed.push({
              label: m.seats[seat], pv, seed: m.seed, round: l.round, p: +p.toFixed(1),
              bid: `${st.bid.count}个${st.bid.face}`, own: st.own.join(',') || '（未见骰）',
              say: String(l.say ?? '').slice(0, 70), belief: String(l.belief ?? '').slice(0, 220),
            });
          }
        } else if (p <= FREE) {
          r.freeChances++;
          r.missed++;
        }
      }
    }
  }
}

const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);
const pctOf = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');

console.log(`\n决策质量审计（p ＝ 该席按自己看得见的信息算出的「当前报价为真」概率）\n`);
console.log('模型 [提示词版本]                        可开手  引擎发数  开牌  开牌时p中位  开得有理  必败开牌  漏开');
console.log('─'.repeat(110));
for (const [label, r] of [...rows.entries()].sort()) {
  const good = r.chal.filter((p) => p < 50).length;
  const mp = med(r.chal);
  console.log(
    label.padEnd(40) +
      String(r.hands).padStart(6) + String(r.calced).padStart(10) + String(r.chal.length).padStart(6) +
      (mp == null ? '—' : `${mp.toFixed(1)}%`).padStart(13) +
      pctOf(good, r.chal.length).padStart(10) +
      String(r.doomedN).padStart(10) +
      `${r.missed}/${r.freeChances}`.padStart(8),
  );
}
console.log(
  `\n口径：「可开手」＝轮到它且能开牌的手；「引擎发数」＝v3 拨过算盘（已排除出心算样本）；\n` +
    `「开得有理」＝开牌时 p<50%；「必败开牌」＝p≥${DOOMED}%（这口价靠它自己的骰就已成立）；\n` +
    `「漏开」＝p≤${FREE}% 却选择抬价而非开牌。\n` +
    `⚠️ 「漏开」不全是错——诈唬、做池、钓对手都可能是故意的；它是风格轴，不是错误率。\n` +
    `   真正无解释空间的只有「必败开牌」那一列。\n`,
);

if (doomed.length) {
  console.log(`必败开牌 ${doomed.length} 次：\n`);
  for (const d of doomed) {
    console.log(
      `▸ ${d.label} [${d.pv}] seed${d.seed} 第${d.round}局　报价 ${d.bid}　自见骰[${d.own}]　P(成立)=${d.p}%`,
    );
    if (LIST) console.log(`   说：「${d.say}」\n   想：${d.belief}…\n`);
  }
  if (!LIST) console.log(`\n（加 --list 看逐条留档）`);
} else {
  console.log('必败开牌：0 次。');
}
