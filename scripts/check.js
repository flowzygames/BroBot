import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else if (file.endsWith('.js')) result.push(file);
  }
  return result;
}
for (const file of [...await files('src'), ...await files('scripts'), ...await files('public'), ...await files('test')]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
const tests = await files('test');
const result = spawnSync(process.execPath, ['--test', ...tests.filter(file => file.endsWith('.test.js'))], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
