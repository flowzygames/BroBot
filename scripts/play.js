import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVER_DIR, requireEula, setupServer, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';

let server, bot, timer, closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  bot?.kill('SIGTERM');
  if (server) { console.log('Saving the world…'); await stopServer(server); }
  process.exitCode = code;
  process.stdin.pause();
}
try {
  const port=Number(process.env.MC_PORT || 25565);
  if (await pingTcp('127.0.0.1',port)) throw new Error(`Port ${port} is already in use. If your BroBot server is already running, use npm start for just the bot.`);
  await requireEula(SERVER_DIR, {accept:process.argv.includes('--accept-eula'),interactive:true});
  const {java}=await setupServer();
  const log=createWriteStream(join(SERVER_DIR,'launcher.log'), {flags:'a'});
  console.log('Starting your local world. The first launch may take a minute.');
  server=await spawnServer({java:java.path,pipe:true});
  timer=setTimeout(()=>{console.error('Server startup timed out. See .server/launcher.log.');void shutdown(1);},180000);
  let tail='',started=false;
  const capture=chunk=>{
    log.write(chunk);tail=(tail+chunk.toString()).slice(-6000);
    if(!started&&/Done \([\d.]+s\)!/.test(tail)) {
      started=true;clearTimeout(timer);
      console.log(`\nWorld ready. Bedrock: 127.0.0.1:${process.env.BEDROCK_PORT || 19132}. Use Close BroBot, quit or Ctrl+C to save and stop.`);
      bot=spawn(process.execPath,['--env-file-if-exists=.env','src/index.js'],{cwd:ROOT,stdio:'inherit',windowsHide:true});
      bot.once('error',error=>{console.error(error.message);void shutdown(1);});
      bot.once('exit',code=>void shutdown(code || 0));
    }
  };
  server.stdout.on('data',capture);server.stderr.on('data',capture);
  server.once('error',error=>{console.error(error.message);void shutdown(1);});
  server.once('exit',code=>{log.end();if(!closing){console.error('Minecraft server stopped. See .server/launcher.log.');void shutdown(code || 1);}});
  process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
} catch(error) { console.error(error.message);await shutdown(1); }
