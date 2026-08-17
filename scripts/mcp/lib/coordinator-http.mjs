import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createShowdown } from './showdown.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const liveDir = path.resolve(here, '../live');
const humanDir = path.resolve(here, '../human');
const staticFiles = new Map([
  ['/spectate', { scope: 'spectate', file: path.join(liveDir, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/spectate/', { scope: 'spectate', file: path.join(liveDir, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/spectate/live.css', { scope: 'spectate', file: path.join(liveDir, 'live.css'), type: 'text/css; charset=utf-8' }],
  ['/spectate/live.js', { scope: 'spectate', file: path.join(liveDir, 'live.js'), type: 'text/javascript; charset=utf-8' }],
  ['/spectate/tokens.css', { scope: 'spectate', file: path.resolve(liveDir, '../../../tokens.css'), type: 'text/css; charset=utf-8' }],
  ['/play', { scope: 'play', file: path.join(humanDir, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/play/', { scope: 'play', file: path.join(humanDir, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/play/play.css', { scope: 'play', file: path.join(humanDir, 'play.css'), type: 'text/css; charset=utf-8' }],
  ['/play/play.js', { scope: 'play', file: path.join(humanDir, 'play.js'), type: 'text/javascript; charset=utf-8' }],
  ['/play/tokens.css', { scope: 'play', file: path.resolve(humanDir, '../../../tokens.css'), type: 'text/css; charset=utf-8' }],
]);

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 128 * 1024) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

function sendStatic(res, entry) {
  try {
    const body = readFileSync(entry.file);
    res.writeHead(200, {
      'content-type': entry.type,
      'content-length': body.length,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    send(res, 404, { error: 'spectator asset not found' });
  }
}

const bearer = (req) => String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

export async function startCoordinator({
  seed = 1,
  startDice = 5,
  bestOf = 1,
  host = '127.0.0.1',
  port = 0,
  tokens,
  adminToken,
  labels,
  onSnapshot,
  onAction,
  spectatorEnabled = true,
  playEnabled = false,
} = {}) {
  if (!tokens?.A || !tokens?.B || !adminToken) throw new Error('seat and admin tokens are required');
  let previousDecisionCount = 0;
  const spectators = new Set();
  let showdown;
  const broadcast = () => {
    if (!spectatorEnabled || !showdown || !spectators.size) return;
    const line = `event: snapshot\ndata: ${JSON.stringify(showdown.spectate())}\n\n`;
    for (const response of spectators) response.write(line);
  };
  showdown = await createShowdown({
    seed,
    startDice,
    bestOf,
    labels,
    async onSnapshot(snapshot) {
      await onSnapshot?.(snapshot);
      if (snapshot.decisions.length > previousDecisionCount) {
        for (const decision of snapshot.decisions.slice(previousDecisionCount)) onAction?.(decision, snapshot);
        previousDecisionCount = snapshot.decisions.length;
      }
      broadcast();
    },
  });

  let server;
  const heartbeat = setInterval(() => {
    for (const response of spectators) response.write(': keepalive\n\n');
  }, 15_000);
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const asset = staticFiles.get(url.pathname);
      if (
        req.method === 'GET' &&
        asset &&
        ((asset.scope === 'spectate' && spectatorEnabled) || (asset.scope === 'play' && playEnabled))
      ) return sendStatic(res, asset);
      if (spectatorEnabled && req.method === 'GET' && url.pathname === '/spectate/snapshot')
        return send(res, 200, showdown.spectate());
      if (spectatorEnabled && req.method === 'GET' && url.pathname === '/spectate/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        spectators.add(res);
        res.write(`event: snapshot\ndata: ${JSON.stringify(showdown.spectate())}\n\n`);
        req.on('close', () => spectators.delete(res));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        const snapshot = showdown.snapshot();
        send(res, 200, { ok: true, over: snapshot.over, revision: snapshot.revision });
        return;
      }
      if (url.pathname === '/admin/result') {
        if (bearer(req) !== adminToken) return send(res, 403, { error: 'forbidden' });
        send(res, 200, showdown.snapshot());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/admin/shutdown') {
        if (bearer(req) !== adminToken) return send(res, 403, { error: 'forbidden' });
        send(res, 200, { ok: true });
        setImmediate(() => {
          clearInterval(heartbeat);
          for (const response of spectators) response.end();
          spectators.clear();
          server.close();
        });
        return;
      }

      const match = url.pathname.match(/^\/seat\/(A|B)\/(observe|act|wait)$/);
      if (!match || req.method !== 'POST') return send(res, 404, { error: 'not found' });
      const [, seat, operation] = match;
      if (bearer(req) !== tokens[seat]) return send(res, 403, { error: 'forbidden' });
      const body = await readJson(req);
      if (operation === 'observe') return send(res, 200, showdown.observe(seat, body));
      if (operation === 'act') return send(res, 200, await showdown.act(seat, body));
      return send(res, 200, await showdown.waitForChange(seat, body));
    } catch (error) {
      send(res, error.code === 'STALE_STATE' ? 409 : ['ILLEGAL_ACTION', 'INVALID_ACTION'].includes(error.code) ? 422 : 400, {
        error: error.message,
        code: error.code ?? 'BAD_REQUEST',
        ...(error.current ? { current: error.current } : {}),
      });
    }
  };

  server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  const close = () => new Promise((resolve) => {
    clearInterval(heartbeat);
    for (const response of spectators) response.end();
    spectators.clear();
    server.close(resolve);
  });
  return {
    url,
    spectatorUrl: spectatorEnabled ? `${url}/spectate` : null,
    playUrl: playEnabled ? `${url}/play` : null,
    showdown,
    close,
  };
}
