import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON.'); }
}

export function createDashboard(runtime, port, { shutdown } = {}) {
  const token = randomBytes(32).toString('hex');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const server = createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    const send = (status, data) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    if (!hosts.has(req.headers.host)) { send(403, { error: 'Use the local dashboard address.' }); return; }
    const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    try {
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path);
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(content); return;
      }
      if (req.method === 'GET' && path === '/api/state') { send(200, { ...runtime.state(), token }); return; }
      if (req.method !== 'POST') { send(404, { error: 'Not found.' }); return; }
      const expectedOrigin = `http://${req.headers.host}`;
      const supplied = Buffer.from(req.headers['x-brobot-token'] || '');
      const correct = Buffer.from(token);
      if (req.headers.origin !== expectedOrigin || supplied.length !== correct.length || !timingSafeEqual(supplied, correct)) { send(403, { error: 'Reload the local dashboard to authorize this request.' }); return; }
      if (!(req.headers['content-type'] || '').startsWith('application/json')) { send(415, { error: 'Expected application/json.' }); return; }
      const body = await bodyJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
      if (path === '/api/stop') { send(200, runtime.stop()); return; }
      if (path === '/api/shutdown') { send(200, { closing: true }); setImmediate(() => { if (shutdown) void shutdown(); else void runtime.close(); }); return; }
      if (path === '/api/command') {
        // Respond immediately; action completion is delivered by the event log.
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) throw new Error('Enter a command from 1 to 2000 characters.');
        const task = runtime.command(body.text);
        task.then(result => { if (result?.message) runtime.log('reply', result.message); }).catch(error => runtime.log('error', error.message));
        send(202, { accepted: true }); return;
      }
      if (path === '/api/owner') { runtime.setOwner(body.name); send(200, { saved: true }); return; }
      if (path === '/api/budget/reset') { runtime.brain.resetBudget(); runtime.log('config', 'AI budget reset by player.'); send(200, { reset: true }); return; }
      send(404, { error: 'Not found.' });
    } catch (error) { send(400, { error: error.message }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 3000;
  return server;
}
