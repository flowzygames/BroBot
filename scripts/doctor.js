import net from 'node:net';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { supportedNode } from './launch.js';
import { loadConfig } from '../src/config.js';
import { findJava, exists, eulaAccepted, SERVER_DIR, VERSION } from './server.js';

const run = promisify(execFile);
export function nodeVersionReport(version = process.versions.node) {
  const ok = supportedNode(version);
  return { ok, message: `${ok ? 'OK' : 'FAIL'} Node ${version}${ok ? '' : ' — install Node 22.9 or newer'}` };
}
export function pingTcp(host, port, timeout = 2000) {
  return new Promise(resolvePing => {
    const socket = net.connect({ host, port });
    const finish = result => { socket.destroy(); resolvePing(result); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
export function pingBedrock(host = '127.0.0.1', port = 19132, timeout = 3000) {
  return new Promise(resolvePing => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(33);
    packet[0] = 0x01;
    packet.writeBigInt64BE(BigInt(Date.now()), 1);
    Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex').copy(packet, 9);
    packet.writeBigInt64BE(123456789n, 25);
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolvePing(result);
    };
    const timer = setTimeout(() => finish(null), timeout);
    socket.on('error', () => finish(null));
    socket.on('message', message => {
      if (message[0] !== 0x1c || message.length < 35) return;
      const text = message.subarray(35, 35 + message.readUInt16BE(33)).toString('utf8');
      const fields = text.split(';');
      finish({ edition: fields[0], motd: fields[1], protocol: fields[2], version: fields[3] });
    });
    socket.send(packet, port, host, error => { if (error) finish(null); });
  });
}
export async function doctor(log = console.log) {
  let config;
  try { config = loadConfig(); } catch (error) { log(`FAIL Configuration: ${error.message}`); return false; }
  const { minecraft, ai } = config;
  const bedrockPort = Number(process.env.BEDROCK_PORT || 19132);
  if (!Number.isInteger(bedrockPort) || bedrockPort < 1024 || bedrockPort > 65535) { log('FAIL BEDROCK_PORT must be an integer from 1024 to 65535.'); return false; }
  const memory = JSON.parse(await readFile(join(config.dataDir, 'memory.json'), 'utf8').catch(() => '{}'));
  const owner = typeof memory.owner === 'string' ? memory.owner : minecraft.owner;
  const nodeReport = nodeVersionReport();
  const nodeOk = nodeReport.ok;
  log(nodeReport.message);
  let javaOk = true;
  try { const java = await findJava(); log(`OK Java ${java.major}: ${java.path}`); }
  catch (error) { javaOk = false; log(`FAIL ${error.message}`); }
  log(`${minecraft.version === VERSION ? 'OK' : 'WARN'} Minecraft bot protocol: ${minecraft.version}; prepared server: ${VERSION}`);
  log(`INFO Minecraft target: ${minecraft.host}:${minecraft.port}, account ${minecraft.username} (${minecraft.auth})`);
  log(`INFO Owner controls: ${owner ? `restricted to ${owner}` : 'disabled until the owner is set in the dashboard or MC_OWNER'}`);
  log(`INFO OpenAI key: ${ai.apiKey ? 'present (value hidden)' : 'missing; direct commands still work'}. Model: ${ai.model}`);
  log(`INFO EULA: ${await eulaAccepted() ? 'accepted in .server/eula.txt' : 'not accepted; run npm run server:setup and review the prompt'}`);
  const manifest = JSON.parse(await readFile(join(SERVER_DIR, 'manifest.json'), 'utf8').catch(() => 'null'));
  if (manifest) for (const file of manifest.files) log(`${await exists(join(SERVER_DIR, file.path)) ? 'OK' : 'FAIL'} ${file.name}`);
  else log('WARN Server files are not prepared; run npm run server:setup.');
  const [javaListening, bedrock] = await Promise.all([pingTcp(minecraft.host, minecraft.port), pingBedrock('127.0.0.1', bedrockPort)]);
  log(`${javaListening ? 'OK' : 'INFO'} Java TCP ${javaListening ? 'accepts connections' : 'not listening; start with npm run server'}`);
  log(`${bedrock ? 'OK' : 'INFO'} Bedrock ${bedrock ? `replied: ${bedrock.version} (protocol ${bedrock.protocol})` : 'not responding; start the server and wait for Geyser to finish loading'}`);
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('CheckNetIsolation.exe', ['LoopbackExempt', '-s'], { windowsHide: true, timeout: 5000 });
      const exempt = /microsoft\.minecraftuwp_8wekyb3d8bbwe/i.test(stdout);
      log(`${exempt ? 'OK' : 'WARN'} Minecraft for Windows loopback exemption ${exempt ? 'is enabled' : 'was not found'}.`);
      if (!exempt) log('If Bedrock cannot join 127.0.0.1, run this once in an Administrator terminal: CheckNetIsolation.exe LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"');
    } catch { log('INFO Windows loopback check unavailable. See https://geysermc.org/wiki/geyser/fixing-unable-to-connect-to-world/'); }
  }
  log(`JOIN Minecraft for Windows → Play → Servers → Add server: BroBot, 127.0.0.1, port ${process.env.BEDROCK_PORT || 19132}. No router port forwarding is needed.`);
  return nodeOk && javaOk;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) doctor().then(ok => { if (!ok) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
