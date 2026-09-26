import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, '.env');
let existing = '';
try { existing = await readFile(target, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let content = existing || await readFile(join(root, '.env.example'), 'utf8');
const current = key => content.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] || '';
const set = (key, value) => {
  if (/[\r\n\u0000]/.test(value)) throw new Error('Configuration values must be a single line.');
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  content = pattern.test(content) ? content.replace(pattern, () => line) : `${content}\n${line}\n`;
};
if (!process.stdin.isTTY) {
  if (!existing) await writeFile(target, content, { mode: 0o600, flag: 'wx' });
  console.log('Created .env if missing. Edit MC_OWNER and OPENAI_API_KEY locally, then run npm run play.');
  process.exit(0);
}
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  console.log('\nBroBot setup — Bedrock player + local Java world + OpenAI\n');
  console.log('Your API key stays in the ignored local .env file. Blank answers keep existing values.');
  const owner = (await rl.question(`Your exact name on the server (${current('MC_OWNER') || 'set later in dashboard'}): `)).trim();
  if (owner) set('MC_OWNER', owner);
  process.stdout.write(`OpenAI API key (${current('OPENAI_API_KEY') ? 'already set; hidden' : 'optional; hidden'}): `);
  muted = true;
  const apiKey = (await rl.question('')).trim();
  muted = false;
  process.stdout.write('\n');
  if (apiKey) set('OPENAI_API_KEY', apiKey);
  await writeFile(target, content, { mode: 0o600 });
  console.log('\nSaved. Next: npm run play\nBedrock server: 127.0.0.1, port 19132. Dashboard: http://127.0.0.1:3000\nIf BroBot is already running, close it first so the new configuration loads.');
} finally { muted = false; rl.close(); }
