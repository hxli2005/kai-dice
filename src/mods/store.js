// 实验桌本地存储（Q32 沙盒 · 全部 localStorage 无账号）。
// lab：开关＋勾选的词条；wishes：编译通过并冒烟合格的许愿词条（含体检报告）；
// wishlog：许愿失败日志＝原子库需求清单（Q39）。愿望原文仅本地存（获批反驳③：不外露是红线，不存储不是）。

import { CATALOG, catalogMap } from './catalog.js';

const LAB_KEY = 'kai.lab.v1';
const WISH_KEY = 'kai.wishes.v1';
const WLOG_KEY = 'kai.wishlog.v1';

const read = (k, fb, storage = localStorage) => {
  try {
    return JSON.parse(storage.getItem(k)) ?? fb;
  } catch {
    return fb;
  }
};

export function loadLab(storage = localStorage) {
  const l = read(LAB_KEY, {}, storage);
  return { on: !!l.on, picks: Array.isArray(l.picks) ? l.picks : [] };
}
export function saveLab(lab, storage = localStorage) {
  storage.setItem(LAB_KEY, JSON.stringify(lab));
}

export function loadWishes(storage = localStorage) {
  const w = read(WISH_KEY, [], storage);
  return Array.isArray(w) ? w.filter((x) => x?.id && x?.ast?.actions) : [];
}
export function saveWishes(list, storage = localStorage) {
  storage.setItem(WISH_KEY, JSON.stringify(list.slice(0, 20)));
}

export function loadWishLog(storage = localStorage) {
  return read(WLOG_KEY, [], storage);
}
export function addWishLog(entry, storage = localStorage) {
  const log = [entry, ...loadWishLog(storage)].slice(0, 30);
  storage.setItem(WLOG_KEY, JSON.stringify(log));
  return log;
}

// 全部可上桌词条（官方＋许愿），canonical 形态统一为 {id,name,card,origin,actions}
export function allMods(storage = localStorage) {
  return [
    ...CATALOG,
    ...loadWishes(storage).map((w) => ({
      id: w.id,
      name: w.ast.name,
      card: w.card,
      origin: 'wish',
      actions: w.ast.actions,
      exam: w.exam ?? null,
    })),
  ];
}

// 现役动作 type 集（撞名校验用：新许愿不得与官方或已存许愿的动作重名）
export function activeTypes(storage = localStorage) {
  return allMods(storage).flatMap((m) => m.actions.map((a) => a.type));
}

// 本场应带上桌的词条（实验桌开着且勾了才算数）
export function pickedMods(storage = localStorage) {
  const lab = loadLab(storage);
  if (!lab.on || !lab.picks.length) return [];
  const byId = Object.fromEntries(allMods(storage).map((m) => [m.id, m]));
  return lab.picks.map((id) => byId[id]).filter(Boolean);
}

export { CATALOG, catalogMap };
