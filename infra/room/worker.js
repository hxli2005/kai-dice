// 好友房服务端壳（Q29，§7.2 唯一豁免）：Cloudflare Worker + Durable Object。
// 一房一 DO 实例＝单线程权威；房间逻辑在 src/room/room.js（纯模块），本文件只做管道：
// 建房（POST /new）、WS 升级路由、Origin 锁、闲置过期。
// 部署：npx wrangler deploy -c infra/room/wrangler.toml（与静态站分离，互不牵连）。

import { createRoomCore } from '../../src/room/room.js';

const ALLOW_ORIGIN = /^(https:\/\/kai-dice\.pages\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const ROOM_TTL_MS = 30 * 60 * 1000; // 闲置半小时自毁（好友局是即约即散的）

const rid = (n) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

const json = (obj, status = 200, origin = '*') =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    // Origin 锁（§9.7 同款逻辑）：浏览器必带 Origin；镜像站带自己的域即拒
    if (origin && !ALLOW_ORIGIN.test(origin)) return new Response('forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return json({}, 204, origin ?? '*');
    if (url.pathname === '/new' && request.method === 'POST') {
      const room = rid(10);
      const hostKey = rid(16);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      await stub.fetch('https://do/init', { method: 'POST', body: JSON.stringify({ hostKey }) });
      return json({ room, hostKey }, 200, origin ?? '*');
    }
    const m = url.pathname.match(/^\/ws\/([a-z0-9]{10})$/);
    if (m && request.headers.get('Upgrade') === 'websocket') {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(request);
    }
    return new Response('kai-room', { status: 200 });
  },
};

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.core = null;
    this.sockets = new Map(); // connId -> WebSocket
    this.lastAlarmAt = 0;
  }

  ensureCore(hostKey) {
    this.core ??= createRoomCore({
      hostKey,
      send: (connId, obj) => {
        const ws = this.sockets.get(connId);
        if (ws) {
          try {
            ws.send(JSON.stringify(obj));
          } catch {}
        }
      },
      // LLM 走既有官方代理（服务端到服务端无 Origin，不触锁）：配额自动计房主设备（X-Device）
      proxyBase: this.env.PROXY_BASE ?? 'https://kai-dice.pages.dev/api/llm',
    });
  }

  async touchAlarm() {
    const t = Date.now();
    if (t - this.lastAlarmAt > 5 * 60 * 1000) {
      this.lastAlarmAt = t;
      await this.state.storage.setAlarm(t + ROOM_TTL_MS);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      const { hostKey } = await request.json();
      await this.state.storage.put('hostKey', hostKey);
      this.ensureCore(hostKey);
      await this.touchAlarm();
      return new Response('ok');
    }
    if (request.headers.get('Upgrade') === 'websocket') {
      const hostKey = await this.state.storage.get('hostKey');
      if (!hostKey) return new Response('no such room', { status: 404 });
      this.ensureCore(hostKey);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const connId = crypto.randomUUID();
      this.sockets.set(connId, server);
      server.addEventListener('message', (e) => {
        this.touchAlarm();
        let msg = null;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        try {
          this.core.handle(connId, msg);
        } catch {}
      });
      const drop = () => {
        this.sockets.delete(connId);
        try {
          this.core?.onDisconnect(connId);
        } catch {}
      };
      server.addEventListener('close', drop);
      server.addEventListener('error', drop);
      await this.touchAlarm();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  async alarm() {
    // 闲置过期：清桌关灯。引擎状态只活在内存——好友局即约即散，不留骰面在任何盘上
    for (const ws of this.sockets.values()) {
      try {
        ws.close(4000, 'room expired');
      } catch {}
    }
    this.sockets.clear();
    this.core = null;
    await this.state.storage.deleteAll();
  }
}
