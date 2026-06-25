import { WebSocketServer } from 'ws';
import { verifyAccess } from './services/tokens.js';

// userId -> Set<WebSocket>
const clients = new Map();

export function initRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Token passed as ?token=... on the ws url.
    let userId;
    try {
      const url = new URL(req.url, 'http://localhost');
      const payload = verifyAccess(url.searchParams.get('token') || '');
      userId = payload.sub;
    } catch {
      ws.close(4001, 'unauthorized');
      return;
    }

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);

    ws.on('close', () => {
      const set = clients.get(userId);
      if (set) { set.delete(ws); if (!set.size) clients.delete(userId); }
    });

    // Heartbeat to drop dead connections.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}

// Called from the chat route when a message is sent.
export function notifyMessage(recipientId, message) {
  const set = clients.get(recipientId);
  if (!set) return;
  const payload = JSON.stringify({ type: 'message', message });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
