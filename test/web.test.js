import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { once } from 'node:events';
import { createDashboard } from '../src/web.js';

test('dashboard rejects malformed request URLs without shutting down', async () => {
  const runtime = { state: () => ({ alive: true }) };
  // Port zero keeps this fixture isolated; explicitly supply the configured Host.
  const server = createDashboard(runtime, 0);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const get = (path, host = '127.0.0.1:0') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
      res.on('error', reject);
    });
    req.setTimeout(2000, () => req.destroy(new Error('Dashboard request timed out.')));
    req.on('error', reject);
    req.end();
  });
  try {
    assert.equal((await get('http://[', 'evil.example')).status, 403);
    const invalid = await get('http://[');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'Invalid URL');
    const state = await get('/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.alive, true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('dashboard enforces host, origin and token while allowing stop during a long command', async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  let finish, stops=0;
  const runtime={state:()=>({secret:false}),stop:()=>{stops++;return{stopped:true};},command:()=>new Promise(resolve=>{finish=resolve;}),log:()=>{},setOwner:()=>{},brain:{resetBudget:()=>{}}};
  const server=createDashboard(runtime,port);server.listen(port,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${port}`;
  try {
    const state=await (await fetch(`${base}/api/state`)).json();assert.equal(state.token.length,64);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(`${base}/api/state`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost,403);
    assert.equal((await fetch(`${base}/api/stop`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const headers={'Content-Type':'application/json',Origin:base,'X-Brobot-Token':state.token};
    assert.equal((await fetch(`${base}/api/stop`,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    const command=await fetch(`${base}/api/command`,{method:'POST',headers,body:JSON.stringify({text:'follow Owner'})});assert.equal(command.status,202);
    const stop=await fetch(`${base}/api/stop`,{method:'POST',headers,body:'{}'});assert.equal(stop.status,200);assert.equal(stops,1);
    finish({done:true});
    assert.equal((await fetch(`${base}/api/owner`,{method:'POST',headers,body:'x'.repeat(9000)})).status,400);
    const page=await fetch(base);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.match(await page.text(),/Stop everything/);
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
});
