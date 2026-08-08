// 好友房客户端网络层（Q29）：WS 适配器把远程房间伪装成本地 match——
// 暴露与引擎同构的 {observe, act}，UI 既有代码（自己恒为 A）原样成立（座位重映射在服务端做）。
// 断线自动重连（设备+标签页即身份，服务端凭此回座）。

// 生产走同域 /api/room（Pages → DO 绑定，零 CORS）；本地开发用 kai.roomurl 指到 wrangler dev
export const roomUrl = () => localStorage.getItem('kai.roomurl') ?? `${location.origin}/api/room`;

export async function createRemoteRoom(roomId) {
  const r = await fetch(`${roomUrl()}/new`, { method: 'POST' });
  if (!r.ok) throw new Error(`建房失败 ${r.status}`);
  return r.json(); // {room, hostKey}
}

// 每标签页身份（同一设备开两个页各占一席；刷新不丢座）
export function tabId() {
  let t = sessionStorage.getItem('kai.tab.v1');
  if (!t) {
    t = Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('kai.tab.v1', t);
  }
  return t;
}

// handlers: {onRoom, onOb, onSay, onPhrase, onBet, onBetResult, onReport, onErr, onDown, onUp}
export function joinRoom({ room, hostKey = null, device, seal, pass = null, handlers = {} }) {
  let ws = null;
  let closed = false;
  let lastOb = null;
  let ackQueue = []; // 单飞 act：resolve 队列按序对应服务端 ack/err
  let retry = 0;

  const wsUrl = roomUrl().replace(/^http/, 'ws') + `/ws/${room}`;

  function connect() {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      retry = 0;
      ws.send(JSON.stringify({ t: 'hello', device, tab: tabId(), seal, hostKey, pass }));
      handlers.onUp?.();
    });
    ws.addEventListener('message', (e) => {
      let m = null;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (m.t) {
        case 'ob':
          lastOb = m.ob;
          handlers.onOb?.(m.ob);
          break;
        case 'ack':
          ackQueue.shift()?.resolve(true);
          break;
        case 'err':
          // act 被拒：按序回绝但不抛（UI 只需重渲染），并走统一提示
          if (ackQueue.length) ackQueue.shift().resolve(false);
          handlers.onErr?.(m.msg);
          break;
        case 'room':
          handlers.onRoom?.(m);
          break;
        case 'welcome':
          break;
        case 'say':
          handlers.onSay?.(m);
          break;
        case 'phrase':
          handlers.onPhrase?.(m);
          break;
        case 'bet':
          handlers.onBet?.(m);
          break;
        case 'betResult':
          handlers.onBetResult?.(m);
          break;
        case 'report':
          handlers.onReport?.(m);
          break;
      }
    });
    const drop = () => {
      for (const p of ackQueue) p.resolve(false);
      ackQueue = [];
      if (closed) return;
      handlers.onDown?.();
      retry += 1;
      if (retry <= 6) setTimeout(connect, Math.min(4000, 400 * retry));
      else handlers.onErr?.('重连失败，房间可能已散');
    };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', () => {});
  }
  connect();

  const sendMsg = (obj) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  };

  return {
    // match 同构接口：UI 的 ob()/act 原样工作（座位参数忽略——服务端只认你的席位）
    matchLike: {
      observe: () => lastOb,
      act: (_p, action, meta = {}) =>
        new Promise((resolve) => {
          if (ws?.readyState !== 1) {
            handlers.onErr?.('连接断了');
            return resolve(false);
          }
          ackQueue.push({ resolve });
          sendMsg({ t: 'act', action, elapsedMs: meta.elapsedMs ?? null });
        }),
    },
    start: () => sendMsg({ t: 'start' }),
    again: () => sendMsg({ t: 'again' }),
    phrase: (id) => sendMsg({ t: 'phrase', id }),
    bet: (on) => sendMsg({ t: 'bet', on }),
    close: () => {
      closed = true;
      try {
        ws?.close();
      } catch {}
    },
  };
}
