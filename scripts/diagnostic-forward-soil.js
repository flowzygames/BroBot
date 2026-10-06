// Console-prepared private executor gate. Not an autonomous survival benchmark.
import assert from 'node:assert/strict'
import { mkdir, copyFile, readFile, writeFile, symlink, open, unlink, readdir, cp } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import zlib from 'node:zlib'
import mineflayer from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { createActions } from '../src/actions.js'
import { ActionRunner } from '../src/runner.js'
import { decodeBlockChanges } from '../src/experimental/block-receipts.js'
import { terrainTrustStatus } from '../src/terrain-trust.js'
import { ROOT, SERVER_DIR, VERSION, requireEula, findJava, writeServerConfig, spawnServer, stopServer } from './server.js'
import { pingTcp } from './doctor.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const savedWorld = process.argv.includes('--saved-world')
const sourceWorld = join(SERVER_DIR, 'benchmarks/2026-10-06T01-33-41-866Z-81d28177')
const directory = join(SERVER_DIR, 'smoke', `forward-soil-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
const result = { kind: savedWorld ? 'prepared-private-forward-soil-saved-world' : 'prepared-private-forward-soil', started: new Date().toISOString(), passed: false,
  limits: 'Console-prepared Java 1.21.8 gate with supplied equipment, peaceful conditions, removed entities and random ticks disabled. Terrain is ' + (savedWorld ? 'a copy of known failed seed 1542908414, with a specified early workstation pose and original home.' : 'a flat constructed arena.') + ' Private executor only; not autonomous selection, a natural survival score, Bedrock play, or a public tool.',
  phases: [], packets: [], commands: [], sourceHashes: {}, cleanupErrors: [] }
const runner = new ActionRunner({ timeoutMs: 60000 })
const home = savedWorld ? new Vec3(112.5, 68, 96.5) : new Vec3(-3.5, 65, .5)
const origin = savedWorld ? new Vec3(129.7, 64, 81.5) : new Vec3(.5, 65, .5)
const expectedStone = savedWorld ? [133, 60, 81] : [3, 62, 0]
const expectedEdits = savedWorld ? [[131,62,81],[132,62,81],[132,61,81],[133,62,81],[133,61,81]] : [[1,64,0],[2,64,0],[2,63,0],[3,64,0],[3,63,0]]
let protectedFeet = [origin, home]
const port = 25651
let child, bot, actions, log, output = '', interrupted, lock, owned = true
const lockPath = join(SERVER_DIR, '.diagnostic-server.lock')
const interrupt = reason => { interrupted = new Error(reason); runner.stop(reason); actions?.stop() }
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM')
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm)
async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out`)), ms) })]) }
  finally { clearTimeout(timer) }
}
async function waitFor(predicate, ms, label) {
  const until = Date.now() + ms
  while (!predicate()) {
    if (interrupted) throw interrupted
    if (child && (child.exitCode !== null || child.signalCode)) throw Error(`Server exited during ${label}`)
    if (Date.now() >= until) throw Error(`${label} timed out`)
    await sleep(30)
  }
}
const said = marker => output.split(/\r?\n/).some(line => line.endsWith(`[Server] ${marker}`))
async function command(lines) {
  result.commands.push(...lines)
  const marker = randomUUID()
  child.stdin.write(lines.join('\n') + `\nsay ${marker}\n`)
  await waitFor(() => said(marker), 10000, 'console acknowledgement')
  await sleep(200)
}
async function phase(name, fn) {
  const start = Date.now()
  try { const detail = await fn(); result.phases.push({ name, passed: true, elapsedMs: Date.now() - start, detail }); console.log('PASS', name) }
  catch (error) { result.phases.push({ name, passed: false, elapsedMs: Date.now() - start, error: error.message, partial: error.result }); throw error }
}
async function sourceFiles(directory, prefix = '') {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) paths.push(...await sourceFiles(join(directory, entry.name), prefix + entry.name + '/'))
    else if (entry.name.endsWith('.js')) paths.push(prefix + entry.name)
  }
  return paths
}
try {
  await mkdir(directory, { recursive: true })
  result.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim(), '', 'Freeze source before physical verification')
  for (const path of [...(await sourceFiles(join(ROOT, 'src'))).map(p => 'src/' + p), 'scripts/server.js', 'scripts/diagnostic-forward-soil.js', 'test/fixtures/forward-soil-saved-world.json.gz', 'package-lock.json']) {
    result.sourceHashes[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex')
  }
  // This isolated cloud harness is Linux-only. Refuse another Java process,
  // then own a shared lock; checking merely this test's port is insufficient.
  if (process.platform !== 'linux') throw Error('This diagnostic server-slot check is Linux-only')
  if (execFileSync('ps', ['-eo', 'comm='], { encoding: 'utf8' }).split('\n').some(name => name.trim() === 'java')) throw Error('Another Java process owns the shared server slot')
  lock = await open(lockPath, 'wx')
  await lock.writeFile(String(process.pid))
  if (await pingTcp('127.0.0.1', port)) throw Error('Diagnostic port is occupied')
  await requireEula(SERVER_DIR, { interactive: false })
  const java = await findJava()
  await copyFile(join(SERVER_DIR, 'eula.txt'), join(directory, 'eula.txt'))
  if (savedWorld) {
    const snapshot = JSON.parse(zlib.gunzipSync(await readFile(join(ROOT, 'test/fixtures/forward-soil-saved-world.json.gz'))))
    const sourceResult = await readFile(join(sourceWorld, 'result.json'))
    const hash = createHash('sha256').update(sourceResult).digest('hex')
    assert.equal(hash, snapshot.source.resultSha256)
    assert.deepEqual(snapshot.home, home.toArray()); assert.deepEqual(snapshot.origin, origin.toArray())
    protectedFeet = snapshot.protectedPositions.map(p => new Vec3(...p))
    result.sourceWorld = { directory: sourceWorld, resultSha256: hash, protectedFeet: snapshot.protectedPositions }
    await cp(join(sourceWorld, 'world'), join(directory, 'world'), { recursive: true })
  }
  await writeServerConfig(directory, { port, bedrockPort: 19161, smoke: true })
  for (const name of ['cache', 'libraries', 'versions']) await symlink(join(SERVER_DIR, 'runtime-cache', name), join(directory, name))
  log = createWriteStream(join(directory, 'server.log'))
  log.on('error', error => { interrupted = error })
  child = await spawnServer({ directory, java: java.path, pipe: true })
  child.on('error', error => { interrupted = error })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-200000); log.write(chunk) })
  await waitFor(() => output.includes('Done ('), 180000, 'server startup')
  const setup = ['difficulty peaceful', 'gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false',
    'gamerule randomTickSpeed 0', 'time set day', 'weather clear', 'kill @e[type=!player]']
  if (!savedWorld) setup.push('fill -12 59 -12 12 62 12 stone', 'fill -12 63 -12 12 63 12 dirt',
    'fill -12 64 -12 12 64 12 grass_block', 'fill -12 65 -12 12 72 12 air')
  setup.push(`setworldspawn ${Math.floor(origin.x)} ${origin.y} ${Math.floor(origin.z)}`, 'gamerule spawnRadius 0')
  await command(setup)
  bot = mineflayer.createBot({ host: '127.0.0.1', port, version: VERSION, username: 'SoilGate', auth: 'offline', hideErrors: true })
  bot.on('error', error => { result.botError = error.message })
  bot.loadPlugin(pf.pathfinder)
  await waitFor(() => bot.entity?.position && bot.health != null, 30000, 'bot spawn')
  await bot.waitForChunksToLoad()
  await command(['gamemode survival SoilGate', `tp SoilGate ${origin.x} ${origin.y} ${origin.z}`, 'clear SoilGate', 'give SoilGate wooden_pickaxe 1'])
  await waitFor(() => bot.entity.onGround && bot.entity.position.distanceTo(origin) < .1 && bot.health === 20 && bot.food === 20
    && bot.inventory.items().some(item => item.name === 'wooden_pickaxe') && bot.blockAt(new Vec3(...expectedStone))?.name === 'stone', 10000, 'prepared readiness')
  // Joining can load more saved entities; killing creatures can also create loot.
  await command(['kill @e[type=!player]', 'kill @e[type=item]'])
  await waitFor(() => Object.values(bot.entities).every(entity => entity === bot.entity || entity.name === 'item'), 5000, 'prepared entity removal')
  const admittedBot = bot, pathfinder = bot.pathfinder
  actions = createActions(bot, { movementBoundary: () => ({ center: home, radius: 64 }), starterProtectedPositions: () => protectedFeet })
  const admittedActions = actions
  const ownershipGuard = () => owned && bot === admittedBot && actions === admittedActions && bot.pathfinder === pathfinder
  bot._client.on('packet', (data, metadata) => {
    if (['block_change', 'multi_block_change'].includes(metadata.name)) result.packets.push({ at: Date.now(), name: metadata.name, changes: decodeBlockChanges(metadata.name, data) })
  })
  const supportChecks = [new Vec3(...expectedStone), origin.offset(0,-1,0).floored(), home.offset(0,-1,0).floored()].map(p => ({ position: p.toArray(), name: bot.blockAt(p)?.name }))
  assert.ok(supportChecks.every(cell => /^[a-z_]+$/.test(cell.name)))
  result.supportChecks = supportChecks
  await phase('Five receipt-confirmed soil edits and two physical descents', async () => {
    const value = await runner.run('private soil gate', (signal, context) => actions.excavateSoil(signal,
      { actionDeadline: context.deadline, ownershipGuard, starterScope: 'prepared/forward-soil' }), () => actions.stop())
    assert.equal(value.confirmed_soil_edits, 5); assert.equal(value.verified_descents, 2); assert.equal(value.stone_mined, false)
    assert.deepEqual(value.exposed_stone, expectedStone)
    assert.equal(value.landing_observations.length, 2)
    const airIds = new Set(['air', 'cave_air', 'void_air'].map(name => bot.registry.blocksByName[name].defaultState))
    const expected = expectedEdits
    for (const p of expected) assert.ok(result.packets.some(packet => packet.changes?.some(change => change.position.x === p[0] && change.position.y === p[1] && change.position.z === p[2] && airIds.has(change.stateId))), `Missing raw air receipt at ${p}`)
    for (const cell of supportChecks) assert.equal(bot.blockAt(new Vec3(...cell.position)).name, cell.name)
    assert.equal(terrainTrustStatus(bot).trusted, true)
    return value
  })
  await phase('Actual guarded return to home', async () => {
    const value = await runner.run('return home', signal => actions.execute('go_to', { x: Math.floor(home.x), y: home.y, z: Math.floor(home.z), radius: 0, returnable: true }, signal), () => actions.stop())
    await waitFor(() => bot.entity.onGround && bot.entity.position.floored().equals(home.floored()) && Math.abs(bot.entity.position.y - home.y) < .03, 3000, 'home settlement')
    assert.equal(bot.health, 20)
    return { ...value, health: bot.health, food: bot.food, trusted: terrainTrustStatus(bot).trusted }
  })
  const marker = randomUUID()
  await command([`execute ${supportChecks.map(cell => `if block ${cell.position.join(' ')} ${cell.name}`).join(' ')} run say ${marker}`])
  assert.ok(said(marker), 'Independent server check of stone and protected supports')
  result.passed = true
} catch (error) { result.error = error.stack || String(error); process.exitCode = 1; console.error(error) }
finally {
  try { runner.stop('Diagnostic ending'); actions?.stop(); bot?.quit('Prepared soil gate complete') } catch (error) { result.cleanupErrors.push(error.message) }
  owned = false
  if (child) {
    try { await bounded(stopServer(child, 10000), 15000, 'server stop') }
    catch (error) {
      result.cleanupErrors.push(error.message)
      if (child.exitCode === null && !child.signalCode) {
        child.kill('SIGKILL')
        try { await bounded(once(child, 'exit'), 5000, 'forced server exit') }
        catch (forced) { result.cleanupErrors.push(forced.message) }
      }
    }
    result.serverStopped = child.exitCode !== null || Boolean(child.signalCode)
  }
  log?.end()
  if (lock) {
    try { await lock.close(); if (!child || result.serverStopped) await unlink(lockPath) }
    catch (error) { result.cleanupErrors.push(error.message) }
  }
  if (interrupted || result.cleanupErrors.length || (child && !result.serverStopped)) { result.passed = false; process.exitCode = 1 }
  process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm)
  result.finished = new Date().toISOString()
  for (const [path, hash] of Object.entries(result.sourceHashes)) {
    if (createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex') !== hash) { result.sourceChanged = true; result.passed = false; process.exitCode = 1 }
  }
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(join(directory, 'result.json'))
}
