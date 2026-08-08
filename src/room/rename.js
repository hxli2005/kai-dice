// 座位重映射（好友房核心适配层）：服务端引擎的座次恒为 A(主)/B(AI)/C(客)，
// 但发给每个客户端的 observe 都重命名成"自己是 A"——整套既有 UI（自己=A 的假设遍布各处）
// 对主客两端都原样成立，一行不用改。承诺哈希/事件流在重命名后依然自洽（键值同步换名）。

// 客席视角：A↔C 对换（映射是自身的逆——反向映射复用同一张表）
export function mapFor(seat) {
  return seat === 'C' ? { A: 'C', B: 'B', C: 'A' } : null; // null=恒等（主视角零开销）
}

// 值为座位号的字段（任意深度）；键为座位号的对象（blind/raises/shown/dice/commits/transfers…）
// 统一按"键在映射表中即换，字段名在名单上且值在映射表中即换"处理——
// 词条 id、'you'/'opp' 这类键值不在映射表里，天然不受影响。
const SEAT_VALUE_FIELDS = new Set([
  'you', 'turn', 'first', 'player', 'challenger', 'loser', 'winner', 'caller', 'to', 'id', 'seat', 'on', 'bettor',
]);
const SEAT_ARRAY_FIELDS = new Set(['standings']);

export function renameSeats(value, map, field = null) {
  if (!map) return value;
  if (Array.isArray(value)) {
    if (field && SEAT_ARRAY_FIELDS.has(field)) return value.map((v) => map[v] ?? v);
    return value.map((v) => renameSeats(v, map));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[map[k] ?? k] = renameSeats(v, map, k);
    return out;
  }
  if (typeof value === 'string' && field && SEAT_VALUE_FIELDS.has(field)) return map[value] ?? value;
  return value;
}

// 给指定座位的完整视图（observe 或任意消息体）
export function viewFor(obj, seat) {
  return renameSeats(obj, mapFor(seat));
}
