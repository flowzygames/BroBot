import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, rename, rm, access } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

const run = promisify(execFile);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_DIR = join(ROOT, '.server');
export const VERSION = '1.21.8';
export const EULA_URL = 'https://www.minecraft.net/eula';
const headers = { 'User-Agent': 'BroBot/2.0 (https://github.com/flowzygames/BroBot)' };

export async function exists(path) { try { await access(path); return true; } catch { return false; } }
export function javaMajor(output) {
  const version = /(?:openjdk|java) version "([^"\s]+)/i.exec(output)?.[1];
  if (!version) return 0;
  const parts = version.split('.');
  return Number(parts[0] === '1' ? parts[1] : parts[0]);
}
async function javaFiles(directory, depth = 4) {
  if (depth < 0) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && /^java(?:\.exe)?$/.test(entry.name)) found.push(path);
    else if (entry.isDirectory()) found.push(...await javaFiles(path, depth - 1));
  }
  return found;
}
export async function findJava(env = process.env) {
  const candidates = [env.JAVA_PATH, env.JAVA_HOME && join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), 'java'];
  const roots = [join(SERVER_DIR, 'java')];
  if (process.platform === 'win32') roots.push(
    'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java', 'C:/Program Files/Microsoft',
    env.APPDATA && join(env.APPDATA, '.minecraft', 'runtime'));
  for (const directory of roots.filter(Boolean)) candidates.push(...await javaFiles(directory));
  for (const path of [...new Set(candidates.filter(Boolean))]) {
    try {
      const result = await run(path, ['-version'], { windowsHide: true, timeout: 10000 });
      const version = `${result.stdout}\n${result.stderr}`;
      if (javaMajor(version) >= 21) return { path, major: javaMajor(version), version: version.trim().split('\n')[0] };
    } catch { /* Keep trying installed runtimes. */ }
  }
  throw new Error('Java 21+ was not found. Run npm run server:setup to download a private Java runtime, or set JAVA_PATH in .env.');
}
async function json(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download metadata failed (${response.status}): ${url}`);
  return response.json();
}
export async function fileHash(path, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function downloadVerified(url, target, checksum, algorithm = 'sha256') {
  if (!new RegExp(`^[a-f0-9]{${algorithm === 'sha1' ? 40 : 64}}$`, 'i').test(checksum || '')) throw new Error(`Missing valid ${algorithm} checksum for ${target}`);
  if (await exists(target) && await fileHash(target, algorithm) === checksum.toLowerCase()) return;
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.${randomUUID()}.part`;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }));
    if (await fileHash(partial, algorithm) !== checksum.toLowerCase()) throw new Error(`Checksum mismatch for ${target}; refusing to use this download.`);
    await rename(partial, target);
  } finally { await rm(partial, { force: true }); }
}
export async function installJava(log = console.log) {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) throw new Error('Install Java 21+ for your platform and set JAVA_PATH.');
  const assets = await json(`https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${arch}&heap_size=normal&image_type=jre&jvm_impl=hotspot&os=${os}&vendor=eclipse`);
  const pkg = assets[0]?.binary?.package;
  if (!pkg) throw new Error('Adoptium did not provide a Java 21 runtime for this computer.');
  const directory = join(SERVER_DIR, 'java');
  const archive = join(directory, pkg.name);
  log('Downloading verified Eclipse Temurin Java 21 into .server/java (no system install).');
  await downloadVerified(pkg.link, archive, pkg.checksum);
  await run('tar', ['-xf', archive, '-C', directory], { windowsHide: true, timeout: 180000 });
  return findJava();
}
export async function eulaAccepted(directory = SERVER_DIR) {
  const content = await readFile(join(directory, 'eula.txt'), 'utf8').catch(() => '');
  const values = [...content.matchAll(/^\s*eula\s*=\s*(true|false)\s*$/gmi)];
  return values.at(-1)?.[1]?.toLowerCase() === 'true';
}
export async function requireEula(directory = SERVER_DIR, { accept = false, interactive = false } = {}) {
  if (await eulaAccepted(directory)) return;
  if (!accept && interactive && process.stdin.isTTY) {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try { accept = /^yes$/i.test((await reader.question(`Read ${EULA_URL}\nDo you accept the Minecraft EULA? Type yes to accept: `)).trim()); }
    finally { reader.close(); }
  }
  if (!accept) throw new Error(`Minecraft EULA acceptance is required. Read ${EULA_URL}, then run npm run server:setup -- --accept-eula if you agree. No game server has been started.`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'eula.txt'), `# Accepted by the user on ${new Date().toISOString()}\n# ${EULA_URL}\neula=true\n`);
}
export function mergeProperties(previous, changes) {
  const remaining = new Map(Object.entries(changes).map(([key, value]) => [key, String(value)]));
  const managed = new Set(remaining.keys());
  const lines = previous.split(/\r?\n/).filter(Boolean).map(line => {
    const key = /^\s*([^#!\s][^=:]*?)\s*[=:]/.exec(line)?.[1];
    if (managed.has(key) && !remaining.has(key)) return null;
    if (!remaining.has(key)) return line;
    const result = `${key}=${remaining.get(key)}`;
    remaining.delete(key);
    return result;
  }).filter(line => line !== null);
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}
export async function writeServerConfig(directory = SERVER_DIR, { port = Number(process.env.MC_PORT || 25565), bedrockPort = Number(process.env.BEDROCK_PORT || 19132), smoke = false } = {}) {
  for (const value of [port, bedrockPort]) if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Server ports must be integers from 1024 to 65535.');
  await mkdir(directory, { recursive: true });
  const propertyPath = join(directory, 'server.properties');
  const previous = await readFile(propertyPath, 'utf8').catch(() => '');
  const defaults = previous ? {} : { 'level-name': 'world', difficulty: 'normal', gamemode: 'survival', 'view-distance': 6, 'simulation-distance': 5, 'max-players': 8, motd: 'BroBot - local Minecraft companion' };
  const settings = { ...defaults, 'server-ip': '127.0.0.1', 'server-port': port, 'online-mode': false, 'enforce-secure-profile': false, 'enable-rcon': false, 'enable-query': false, 'spawn-protection': 0, 'pause-when-empty-seconds': -1 };
  if (smoke) Object.assign(settings, { 'level-type': 'minecraft:flat', 'generate-structures': false, difficulty: 'peaceful', 'spawn-monsters': false, 'level-seed': 718224, 'view-distance': 3, 'simulation-distance': 3 });
  await writeFile(propertyPath, mergeProperties(previous, settings));
  const geyser = join(directory, 'plugins', 'Geyser-Spigot');
  await mkdir(geyser, { recursive: true });
  // Both identity checks are off for account-free play on this computer only.
  // Keep the Bedrock and Java listeners on loopback; no public bind option.
  await writeFile(join(geyser, 'config.yml'), `# Managed by BroBot. Account-free play is restricted to this computer.\nbedrock:\n  address: 127.0.0.1\n  port: ${bedrockPort}\n  clone-remote-port: false\njava:\n  auth-type: offline\nmotd:\n  primary-motd: BroBot\n  secondary-motd: Local Minecraft companion\ngameplay:\n  server-name: BroBot\n  show-coordinates: true\nadvanced:\n  bedrock:\n    validate-bedrock-login: false\n  java:\n    use-direct-connection: true\nlog-player-ip-addresses: false\nsaved-user-logins: []\nconfig-version: 8\n`);
  await mkdir(join(directory, 'plugins', 'bStats'), { recursive: true });
  await writeFile(join(directory, 'plugins', 'bStats', 'config.yml'), 'enabled: false\n');
}
async function resolveDownloads() {
  const [paperBuilds, geyser, via] = await Promise.all([
    json(`https://fill.papermc.io/v3/projects/paper/versions/${VERSION}/builds`),
    json('https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest'),
    json('https://api.github.com/repos/ViaVersion/ViaVersion/releases/latest')
  ]);
  const paper = paperBuilds.find(build => build.channel === 'STABLE');
  const jar = paper?.downloads?.['server:default'];
  const viaJar = via.assets?.find(asset => /^ViaVersion-[\d.]+\.jar$/.test(asset.name));
  if (!jar || !geyser.downloads?.spigot || !viaJar?.digest?.startsWith('sha256:')) throw new Error('Official download metadata is incomplete; no unverified files will be installed.');
  return { version: VERSION, resolvedAt: new Date().toISOString(), files: [
    { path: 'server.jar', name: `Paper ${VERSION} build ${paper.id}`, url: jar.url, sha256: jar.checksums.sha256 },
    { path: 'plugins/Geyser-Spigot.jar', name: `Geyser ${geyser.version} build ${geyser.build}`, url: `https://download.geysermc.org/v2/projects/geyser/versions/${geyser.version}/builds/${geyser.build}/downloads/spigot`, sha256: geyser.downloads.spigot.sha256 },
    { path: 'plugins/ViaVersion.jar', name: `ViaVersion ${via.tag_name}`, url: viaJar.browser_download_url, sha256: viaJar.digest.slice(7) }
  ] };
}
export async function setupServer({ acceptEula = false, interactive = false, update = false, prepareOnly = false, log = console.log } = {}) {
  if ((process.env.MC_VERSION || VERSION) !== VERSION) throw new Error(`This tested server setup is pinned to ${VERSION}; set MC_VERSION=${VERSION}.`);
  if (!prepareOnly) await requireEula(SERVER_DIR, { accept: acceptEula, interactive });
  let manifest;
  try { manifest = JSON.parse(await readFile(join(SERVER_DIR, 'manifest.json'), 'utf8')); } catch { /* First setup */ }
  if (!manifest || update) manifest = await resolveDownloads();
  if (manifest.version !== VERSION) throw new Error('Existing server version differs. Back up your world before changing Minecraft versions.');
  for (const file of manifest.files) {
    log(`Checking ${file.name}...`);
    await downloadVerified(file.url, join(SERVER_DIR, file.path), file.sha256);
  }
  await writeFile(join(SERVER_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeServerConfig();
  const java = await findJava().catch(() => installJava(log));
  log(`Ready: Java ${java.major}, Minecraft ${VERSION}, Java 127.0.0.1:${process.env.MC_PORT || 25565}, Bedrock 127.0.0.1:${process.env.BEDROCK_PORT || 19132}.`);
  return { manifest, java };
}
export async function spawnServer({ directory = SERVER_DIR, java, pipe = false } = {}) {
  await requireEula(directory);
  const executable = java || (await findJava()).path;
  const memory = process.env.MC_SERVER_MEMORY || '2G';
  if (!/^\d+[MG]$/i.test(memory)) throw new Error('MC_SERVER_MEMORY must look like 2G or 2048M.');
  const child = spawn(executable, ['-Xms512M', `-Xmx${memory}`, '-Dterminal.jline=false', '-Dterminal.ansi=false', '-jar', join(SERVER_DIR, 'server.jar'), 'nogui'], { cwd: directory, windowsHide: true, stdio: ['pipe', pipe ? 'pipe' : 'inherit', pipe ? 'pipe' : 'inherit'] });
  child.stdin.on('error', () => {});
  return child;
}
export function stopServer(child, timeoutMs = 20000) {
  return new Promise(resolveStop => {
    if (child.exitCode !== null || child.signalCode) return resolveStop();
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolveStop(); });
    child.stdin.write('stop\n');
  });
}
async function main() {
  const command = process.argv[2] || 'start';
  const acceptEula = process.argv.includes('--accept-eula');
  if (!['setup', 'start', 'prepare', 'update-bridge'].includes(command)) throw new Error('Usage: node scripts/server.js [setup|start|prepare|update-bridge] [--accept-eula]');
  if (command !== 'start') {
    await setupServer({ acceptEula, interactive: true, update: command === 'update-bridge', prepareOnly: command === 'prepare' });
    if (command === 'prepare') console.log(`Downloads prepared. Starting Minecraft still requires your acceptance of ${EULA_URL}.`);
    return;
  }
  await requireEula(SERVER_DIR, { accept: acceptEula, interactive: true });
  if (!await exists(join(SERVER_DIR, 'server.jar'))) await setupServer();
  await writeServerConfig();
  const child = await spawnServer();
  // Keep the console pipe writable when launched by a supervisor without stdin.
  // SIGTERM/SIGINT can still send Minecraft's saving `stop` command afterward.
  process.stdin.pipe(child.stdin, { end: false });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('\nSaving the Minecraft world and stopping...');
    process.stdin.unpipe(child.stdin);
    process.stdin.pause();
    void stopServer(child);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; process.stdin.pause(); });
  child.once('exit', code => { process.stdin.unpipe(child.stdin); process.stdin.pause(); process.exitCode = code || 0; });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
