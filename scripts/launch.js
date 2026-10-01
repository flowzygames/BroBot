// Friendly local entry point. No accounts, keys or EULA are configured silently.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function supportedNode(version) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) && (major > 22 || (major === 22 && minor >= 9));
}
export function launch({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), run = spawnSync, log = console.log, version = process.versions.node, platform = process.platform } = {}) {
  if (!supportedNode(version)) { log('BroBot needs Node.js 22.9 or newer. Install an LTS version from https://nodejs.org, then reopen this launcher.'); return 1; }
  const npm = args => {
    const result = run(platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit', shell: platform === 'win32', windowsHide: false });
    if (result.error) { log(`Could not run npm: ${result.error.message}. Check your Node.js installation.`); return 1; }
    return result.status ?? 1;
  };
  const lock = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex');
  const marker = join(root, 'node_modules', '.brobot-lock.sha256');
  const installed = existsSync(marker) && readFileSync(marker, 'utf8').trim() === lock && existsSync(join(root, 'node_modules', 'mineflayer', 'package.json'));
  if (!installed) {
    log('Installing the exact dependencies from the lockfile. This needs an internet connection.');
    const status = npm(['ci']); if (status) return status;
    writeFileSync(marker, lock + '\n');
  }
  if (!existsSync(join(root, '.env'))) { const status = npm(['run', 'setup']); if (status) return status; }
  log('Starting BroBot. Keep this window open; Ctrl+C saves and closes the local world.');
  log('The server setup will ask you to review the Minecraft EULA if needed.');
  return npm(['run', 'play']);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = launch(); } catch (error) { console.error(`BroBot could not start: ${error.message}`); process.exitCode = 1; }
}
