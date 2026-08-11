// 好友房核心测试（R1/R2/R3/R5）：假 socket 全场走通、座位重映射自洽、
// 掉线代打与回座、旁注零和、短语盘校验、房内经济跨场连续。
// AI 无通道（沉默模式）——决策即时且确定性友好；计时注入为手动触发。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, commitmentOf } from '../src/engine.js';
import { allLegalBids } from '../src/rules.js';
import { mulberry32 } from '../src/engine.js';
import { createRoomCore } from '../src/room/room.js';
import { viewFor } from '../src/room/rename.js';
import { PHRASES, BET_CAP } from '../src/room/protocol.js';
import { PERSONAS } from '../src/ai/personas.js';

const sleep = (ms) => new Promise((r) => (ms > 0 ? setTimeout(r, ms) : setImmediate(r)));

// 轮询等待条件成立（AI 泵是异步微任务链）
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(0);
  }
  throw new Error('until 超时');
}

// 假传输：每连接每消息类型只留最新一条＋计数（防长局把收件箱撑爆）
function harness(opts = {}) {
  const inbox = new Map(); // connId -> Map(type -> {msg, n})
  const timers = []; // 手动触发的注入计时器
  const core = createRoomCore({
    hostKey: 'HK',
    send: (connId, obj) => {
      if (!inbox.has(connId)) inbox.set(connId, new Map());
      const slot = inbox.get(connId).get(obj.t) ?? { msg: null, n: 0 };
      slot.msg = obj;
      slot.n += 1;
      inbox.get(connId).set(obj.t, slot);
    },
    schedule: (fn, ms) => {
      const h = { fn, ms, dead: false };
      timers.push(h);
      return () => (h.dead = true);
    },
    fetchFn: null, // 无 LLM：沉默主持
    aiPaceMs: 0,
    showdownMs: 0,
    ...opts,
  });
  const last = (id, t) => inbox.get(id)?.get(t)?.msg;
  const count = (id, t) => inbox.get(id)?.get(t)?.n ?? 0;
  // 快照遍历：被触发的回调可能再注册新计时器（如催话自续），不吃进本轮
  const fire = (pred) => {
    for (const h of [...timers]) if (!h.dead && (!pred || pred(h))) { h.dead = true; h.fn(); }
  };
  return { core, inbox, last, count, fire };
}

// 以某连接身份随机合法行棋一步（客户端视角：自见为 A）
function actFor(h, connId, rng) {
  const ob = h.last(connId, 'ob')?.ob;
  if (!ob || ob.over || ob.turn !== 'A') return false;
  const legal = ob.legal.filter((a) => a.type !== 'peek');
  let a = ob.legal.some((x) => x.type === 'peek') && rng() < 0.6 ? { type: 'peek' } : null;
  if (!a) {
    if (!legal.length) return false;
    a = { ...legal[Math.floor(rng() * legal.length)] };
    if (a.type === 'bid') {
      const bids = allLegalBids(ob.currentBid, ob.zhai, ob.diceCount.you + ob.diceCount.opp);
      a = { type: 'bid', ...bids[Math.floor(rng() * bids.length)] };
    } else if (a.type === 'declare') {
      a = { type: 'declare', declaration: a.declaration };
    }
  }
  h.core.handle(connId, { t: 'act', action: a, elapsedMs: 500 });
  return true;
}

async function playToReport(h, rng, conns = ['h1', 'g1']) {
  await until(() => h.last('h1', 'ob'));
  for (let step = 0; step < 4000; step++) {
    if (h.last('h1', 'report')) break;
    for (const c of conns) actFor(h, c, rng);
    await sleep(0);
  }
  return until(() => h.last('h1', 'report'));
}

