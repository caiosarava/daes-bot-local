// Painel local de controle (só aceita conexões do próprio computador).
// Serve para ligar/desligar o bot, ver pausas ativas e pausar/retomar um contato.
import http from 'node:http';
import fs from 'node:fs';

export function startPanel({ store, getStatus, port }) {
  const html = fs.readFileSync(new URL('../public/painel.html', import.meta.url));
  const json = (res, obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        try {
          resolve(JSON.parse(b || '{}'));
        } catch {
          resolve({});
        }
      });
    });
  const toChat = (v) => (String(v).includes('@') ? String(v) : `${String(v).replace(/\D/g, '')}@c.us`);

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && pathname === '/api/state') {
      return json(res, { ...getStatus(), enabled: store.enabled, pauses: store.pauses(), chats: store.chatCount() });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (pathname === '/api/enabled') {
        store.setEnabled(!!b.enabled);
        return json(res, { ok: true });
      }
      if (pathname === '/api/pause' && b.to) {
        store.setPause(toChat(b.to), (Number(b.minutes) || 5) * 60e3);
        return json(res, { ok: true });
      }
      if (pathname === '/api/resume' && b.to) {
        store.clearPause(toChat(b.to));
        return json(res, { ok: true });
      }
    }
    json(res, { error: 'not found' }, 404);
  });

  server.listen(port, '127.0.0.1', () => console.log(`[painel] http://localhost:${port}`));
  return server;
}
