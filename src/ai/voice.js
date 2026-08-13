// 沉默模式的"被读"底线（Q43③，施工单 F2）：没有模型时，开牌这一拍也得说出"我为什么动手"。
// 降级可以降嘴皮，不许降掉唯一的差异化——桌上仍要有人在读你。
//
// 三条纪律：
// - 零模型：纯模板，输入全部来自 observe（公开事件）与自己的骰子；
// - 零编造：每个短语都指向一件刚发生过的真事，指不出来就不说；
// - 粗粒度：沉默 bot 的模板只说手感档位，不展示内部计算值。

import { obProb, coarseWord } from '../probability.js';

// **全席共用同一句**（Q87：原来一人一种声口，那是角色设定）。
// 注：这是表现层模板，不是提示词——通道断了时由我们代它开口。
const TEMPLATE = (f) => `${f.clause ? `${f.clause}。` : ''}这话${f.coarse}。开。`;

// 本局最扎的一条公开事实 → 一句短语（挑一条就够；挑不出就闭嘴，别凑废话）
export function readClause(ob) {
  const bid = ob.currentBid;
  if (!bid) return null;
  const q = bid.player;
  const evs = ob.events.slice(ob.events.findLastIndex((e) => e.type === 'roundStart') + 1);
  const mine = (e) => e.actor === q;
  if (ob.blind?.[q]) return '你骰都没看就压我';
  if (ob.raises?.[q]) return '抬完就报这一口';
  const depth = evs.filter((e) => e.type === 'bid').length;
  if (depth >= 5) return `都第 ${depth} 手了`;
  if (evs.some((e) => e.type === 'bid' && mine(e) && e.elapsedMs > 8000)) return '你报这口价前停了很久';
  if (evs.some((e) => e.type === 'peek' && mine(e))) return null; // 掀盅人人都掀，不算话
  return null;
}

// 沉默模式台词：kind 目前只有 'challenge'（开牌那一拍——"它为什么开我"正是被读感的落点）
// persona 参数保留只为不动调用方；声口已全席统一，它现在不被读取。
export function silentSay(persona, ob, kind = 'challenge') {
  if (!ob?.currentBid) return '';
  const tpl = TEMPLATE;
  const line = tpl({
    coarse: coarseWord(obProb(ob, ob.currentBid)),
    clause: readClause(ob),
    bid: ob.currentBid,
  });
  return typeof line === 'string' ? line.slice(0, 60) : '';
}