test('好友房：建房入座→整场走通→双端对比报告卡（房内经济守恒）', async () => {
  const h = harness();
  h.core.handle('h1', { t: 'hello', device: 'devA', tab: 't1', seal: '虎', hostKey: 'HK' });
  h.core.handle('g1', { t: 'hello', device: 'devB', tab: 't2', seal: '雀' });
  const roomH = h.last('h1', 'room');
  const roomG = h.last('g1', 'room');
  // 双方都自见为 A（座位重映射）
  assert.equal(roomH.seats.find((s) => s.seat === 'A').seal, '虎');
  assert.equal(roomG.seats.find((s) => s.seat === 'A').seal, '雀');
  assert.equal(roomG.seats.find((s) => s.seat === 'C').seal, '虎', '客视角里主家坐对面');
  assert.equal(roomH.seats.find((s) => s.seat === 'B').name, PERSONAS['model:deepseek-v4-flash'].name);
  // 客不能开局
  h.core.handle('g1', { t: 'start' });
  assert.match(h.last('g1', 'err').msg, /主家/);
  h.core.handle('h1', { t: 'start' });
  const rng = mulberry32(7);
  const rep = await playToReport(h, rng);
  const repG = h.last('g1', 'report');
  assert.ok(repG, '客侧也收到报告');
  // 名次与数据面：两端 packs 自见为 A
  assert.equal(rep.packs.A.seal, '虎');
  assert.equal(repG.packs.A.seal, '雀');
  assert.equal(rep.verdict, null, '沉默模式不代言');
  // 房内经济：三户头守恒（无旁注时=300）
  const sum = rep.chips.A + rep.chips.B + rep.chips.C;
  assert.equal(sum, 300, '房内筹码守恒');
  // 再来一局：身家带进下一场
  h.core.handle('h1', { t: 'again' });
  await until(() => h.last('h1', 'ob')?.ob?.round === 1 && h.core._debug().matchNo === 2);
  const ob2 = h.last('h1', 'ob').ob;
  assert.equal(ob2.chips.you, rep.chips.A, '房内身家跨场连续');
});

test('座位重映射：客视角事件流自洽（承诺哈希在重命名后可验）', async () => {
  const m = await createMatch({ seed: 9, config: { players: ['A', 'B', 'C'] } });
  await m.act('A', { type: 'peek' });
  await m.act('A', { type: 'bid', count: 2, face: 4 });
  await m.act('B', { type: 'peek' });
  await m.act('B', { type: 'challenge' });
  const obC = viewFor(m.observe('C'), 'C');
  assert.equal(obC.you, 'A', '客自见为 A');
  const rs = obC.events.find((e) => e.type === 'roundStart');
  const rv = obC.events.find((e) => e.type === 'reveal');
  // 重命名后：C 的承诺在键 'A' 下，且与摊牌骰面对得上
  for (const s of Object.keys(rv.dice))
    assert.equal(await commitmentOf(rv.dice[s], rv.nonces[s]), rs.commits[s], `重命名后承诺自洽 ${s}`);
  // 主视角（恒等）不受影响
  const obA = viewFor(m.observe('A'), 'A');
  assert.equal(obA.you, 'A');
  assert.deepEqual(obA, m.observe('A'));
});

test('掉线代打与回座：一号机接管断线席位，游戏不停', async () => {
  const h = harness();
  h.core.handle('h1', { t: 'hello', device: 'devA', tab: 't1', seal: '虎', hostKey: 'HK' });
  h.core.handle('g1', { t: 'hello', device: 'devB', tab: 't2', seal: '雀' });
  h.core.handle('h1', { t: 'start' });
  await until(() => h.last('g1', 'ob'));
  // 客掉线 → 触发代打计时器
  h.core.onDisconnect('g1');
  h.fire();
  assert.equal(h.core._debug().seats.C.substituted, true, '代打生效');
  // 只剩主家在打：整场仍能走完（AI 打两席）
  const rng = mulberry32(11);
  await until(() => h.last('h1', 'ob'));
  for (let step = 0; step < 4000 && !h.last('h1', 'report'); step++) {
    actFor(h, 'h1', rng);
    await sleep(0);
  }
  assert.ok(h.last('h1', 'report'), '代打局能打完');
  // 回座：重连即复位
  h.core.handle('g2', { t: 'hello', device: 'devB', tab: 't3' });
  assert.equal(h.core._debug().seats.C.substituted, false, '回座让位');
  assert.equal(h.core._debug().seats.C.seal, '雀', '名章保留');
});

test('短语盘：合法 id 全桌转发（座位按收件人重映射），非法 id 静默丢弃', async () => {
  const h = harness();
  h.core.handle('h1', { t: 'hello', device: 'devA', tab: 't1', seal: '虎', hostKey: 'HK' });
  h.core.handle('g1', { t: 'hello', device: 'devB', tab: 't2', seal: '雀' });
  h.core.handle('g1', { t: 'phrase', id: 3 });
  await sleep(10);
  assert.equal(h.last('h1', 'phrase').seat, 'C', '主家看见客席拍话');
  assert.equal(h.last('g1', 'phrase').seat, 'A', '客席看见自己拍话（自见为 A）');
  const n = h.count('h1', 'phrase');
  h.core.handle('g1', { t: 'phrase', id: 999 });
  await sleep(10);
  assert.equal(h.count('h1', 'phrase'), n, '非法 id 不转发');
  assert.equal(PHRASES.length, 12);
});

