// SHARD-COMPAT LS1/LS9: the three boot stamps gen:inputs writes from the installed pins (src/scripts/app-build/gen.ts) are
// build outputs, ignored by Git and never committed, so gen:inputs leaves `git status` clean in any checkout and land
// has nothing to commit. A checkout that has never run gen:inputs (a fresh clone, a worktree past the untracking commit)
// writes them from the build, test, typecheck and lint entry points. Git tag consumers install without a build hook.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const BOOT_STAMPS = Object.freeze([
  'src/client/game/boot/audio.generated.ts',
  'src/client/game/boot/bytes.generated.ts',
  'src/client/game/boot/versions.generated.ts',
]);

/** Write the boot stamps with gen:inputs when any is missing; a checkout that has them is left alone.
 * @param {string} [root] @returns {boolean} whether gen:inputs ran */
export function ensureBootStamps(root = process.cwd()) {
  if (BOOT_STAMPS.every(path => existsSync(join(root, path)))) return false;
  const ran = spawnSync(process.execPath, ['src/scripts/gen.mjs', '--inputs-only'], { cwd: root, stdio: 'inherit' });
  if (ran.status !== 0) throw new Error(`gen:inputs exited ${String(ran.status)} writing the boot stamps (${BOOT_STAMPS.join(', ')})`);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) ensureBootStamps();
