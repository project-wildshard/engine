import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** @param {string} script @param {string[]} args */
export async function underPhoneLocks(script, args) {
  const root = join(homedir(), 'projects/games/wildshard/engine/tmp');
  mkdirSync(root, { recursive: true });
  console.log('Waiting for iphone13.lock, then mini-measure.lock');
  const child = spawn('/usr/bin/lockf', [
    '-k', join(root, 'iphone13.lock'), '/usr/bin/lockf', '-k', join(root, 'mini-measure.lock'),
    process.execPath, script, ...args,
  ], { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  return code ?? (signal === 'SIGINT' ? 130 : 1);
}