test('观战旁注：出局者可押、活人不可押、结算零和入房内账', async () => {
  // 多打几个种子，等到"有人类先出局且对局未终"的形态出现
  for (let seed = 1; seed <= 12; seed++) {
    const h = harness();
    h.core.handle('h1', { t: 'hello', device: 'devA', tab: 't1', seal: '虎', hostKey: 'HK' });
    h.core.handle('g1', { t: 'hello', device: 'devB', tab: 't2', seal: '雀' });
    h.core.handle('h1', { t: 'start' });
    const rng = mulberry32(seed * 131);
    await until(() => h.last('h1', 'ob'));
    // 活人押注被拒
    h.core.handle('h1', { t: 'bet', on: 'B' });
    await sleep(10);
    assert.match(h.last('h1', 'err')?.msg ?? '', /好好打牌/);
    let betPlaced = false;
    for (let step = 0; step < 4000 && !h.last('h1', 'report'); step++) {
      for (const c of ['h1', 'g1']) {
        const ob = h.last(c, 'ob')?.ob;
        if (!betPlaced && ob && !ob.over && ob.players.find((p) => p.id === 'A')?.alive === false) {
          const alive = ob.players.filter((p) => p.alive);
          h.core.handle(c, { t: 'bet', on: alive[0].id });
          betPlaced = true;
        }
        actFor(h, c, rng);
      }
      await sleep(0);
    }
    if (!betPlaced) continue; // 本种子没人先出局，换一个
    const rep = await until(() => h.last('h1', 'report'));
    const br = h.last('h1', 'betResult');
    assert.ok(br, '旁注有结算广播');
    assert.equal(br.amount, BET_CAP);
    const sum = rep.chips.A + rep.chips.B + rep.chips.C;
    assert.equal(sum, 300, '旁注零和：房内总账不变');
    return;
  }
  assert.fail('12 个种子里竟无一局有人先出局');
});

// ---------- 不代言：健康模型交回 say="" 是它自己选的沉默（Q95 口径） ----------
test('健康模型 say="" 开牌不代言：F2 事实模板只属于降级', async () => {
  const respond = async (url, init) => {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    let content = '';
    if (!user.includes('合法动作')) content = ''; // 开场白/反思/判词等非决策调用：一律不说
    else if (/开牌（\{"type":"challenge"\}）/.test(user)) content = '{"action":{"type":"challenge"},"say":"","belief":"直接开，不说话"}';
    else if (/掀盅看骰/.test(user)) content = '{"action":{"type":"peek"},"say":""}';
    else content = '{"action":{"type":"bid","count":2,"face":5},"say":""}';
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  const h = harness({ fetchFn: respond });
  h.core.handle('h1', { t: 'hello', device: 'devA', tab: 't1', seal: '虎', hostKey: 'HK', pass: 'pw' });
  h.core.handle('g1', { t: 'hello', device: 'devB', tab: 't2', seal: '雀' });
  h.core.handle('h1', { t: 'start' });
  await until(() => h.last('h1', 'ob'));
  // 座次：主家=实际 A，客人=实际 B，AI=实际 C（开只能开上家 → 要让 AI 开的是客人的价）
  // 主家首报 → 客人跟价 → AI 按脚本开牌且一字不说
  h.core.handle('h1', { t: 'act', action: { type: 'peek' }, elapsedMs: 1 });
  h.core.handle('h1', { t: 'act', action: { type: 'bid', count: 2, face: 4 }, elapsedMs: 1 });
  await until(() => h.last('g1', 'ob')?.ob?.turn === 'A'); // 客人视角自己恒为 A
  h.core.handle('g1', { t: 'act', action: { type: 'peek' }, elapsedMs: 1 });
  h.core.handle('g1', { t: 'act', action: { type: 'bid', count: 2, face: 5 }, elapsedMs: 1 });
  await until(() => {
    const ob = h.last('h1', 'ob')?.ob;
    return ob && (ob.round > 1 || ob.over); // AI 开牌 → 第 1 局收束
  });
  assert.equal(h.count('h1', 'say'), 0, '健康模型的沉默开牌不许被事实模板代言');
  assert.equal(h.count('g1', 'say'), 0);
});
