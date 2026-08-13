// G2 事件接地（DESIGN §3.5「事件接地」，SYNC 接地批次 Q50）
//
// **语义可错，指代不可错。** `{actor, target, action, round}` 四元组是世界的骨架，
// 不属于任何一方的"说法"：它记的是**谁、对谁、做了什么、第几局**。
// 判据——偶尔记错数字＝人格；反复把"谁开谁"弄反＝数据接地故障。
//
// 本模块只做三件事，不做第四件（不生成台词、不算统计）：
//   1. 契约  TUPLE_KEYS：四元组的字段名，引擎发射口与下游共用同一份定义；
//   2. 审计  groundingFaults()：从事件流**独立重算**报价梯，与四元组对账；
//   3. 迁移  groundEvents()：G2 之前落盘的旧档（用 {player}、无 target）在**载入边界**补齐。
//
// 迁移是唯一允许回推主客体的地方，且只对历史数据。活引擎的事件由 engine.js 当场盖章——
// 下游一律从四元组读事实，**禁以自然语言复述为事实来源**，也禁自己从"上一条 bid"回推。

export const TUPLE_KEYS = ['actor', 'target', 'action', 'round'];

// actor/target 为 null 读作"这一条是引擎在说话"，不是缺数据
const ENGINE_VOICE = new Set(['roundStart', 'roundEnd', 'matchEnd']);
// 必须指名道姓的动作（没有 actor 就是故障）
const NEEDS_ACTOR = new Set(['peek', 'bid', 'declare', 'challenge', 'modAction', 'reveal']);
// 必须指明"对谁"的动作：开牌与摊牌都指向被开的那口价
const NEEDS_TARGET = new Set(['challenge', 'reveal']);

const seatsOf = (events) => {
  const start = events.find((e) => e.type === 'roundStart');
  return new Set(Object.keys(start?.diceCount ?? {}));
};

// 旧档里主客体的回推规则（只在迁移时用）
const legacyActor = (e) => (e.type === 'reveal' ? (e.challenger ?? null) : null);
const legacyTarget = (e, lastBidder) => {
  if (e.type === 'challenge') return lastBidder;
  if (e.type === 'reveal') return e.bid?.player ?? null;
  if (e.type === 'modAction' && e.op === 'returnBid') return e.to ?? null;
  if (e.type === 'modAction' && e.op === 'calzaResolve') return lastBidder;
  return null;
};

// 旧档 → 四元组。幂等：已接地的流原样返回（同时抹掉旧字段 player，不留第二个真相源）。
export function groundEvents(events = []) {
  let round = 0;
  let lastBidder = null;
  return events.map((e) => {
    const { player, ...rest } = e;
    if (e.type === 'roundStart') {
      round = e.round ?? round + 1;
      lastBidder = null;
    }
    const actor = e.actor ?? player ?? legacyActor(e);
    const target = e.target ?? legacyTarget(e, lastBidder);
    if (e.type === 'bid') lastBidder = actor ?? null;
    return {
      ...rest,
      actor: actor ?? null,
      target: target ?? null,
      action: e.action ?? e.type,
      round: e.round ?? round,
    };
  });
}

// 接地自查：把事件流当成外人的证词，独立重算一遍报价梯再对账。
// 返回故障清单（空数组＝接地完好）；测试与跑批体检共用同一把尺。
export function groundingFaults(events = []) {
  const faults = [];
  const seats = seatsOf(events);
  const at = (e, fault) => faults.push({ i: e.i, type: e.type, fault });
  const isSeat = (v) => typeof v === 'string' && seats.has(v);
  let round = 0;
  let lastBid = null; // 独立重算的当前报价（不读事件自称的 target）
  for (const e of events) {
    for (const k of TUPLE_KEYS) if (!(k in e)) at(e, `缺字段 ${k}`);
    if (e.type === 'roundStart') {
      round = e.round;
      lastBid = null;
    }
    if (e.round !== round) at(e, `round 与本局不符（记 ${e.round}，实为 ${round}）`);
    if (!e.action) at(e, 'action 为空');
    if (e.type !== 'modAction' && e.action !== e.type) at(e, `action 与 type 不符（${e.action} vs ${e.type}）`);
    if (e.actor != null && !isSeat(e.actor)) at(e, `actor 不是桌上的席位：${e.actor}`);
    if (e.target != null && !isSeat(e.target)) at(e, `target 不是桌上的席位：${e.target}`);
    if (ENGINE_VOICE.has(e.type) && (e.actor != null || e.target != null))
      at(e, '引擎自己说的话不该有主客体');
    if (NEEDS_ACTOR.has(e.type) && e.actor == null) at(e, 'actor 缺席');
    if (NEEDS_TARGET.has(e.type) && e.target == null) at(e, 'target 缺席');
    // 「谁开谁」专项：开牌／摊牌／掐的 target 必须等于独立重算出来的当前报价人
    if (e.type === 'challenge' || e.type === 'reveal' || (e.type === 'modAction' && e.op === 'calzaResolve')) {
      if (!lastBid) at(e, '没有报价却出现了开牌');
      else if (e.target !== lastBid.player)
        at(e, `谁开谁弄反了：target=${e.target}，当前报价人=${lastBid.player}`);
      if (e.actor != null && e.actor === lastBid.player && e.type !== 'reveal')
        at(e, `开了自己的价：${e.actor}`);
    }
    if (e.type === 'reveal' && e.bid?.player !== e.target)
      at(e, `摊牌的 bid.player 与 target 不符（${e.bid?.player} vs ${e.target}）`);
    if (e.type === 'bid') lastBid = { player: e.actor, count: e.count, face: e.face };
    if (e.type === 'modAction' && e.op === 'returnBid' && e.to !== e.target)
      at(e, `让报的 to 与 target 不符（${e.to} vs ${e.target}）`);
  }
  return faults;
}
