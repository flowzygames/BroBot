import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { Runtime } from './runtime.js';
import { createDashboard } from './web.js';

let runtime;
try { runtime = new Runtime(loadConfig()); }
catch (error) { console.error(`Setup problem: ${error.message}`); process.exit(1); }
const server = createDashboard(runtime, runtime.config.webPort, { shutdown });
server.on('error', error => { console.error(`Dashboard: ${error.message}`); process.exitCode = 1; void shutdown(); });
server.listen(runtime.config.webPort, '127.0.0.1', () => {
  runtime.log('ready', `Dashboard: http://127.0.0.1:${runtime.config.webPort}`);
  runtime.log('ready', runtime.config.ai.apiKey ? `AI model: ${runtime.config.ai.model}. No API calls until you give a goal.` : 'Direct controls ready. For AI, run npm run setup and add your API key locally.');
  runtime.connect();
});

const terminal = createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY) });
terminal.on('line', line => {
  if (!line.trim()) return;
  if (line.trim() === 'quit') { void shutdown(); return; }
  runtime.command(line).then(result => {
    if (result) console.log(JSON.stringify(result, null, 2));
  }).catch(error => runtime.log('error', error.message));
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  terminal.close();
  await runtime.close();
  server.close();
  server.closeAllConnections();
  const fallback = setTimeout(() => process.exit(process.exitCode ?? 0), 3000);
  fallback.unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', error => { runtime.log('fatal', error.message); process.exitCode = 1; void shutdown(); });
process.on('unhandledRejection', error => { runtime.log('fatal', String(error?.message || error)); process.exitCode = 1; void shutdown(); });
