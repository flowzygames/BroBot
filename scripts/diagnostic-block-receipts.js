// Isolated console-prepared protocol experiment. Never invoked by the controller.
import assert from 'node:assert/strict';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { once } from 'node:events';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { observeServerBlock, decodeBlockChanges } from '../src/experimental/block-receipts.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, findJava, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `block-receipts-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = { kind: 'prepared-server-block-receipt-observer', started: new Date().toISOString(), passed: false,
  limits: 'Observer experiment only. Adventure refusal and survival success use separate bot connections in a console-prepared peaceful world. No production action integration, causality proof, movement certification or automatic terrain quarantine is claimed.',
  cases: [], sourceHashes: {}, cleanupErrors: [] };
let child, bot, output = '', log, interrupted, currentObserver;
const interrupt = signal => { interrupted = Error(`Interrupted by ${signal}`); bot?.stopDigging(); bot?.clearControlStates(); };
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function waitFor(test, ms, label) {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (interrupted) throw interrupted;
    if (Date.now() >= deadline) throw Error(`${label} timed out`);
    await sleep(20);
  }
}
const serverSaid = marker => output.split(/\r?\n/).some(line => line.endsWith(`[Server] ${marker}`));
async function command(lines) {
  const marker = randomUUID();
  child.stdin.write(lines.join('\n') + `\nsay ${marker}\n`);
  await waitFor(() => serverSaid(marker), 10000, 'console acknowledgement');
}
async function closeBot() {
  currentObserver?.dispose(); currentObserver = null;
  if (!bot) return;
  const closing = bot; bot = null;
  closing.stopDigging(); closing.clearControlStates();
  if (closing._client?.ended) return;
  const ended = once(closing, 'end');
  closing.quit('Receipt experiment complete');
  await bounded(ended, 5000, 'bot disconnection');
}
try {
  await mkdir(directory, { recursive: true });
  result.commit = execFileSync('git', ['rev-parse','HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  result.dirty = Boolean(execFileSync('git', ['status','--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim());
  assert.equal(result.dirty, false, 'Freeze experiment source before execution');
  for (const path of ['src/experimental/block-receipts.js','scripts/diagnostic-block-receipts.js','test/block-receipts.test.js','package-lock.json']) {
    result.sourceHashes[path] = createHash('sha256').update(await readFile(join(ROOT,path))).digest('hex');
  }
  await requireEula(SERVER_DIR, { interactive: false });
  const java = await findJava();
  const port = 25641;
  if (await pingTcp('127.0.0.1',port)) throw Error('Diagnostic port already occupied');
  await mkdir(join(directory,'plugins'), { recursive: true });
  for (const name of ['Geyser-Spigot.jar','ViaVersion.jar']) await copyFile(join(SERVER_DIR,'plugins',name), join(directory,'plugins',name));
  await copyFile(join(SERVER_DIR,'eula.txt'),join(directory,'eula.txt'));
  await writeServerConfig(directory, { port, bedrockPort: 19151, smoke: true });
  log = createWriteStream(join(directory,'server.log'));
  log.on('error', error => { interrupted = error; });
  child = await spawnServer({ directory, java: java.path, pipe: true });
  child.on('error', error => { interrupted = error; });
  for (const stream of [child.stdout,child.stderr]) stream.on('data', chunk => { output = (output + chunk.toString()).slice(-200000); log.write(chunk); });
  await waitFor(() => output.includes('Done ('),300000,'server startup');
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule randomTickSpeed 0','time set day',
    'fill -5 63 -5 5 63 5 stone','fill -5 64 -5 5 68 5 air','setworldspawn 1 64 0','gamerule spawnRadius 0']);
  for (const mode of ['adventure','survival']) {
    const record = { mode, packets: [], outbound: [], localUpdates: [], digCompletedEvents: 0 };
    result.cases.push(record);
    await command(['setblock 2 64 0 oak_log','kill @e[type=item]']);
    bot = mineflayer.createBot({ host: '127.0.0.1', port, username: 'ReceiptBot', version: VERSION, auth: 'offline', hideErrors: true });
    bot.on('error', error => { record.botError = error.message; });
    await bounded(once(bot,'spawn'),30000,'spawn');
    await bounded(bot.waitForChunksToLoad(),30000,'chunks');
    await command(['tp ReceiptBot 1.5 64 0.5','clear ReceiptBot','give ReceiptBot iron_axe 1',`gamemode ${mode} ReceiptBot`]);
    const target = new Vec3(2,64,0);
    await waitFor(() => bot.game.gameMode === mode && bot.entity.onGround && bot.entity.position.distanceTo(new Vec3(1.5,64,.5)) < .1 && bot.blockAt(target)?.name === 'oak_log' && bot.inventory.items().some(i => i.name === 'iron_axe'),5000,'fixture readiness');
    await bounded(bot.equip(bot.inventory.items().find(i => i.name === 'iron_axe'),'hand'),5000,'equip');
    await bounded(bot.lookAt(target.offset(.5,.5,.5),true),5000,'aim');
    const client = bot._client, baseline = client.listenerCount('packet');
    const write = client.write.bind(client);
    client.write = (name, data) => { if (name === 'block_dig') record.outbound.push({ at: Date.now(), ...data }); return write(name,data); };
    const packets = (data, metadata) => {
      if (['block_change','multi_block_change','acknowledge_player_digging'].includes(metadata.name)) record.packets.push({ at: Date.now(), name: metadata.name, data });
    };
    client.on('packet',packets);
    bot.on('blockUpdate', (oldBlock,newBlock) => { if (newBlock?.position.equals(target)) record.localUpdates.push({ at: Date.now(), old: oldBlock?.name, next: newBlock.name }); });
    bot.on('diggingCompleted', () => record.digCompletedEvents++);
    currentObserver = observeServerBlock({ bot, position: target, timeoutMs: 4000 });
    record.before = { block: bot.blockAt(target)?.name, inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })) };
    try { await bounded(bot.dig(bot.blockAt(target),'ignore'),6000,'dig drain'); record.digResolved = true; }
    catch (error) { record.digError = error.message; bot.stopDigging(); throw error; }
    record.afterDig = { receipt: currentObserver.snapshot(), cachedBlock: bot.blockAt(target)?.name };
    if (mode === 'adventure') {
      await waitFor(() => !currentObserver.snapshot().active,5000,'receipt deadline');
      record.finalReceipt = currentObserver.snapshot();
      assert.equal(record.afterDig.receipt.serverObservedAir,false);
      assert.equal(record.finalReceipt.serverObservedAir,false);
      assert.equal(record.finalReceipt.invalidReason,'deadline_expired');
      const targetAirUpdates = record.packets.flatMap(p => decodeBlockChanges(p.name,p.data) ?? []).filter(change =>
        change.position.x === target.x && change.position.y === target.y && change.position.z === target.z &&
        ['air','cave_air','void_air'].some(name => bot.registry.blocksByName[name].minStateId === change.stateId));
      assert.equal(targetAirUpdates.length,0,'No transient server air receipt in the negative case');
      assert.ok(record.localUpdates.some(update => update.next === 'air'),'Library prediction was exercised');
      assert.ok(record.digCompletedEvents > 0,'Library mining completion was exercised');
      assert.ok(record.outbound.some(packet => packet.status === 0) && record.outbound.some(packet => packet.status === 2),'Start and finish mining packets were sent');
    } else {
      await waitFor(() => currentObserver.snapshot().serverObservedAir,3000,'server air receipt');
      record.finalReceipt = currentObserver.snapshot();
      await waitFor(() => bot.inventory.items().some(i => i.name === 'oak_log'),5000,'separate inventory gain');
    }
    const marker = `TARGET_CHECK_${randomUUID()}`;
    await command([`execute if block 2 64 0 minecraft:${mode === 'adventure' ? 'oak_log' : 'air'} run say ${marker}`]);
    assert.ok(serverSaid(marker),'Independent server console target check');
    record.serverConsoleTarget = mode === 'adventure' ? 'oak_log' : 'air';
    record.after = { block: bot.blockAt(target)?.name, inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })), health: bot.health };
    if (mode === 'adventure') assert.equal(record.after.inventory.some(i => i.name === 'oak_log'),false);
    assert.equal(record.after.health,20);
    currentObserver.dispose();
    client.removeListener('packet',packets);
    assert.equal(client.listenerCount('packet'),baseline,'Observer listeners released');
    record.passed = true;
    await closeBot();
  }
  result.passed = true;
} catch (error) { result.error = error.stack ?? error.message; process.exitCode = 1; }
finally {
  try { await closeBot(); } catch (error) { result.cleanupErrors.push(error.message); }
  if (child) {
    try { await bounded(stopServer(child,10000),15000,'server stop'); }
    catch (error) {
      result.cleanupErrors.push(error.message); child.kill('SIGKILL');
      try { if (child.exitCode === null && !child.signalCode) await bounded(once(child,'exit'),5000,'forced server exit'); }
      catch (exitError) { result.cleanupErrors.push(exitError.message); }
    }
  }
  process.off('SIGINT',onInt); process.off('SIGTERM',onTerm); log?.end();
  if (interrupted || result.cleanupErrors.length) { result.passed = false; process.exitCode = 1; result.interrupted = interrupted?.message; }
  result.finished = new Date().toISOString();
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(result.passed ? 'PASS prepared server receipt observation' : 'FAIL prepared server receipt observation');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}
