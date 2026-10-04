// Integration test only: fixture console commands are never available to the AI.
import assert from 'node:assert/strict';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import toolPackage from 'mineflayer-tool';
import { Vec3 } from 'vec3';
import { createActions } from '../src/actions.js';
import { awaitPassiveLanding } from '../src/passive-settlement.js';
import { isDryLanding } from '../src/body-hazards.js';
import { createProgression } from '../src/progression.js';
import { Memory } from '../src/memory.js';
import { ActionRunner } from '../src/runner.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingBedrock, pingTcp } from './doctor.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(timer));
}

async function main() {
  const landingOnly = process.argv.includes('--landing-only');
  const portalsOnly = process.argv.includes('--portals-only');
  const craftOnly = process.argv.includes('--craft-only');
  const ownerOnly = process.argv.includes('--owner-only');
  const collisionOnly = process.argv.includes('--collision-only');
  if ([landingOnly,portalsOnly,craftOnly,ownerOnly,collisionOnly].filter(Boolean).length>1) throw new Error('Choose only one smoke-test selection flag');
  await requireEula(SERVER_DIR, { accept: process.argv.includes('--accept-eula'), interactive: true });
  const { java } = await setupServer({ log: console.log });
  const port = Number(process.env.SMOKE_JAVA_PORT || 25575);
  const bedrockPort = Number(process.env.SMOKE_BEDROCK_PORT || 19142);
  if (await pingTcp('127.0.0.1', port)) throw new Error(`Smoke port ${port} is already occupied; set SMOKE_JAVA_PORT to another port.`);
  const directory = join(SERVER_DIR, 'smoke', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(join(directory, 'plugins'), { recursive: true });
  for (const name of ['Geyser-Spigot.jar', 'ViaVersion.jar']) await copyFile(join(SERVER_DIR, 'plugins', name), join(directory, 'plugins', name));
  await copyFile(join(SERVER_DIR, 'eula.txt'), join(directory, 'eula.txt'));
  await writeServerConfig(directory, { port, bedrockPort, smoke: true });
  const result = {
    started: new Date().toISOString(), minecraft: VERSION, directory,
    fixture: 'Fresh isolated world and console-prepared arena. Initial gathering/crafting/building starts with empty survival inventory. Later furnace tests supply cobblestone, sand and coal; equipment/food tests supply a chestplate, shield and cooked beef and apply hunger; portal tests supply obsidian, flint and steel, and eyes. The bot remains in survival. This is a skills integration test, not an autonomous Ender Dragon run.',
    selection: landingOnly ? 'passive landing only, two console-prepared short falls' : collisionOnly ? 'collision contact only, prepared grass corner' : portalsOnly ? 'portals only' : craftOnly ? 'craft only, four logs supplied as fixture' : ownerOnly ? 'owner controls only' : 'full integration suite', phases: [], passed: false
  };
  const log = createWriteStream(join(directory, 'smoke-server.log'));
  let output = '';
  let bot;
  let actions;
  let progression;
  const child = await spawnServer({ directory, java: java.path, pipe: true });
  const exit = new Promise(resolveExit => child.once('close', resolveExit));
  let exited = false;
  child.once('close', () => { exited = true; });
  child.once('error', error => { output += `\nSERVER ERROR ${error.message}`; });
  const capture = chunk => { const text = chunk.toString(); output = (output + text).slice(-200000); log.write(text); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  async function waitOutput(text, timeout = 60000) {
    const until = Date.now() + timeout;
    while (!output.includes(text)) {
      if (exited) throw new Error(`Server exited before ${text}: ${output.slice(-5000)}`);
      if (Date.now() >= until) throw new Error(`Server did not report ${text}: ${output.slice(-5000)}`);
      await sleep(100);
    }
  }
  async function commands(lines) {
    const marker = `SMOKE_${randomUUID()}`;
    child.stdin.write(`${lines.join('\n')}\nsay ${marker}\n`);
    await waitOutput(marker);
    await sleep(200);
  }
  async function phase(name, operation) {
    if (landingOnly && !/startup|joins the real server|Passively verify/i.test(name)) { result.phases.push({ name, skipped:true }); return; }
    if (collisionOnly && !/startup|joins the real server|contact precision/i.test(name)) { result.phases.push({ name, skipped: true }); return; }
    if (portalsOnly && !/startup|joins the real server|portal/i.test(name)) { result.phases.push({ name, skipped: true }); return; }
    if (craftOnly && !/startup|joins the real server|Craft |Smelt |Equip |Eat /i.test(name)) { result.phases.push({ name, skipped: true }); return; }
    if (ownerOnly && !/startup|joins the real server|configured owner/i.test(name)) { result.phases.push({ name, skipped: true }); return; }
    const started = Date.now();
    try {
      const details = await operation();
      result.phases.push({ name, passed: true, elapsedMs: Date.now() - started, details });
      console.log(`PASS ${name}`);
      return details;
    } catch (error) {
      result.phases.push({ name, passed: false, elapsedMs: Date.now() - started, error: error.message, details:error.details??null });
      throw error;
    }
  }
  const runner = new ActionRunner({ timeoutMs: 45000 });
  const perform = (name, args) => bounded(runner.run(name, signal => actions.execute(name, args, signal), () => actions.stop()), 50000, name);
  const count = name => bot.inventory.items().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);
  try {
    await phase('Paper and bridge startup', async () => {
      await waitOutput('Done (', 300000);
      let pong;
      for (let attempt = 0; attempt < 10 && !pong; attempt++) { pong = await pingBedrock('127.0.0.1', bedrockPort, 1000); if (!pong) await sleep(1000); }
      assert.ok(pong, 'Geyser must answer an actual Bedrock UDP ping');
      return pong;
    });
    await commands([
      'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doMobSpawning false',
      'time set day', 'weather clear', 'fill -16 64 -16 32 64 16 stone',
      'fill -16 65 -16 32 72 16 air', 'setworldspawn 0 65 0', 'gamerule spawnRadius 0',
      'fill 4 65 -2 4 67 2 stone', 'fill 8 65 0 8 66 1 oak_log'
    ]);
    await phase('Mineflayer joins the real server', async () => {
      bot = mineflayer.createBot({ host: '127.0.0.1', port, version: VERSION, username: 'BroBotSmoke', auth: 'offline', checkTimeoutInterval: 45000 });
      bot.on('error', error => { output += `\nBOT ERROR ${error.message}`; });
      bot.on('kicked', reason => { output += `\nBOT KICKED ${JSON.stringify(reason)}`; });
      bot.loadPlugin(pathfinderPackage.pathfinder);
      bot.loadPlugin(toolPackage.plugin);
      await bounded(once(bot, 'spawn'), 60000, 'bot spawn');
      await bounded(bot.waitForChunksToLoad(), 30000, 'chunks');
      await commands(['tp BroBotSmoke 0.5 65 0.5', 'gamemode survival BroBotSmoke', 'clear BroBotSmoke']);
      await sleep(400);
      const memory = new Memory(join(directory, 'memory'));
      actions = createActions(bot, { memory });
      progression = createProgression(bot, { actions, memory });
      assert.equal(bot.game.gameMode, 'survival');
      assert.equal(bot.inventory.items().length, 0);
      return { position: bot.entity.position, mode: bot.game.gameMode };
    });
    if (landingOnly) await phase('Passively verify dry ground after prepared short falls', async () => {
      const trials=[];
      const fixture='Console teleports create short controlled falls above prepared stone or one-layer snow. Timed frames are Mineflayer client observations, not independent server position evidence or a natural-world starter benchmark.';
      try {
      for(const surface of ['stone','snow']) {
        const trial={surface,started:null,settled:null,frames:[],final:null};trials.push(trial);
        actions.stop();
        await commands([`setblock 0 65 4 ${surface==='snow'?'snow[layers=1]':'air'}`, 'tp BroBotSmoke 0.5 65 0.5']);
        const support=bot.blockAt(new Vec3(0,64,4)),cover=bot.blockAt(new Vec3(0,65,4));
        assert.equal(support?.name,'stone');assert.equal(cover?.name,surface==='snow'?'snow':'air');
        trial.observedBlocks=[support,cover].map(block=>({position:{...block.position},name:block.name,stateId:block.stateId,shapes:block.shapes,properties:block.getProperties()}));
        let startMono=null,disarm=()=>{};
        const controller=new AbortController();
        const observation=new Promise((resolve,reject)=>{
          const expired=setTimeout(()=>{bot.removeListener('physicsTick',arm);controller.abort();reject(Error('Prepared falling state not observed'))},3000);
          const arm=()=>{
            const p=bot.entity.position,v=bot.entity.velocity;
            if(!p||!v||Math.abs(p.x-.5)>.1||Math.abs(p.z-4.5)>.1||p.y<=65.2||bot.entity.onGround||v.y>=0)return;
            bot.removeListener('physicsTick',arm);clearTimeout(expired);startMono=performance.now();
            trial.started={at:new Date().toISOString(),position:{...p},velocityY:v.y,onGround:bot.entity.onGround,windowMs:500};
            const sample=()=>{if(trial.frames.length<20)trial.frames.push({elapsedMs:performance.now()-startMono,at:new Date().toISOString(),position:{...bot.entity?.position},velocityY:bot.entity?.velocity?.y,onGround:bot.entity?.onGround})};
            bot.on('physicsTick',sample);
            awaitPassiveLanding(bot,{signal:controller.signal,deadline:startMono+500}).then(value=>{trial.settled=value;trial.settledElapsedMs=performance.now()-startMono;resolve(value)},reject).finally(()=>bot.removeListener('physicsTick',sample));
          };
          disarm=()=>{clearTimeout(expired);bot.removeListener('physicsTick',arm)};
          bot.on('physicsTick',arm);
        });
        try {
          const [,accepted]=await Promise.all([commands(['tp BroBotSmoke 0.5 65.9 4.5']),observation]);
          assert.equal(accepted,true,'Two fresh grounded dry physics samples must settle within the reserved deadline');
          assert.equal(isDryLanding(bot),true);assert.equal(bot.health,20);
        } finally {
          disarm();controller.abort();
          trial.final={at:new Date().toISOString(),position:{...bot.entity?.position},onGround:bot.entity?.onGround,health:bot.health};
        }
      }
      return {fixture,trials};
      } catch(error) {error.details={fixture,trials};throw error}
    });
    await phase('Walk around a grass corner with sub-epsilon contact precision', async () => {
      await commands(['fill -32 68 -10 -20 68 2 grass_block', 'fill -32 69 -10 -20 74 2 air', 'setblock -28 69 -4 grass_block']);
      const trials = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        actions.stop();
        await commands(['tp BroBotSmoke -27.562169459617916 69 -4.30000003 -53.017581939697266 0']);
        await sleep(400);
        assert.ok(bot.entity.position.distanceTo(new Vec3(-27.562169459617916, 69, -4.30000003)) < .01, 'Corner fixture must begin at the saved contact');
        let corrections = 0; const resets = [];
        const corrected = () => { corrections++; }, reset = reason => resets.push(reason);
        bot._client.on('position', corrected); bot.on('path_reset', reset);
        const began = Date.now();
        try {
          const details = await perform('go_to', { x: -27, y: 69, z: -4, radius: 0 });
          const elapsedMs = Date.now() - began;
          assert.ok(elapsedMs < 10000, 'Short corner route must not loop through repeated stuck resets');
          assert.equal(bot.blockAt(new Vec3(-28, 69, -4)).name, 'grass_block');
          assert.equal(bot.inventory.items().length, 0);
          trials.push({ elapsedMs, corrections, resets, position: details.position });
        } finally { bot._client.removeListener('position', corrected); bot.removeListener('path_reset', reset); }
      }
      await commands(['tp BroBotSmoke 0.5 65 0.5']); await sleep(400);
      return { fixture: 'Prepared grass corner and exact saved contact, repeated three times; no terrain modification by the bot.', trials };
    });
    await phase('Walk around a solid obstacle without digging', async () => {
      const details = await perform('go_to', { x: 8, y: 65, z: 4, radius: 0 });
      assert.ok(bot.entity.position.distanceTo(new Vec3(8.5, 65, 4.5)) < 1);
      assert.equal(bot.blockAt(new Vec3(4, 65, 0)).name, 'stone');
      return details;
    });
    await phase('Mine four logs by hand and collect real drops in survival', async () => {
      const details = await perform('collect', { block: 'oak_log', count: 4, radius: 24 });
      assert.ok(count('oak_log') >= 4, `Expected 4 oak logs, received ${count('oak_log')}; action result: ${JSON.stringify(details)}`);
      assert.equal(bot.blockAt(new Vec3(8, 65, 0)).name, 'air');
      return details;
    });
    await phase('Craft sixteen planks from gathered logs', async () => {
      if (craftOnly) await commands(['give BroBotSmoke oak_log 4']);
      const trace = [];
      const summarize = () => ({ slots: bot.inventory.slots.map((item, slot) => item && { slot, name: item.name, count: item.count }), cursor: bot.inventory.selectedItem });
      const original = bot._client.write;
      const packet = (data, meta) => { if (['window_items', 'set_slot', 'set_cursor_item', 'set_player_inventory'].includes(meta.name)) trace.push({ at: Date.now(), packet: meta.name, data }); };
      bot._client.on('packet', packet);
      bot._client.write = function (name, data, ...rest) {
        if (name === 'window_click') trace.push({ at: Date.now(), outbound: name, data });
        return original.call(this, name, data, ...rest);
      };
      trace.push({ before: summarize() });
      try {
        const details = await perform('craft', { item: 'oak_planks', count: 16 });
        assert.ok(count('oak_planks') >= 16);
        assert.equal(count('oak_log'), 0);
        return details;
      } finally {
        trace.push({ immediatelyAfter: summarize() });
        await sleep(300);
        trace.push({ settledAfter: summarize() });
        bot._client.write = original;
        bot._client.removeListener('packet', packet);
        await writeFile(join(directory, 'craft-debug.json'), JSON.stringify(trace, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
      }
    });
    await phase('Place and verify an inventory block', async () => {
      const before = count('oak_planks');
      const details = await perform('place', { block: 'oak_planks', x: 10, y: 65, z: 4 });
      assert.equal(bot.blockAt(new Vec3(10, 65, 4)).name, 'oak_planks');
      assert.equal(count('oak_planks'), before - 1);
      return details;
    });
    await phase('Build and verify a four-block floor from inventory', async () => {
      const details = await perform('build', { block: 'oak_planks', shape: 'floor', x: 12, y: 65, z: 4, width: 2, height: 1, depth: 2, hollow: null });
      for (let x = 12; x <= 13; x++) for (let z = 4; z <= 5; z++) assert.equal(bot.blockAt(new Vec3(x, 65, z)).name, 'oak_planks');
      assert.equal(count('oak_planks'), 11);
      return details;
    });
    await phase('Craft a table, sticks, and wooden pickaxe in survival', async () => {
      let tablePosition;
      const observeTable = (_old, block) => { if (block?.name === 'crafting_table') tablePosition = block.position.clone(); };
      bot.on('blockUpdate', observeTable);
      try {
        const table = await perform('craft', { item: 'crafting_table', count: 1 });
        const sticks = await perform('craft', { item: 'stick', count: 4 });
        const pickaxe = await perform('craft', { item: 'wooden_pickaxe', count: 1 });
        assert.equal(count('wooden_pickaxe'), 1);
        assert.equal(count('stick'), 2);
        assert.ok(tablePosition, 'The server must report a placed crafting table for the 3x3 recipe');
        assert.equal(bot.blockAt(tablePosition).name, 'crafting_table');
        return { table, sticks, pickaxe, tablePosition };
      } finally { bot.removeListener('blockUpdate', observeTable); }
    });
    await phase('Smelt glass in a crafted furnace using supplied test materials', async () => {
      await commands(['give BroBotSmoke cobblestone 8', 'give BroBotSmoke sand 2', 'give BroBotSmoke coal 1']);
      const furnace = await perform('craft', { item: 'furnace', count: 1 });
      const smelt = await perform('smelt', { item: 'sand', count: 1, fuel: 'coal' });
      assert.equal(count('glass'), 1);
      const reusedHeat = await perform('smelt', { item: 'sand', count: 1, fuel: null });
      assert.equal(count('glass'), 2);
      assert.equal(count('sand'), 0);
      return { furnace, smelt, reusedHeat };
    });
    await phase('Equip supplied armor and offhand shield with server confirmation', async () => {
      await commands(['give BroBotSmoke iron_chestplate 1', 'give BroBotSmoke shield 1']);
      const armor = await perform('equip', { item: 'iron_chestplate', destination: 'torso' });
      const shield = await perform('equip', { item: 'shield', destination: 'off-hand' });
      await bot._syncWindow(bot.inventory);
      await sleep(200);
      assert.equal(bot.inventory.slots[6]?.name, 'iron_chestplate');
      assert.equal(bot.inventory.slots[45]?.name, 'shield');
      return { armor, shield };
    });
    await phase('Eat supplied food after controlled hunger and verify recovery', async () => {
      await commands(['difficulty easy', 'give BroBotSmoke cooked_beef 1', 'effect give BroBotSmoke hunger 10 255 true']);
      const hungerDeadline = Date.now() + 8000;
      while (bot.food >= 18 && Date.now() < hungerDeadline) await sleep(100);
      await commands(['effect clear BroBotSmoke hunger']);
      const before = bot.food;
      assert.ok(before < 20, 'The hunger fixture must reduce food below full');
      const details = await perform('eat', { item: 'cooked_beef' });
      await bot._syncWindow(bot.inventory);
      await sleep(200);
      assert.ok(bot.food > before, 'Food meter must increase on the real server');
      assert.equal(count('cooked_beef'), 0);
      await commands(['difficulty peaceful']);
      return { before, after: bot.food, details };
    });
    await phase('Cancel active walking and release action lock', async () => {
      const pending = runner.run('go_to', signal => actions.execute('go_to', { x: 28, y: 65, z: 0, radius: 0 }, signal), () => actions.stop());
      const observed = assert.rejects(pending, /Smoke test stop/i);
      await sleep(200);
      const active = runner.active;
      assert.equal(active?.name, 'go_to', 'Walking must still be active when Stop is requested');
      runner.stop('Smoke test stop');
      assert.equal(active.controller.signal.aborted, true);
      await bounded(observed, 5000, 'action cancellation');
      await sleep(300);
      const stopped = bot.entity.position.clone();
      await sleep(500);
      assert.ok(bot.entity.position.distanceTo(stopped) < 0.5, 'Bot must stop moving after cancellation');
      assert.equal(runner.state(), null);
      return { stoppedAt: stopped };
    });
    await phase('In-game commands obey the configured owner and transfer an item', async () => {
      const config = loadConfig({ MC_HOST: '127.0.0.1', MC_PORT: String(port), MC_VERSION: VERSION, MC_USERNAME: 'BroBotGuard', MC_OWNER: 'SmokeOwner', BROBOT_DATA_DIR: join(directory, 'owner-test') });
      const runtime = new Runtime(config);
      let owner;
      try {
        runtime.connect();
        await bounded(once(runtime.bot, 'spawn'), 30000, 'controlled bot spawn');
        owner = mineflayer.createBot({ host: '127.0.0.1', port, version: VERSION, username: 'SmokeOwner', auth: 'offline' });
        owner.on('error', () => {});
        await bounded(once(owner, 'spawn'), 30000, 'owner spawn');
        await commands(['tp BroBotGuard 0.5 65 0.5', 'tp SmokeOwner -3.5 65 4.5']);
        await sleep(500);
        const command = '!bro action go_to {"x":2,"y":65,"z":4,"radius":0}';
        const before = runtime.bot.entity.position.clone();
        bot.chat(command);
        await sleep(700);
        assert.ok(runtime.bot.entity.position.distanceTo(before) < 0.25, 'A non-owner must not move the controlled bot');
        assert.equal(runtime.events.some(event => event.type === 'action'), false);
        owner.chat(command);
        const deadline = Date.now() + 10000;
        while (!runtime.events.some(event => event.type === 'result' && event.message.includes('go_to'))) {
          if (Date.now() > deadline) throw new Error('Owner chat command timed out');
          await sleep(100);
        }
        assert.ok(runtime.bot.entity.position.distanceTo(new Vec3(2.5, 65, 4.5)) < 1);
        const materials = count('oak_planks') ? 'plank crafted from gathered logs' : 'plank supplied for owner-only test selection';
        if (!count('oak_planks')) await commands(['give BroBotSmoke oak_planks 1']);
        const recipientBefore = owner.inventory.items().filter(item => item.name === 'oak_planks').reduce((sum, item) => sum + item.count, 0);
        const transferred = await perform('give', { player: 'SmokeOwner', item: 'oak_planks', count: 1 });
        const received = () => owner.inventory.items().filter(item => item.name === 'oak_planks').reduce((sum, item) => sum + item.count, 0);
        const transferDeadline = Date.now() + 5000;
        while (received() <= recipientBefore && Date.now() < transferDeadline) await sleep(100);
        assert.equal(received(), recipientBefore + 1, `The other real player must receive exactly one plank; ${JSON.stringify({ giver: bot.entity.position, recipient: owner.entity.position, dropped: Object.values(bot.entities).filter(entity => entity.name === 'item').map(entity => ({ id: entity.id, position: entity.position })), transferred })}`);
        return { nonOwnerIgnored: true, ownerCommandExecuted: true, transferred, recipientReceived: 1, materials };
      } finally {
        owner?.quit('Owner-control test finished');
        await runtime.close();
      }
    });
    await phase('Construct and light Nether portal with supplied test materials', async () => {
      await commands(['give BroBotSmoke obsidian 14', 'give BroBotSmoke flint_and_steel 1']);
      const details = await bounded(runner.run('build_nether_portal', signal => progression.execute('build_nether_portal', { x: 16, y: 65, z: -6, axis: 'x' }, signal), () => actions.stop()), 50000, 'Nether portal construction');
      assert.equal(details.active, true);
      assert.equal(bot.blockAt(new Vec3(17, 66, -6)).name, 'nether_portal');
      return details;
    });
    await phase('Activate an End portal ring with supplied test eyes', async () => {
      const lines = ['give BroBotSmoke ender_eye 12', 'tp BroBotSmoke 20.5 65 11.5'];
      for (let x = 23; x <= 25; x++) {
        lines.push(`setblock ${x} 64 6 end_portal_frame[facing=south,eye=false]`);
        lines.push(`setblock ${x} 64 10 end_portal_frame[facing=north,eye=false]`);
      }
      for (let z = 7; z <= 9; z++) {
        lines.push(`setblock 22 64 ${z} end_portal_frame[facing=east,eye=false]`);
        lines.push(`setblock 26 64 ${z} end_portal_frame[facing=west,eye=false]`);
      }
      await commands(lines);
      const details = await bounded(runner.run('activate_end_portal', signal => progression.execute('activate_end_portal', { radius: 16 }, signal), () => actions.stop()), 50000, 'End portal activation');
      assert.equal(bot.blockAt(new Vec3(24, 64, 8)).name, 'end_portal');
      assert.equal(details.inserted, 12);
      return details;
    });
    await phase('Enter the active End portal and observe dimension change', async () => {
      const details = await bounded(runner.run('enter_portal', signal => progression.execute('enter_portal', { kind: 'end', radius: 16, timeout: 30 }, signal), () => actions.stop()), 40000, 'End portal traversal');
      assert.ok(String(bot.game.dimension).includes('end'), `Expected the End, observed ${bot.game.dimension}`);
      return details;
    });
    result.passed = true;
  } catch (error) {
    result.error = error.message;
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  } finally {
    actions?.stop();
    bot?.quit('Smoke test finished');
    await stopServer(child);
    await exit;
    log.end();
    result.finished = new Date().toISOString();
    await writeFile(join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(join(SERVER_DIR, 'last-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Detailed result: ${join(directory, 'result.json')}`);
    console.log('The normal play world was not used or modified.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
