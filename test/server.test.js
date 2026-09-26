import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { javaMajor, mergeProperties, requireEula, eulaAccepted, exists, writeServerConfig, downloadVerified } from '../scripts/server.js';

test('Java detection distinguishes supported Java from legacy or invalid output', () => {
  assert.equal(javaMajor('openjdk version "21.0.8" 2025-07-15 LTS'), 21);
  assert.equal(javaMajor('java version "1.8.0_451"'), 8);
  assert.equal(javaMajor('openjdk version "25.0.1"'), 25);
  assert.equal(javaMajor('no java installed'), 0);
});

test('setup enforces localhost and preserves the existing world and user settings', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'brobot-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'server.properties'), 'level-name=my-world\ndifficulty=hard\nserver-ip=0.0.0.0\nserver-ip=192.168.1.9\n');
  await writeServerConfig(dir, { port: 25577, bedrockPort: 19144 });
  const text = await readFile(join(dir, 'server.properties'), 'utf8');
  assert.match(text, /^level-name=my-world$/m);
  assert.match(text, /^difficulty=hard$/m);
  assert.match(text, /^server-ip=127\.0\.0\.1$/m);
  assert.equal((text.match(/^server-ip=/gm) || []).length, 1);
  assert.match(text, /^server-port=25577$/m);
  assert.match(text, /^enable-rcon=false$/m);
  const geyser = await readFile(join(dir, 'plugins/Geyser-Spigot/config.yml'), 'utf8');
  assert.match(geyser, /address: 127\.0\.0\.1/);
  assert.match(geyser, /port: 19144/);
  assert.match(geyser, /auth-type: offline/);
});

test('EULA gate rejects unattended unaccepted setup without writing acceptance', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'brobot-eula-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(requireEula(dir), /EULA acceptance is required/);
  assert.equal(await exists(join(dir, 'eula.txt')), false);
  await writeFile(join(dir, 'eula.txt'), '# eula=true\neula=false\n');
  assert.equal(await eulaAccepted(dir), false);
  await writeFile(join(dir, 'eula.txt'), 'eula=true\neula=false\n');
  assert.equal(await eulaAccepted(dir), false);
});

test('download verifies content and leaves previous file intact on checksum mismatch', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'brobot-download-'));
  const payload = Buffer.from('verified test data');
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end(payload); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, 'test.jar');
  const url = `http://127.0.0.1:${server.address().port}/test.jar`;
  const hash = createHash('sha256').update(payload).digest('hex');
  await downloadVerified(url, file, hash);
  await downloadVerified(url, file, hash);
  assert.equal(requests, 1);
  await assert.rejects(downloadVerified(url, file, '0'.repeat(64)), /Checksum mismatch/);
  assert.equal(await readFile(file, 'utf8'), payload.toString());
});

test('property updates retain comments and unrelated keys', () => {
  assert.equal(mergeProperties('# mine\nlevel-name=test\nserver-port=1\n', { 'server-port': 2 }), '# mine\nlevel-name=test\nserver-port=2\n');
});
