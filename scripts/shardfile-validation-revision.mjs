import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

/** Pin the admission and verified-transport boundary for durable verdicts.
 * Format owns schemas, parser and memory policy; shardfile admission consumes
 * them and boot/PWA own verified cache bytes. Gameplay and rendering outside
 * this boundary do not change a saved asset-validation verdict. */
export function shardfileValidationRevision(project = resolve(import.meta.dirname, '..')) {
  // An author's empty folder is no checkout: the verdict belongs to the tools they run.
  const root = existsSync(resolve(project, 'pnpm-lock.yaml')) ? project : resolve(import.meta.dirname, '..');
  // P4: an installed engine carries no lockfile, so sharddev reads the revision this release stamped (scripts/gen.mjs).
  if (!existsSync(resolve(root, 'pnpm-lock.yaml'))) return JSON.parse(readFileSync(resolve(root, 'scripts/validation-revision.json'), 'utf8')).revision;
  const hash = createHash('sha256');
  for (const name of ['package.json', 'pnpm-lock.yaml']) hash.update(name).update('\0').update(readFileSync(resolve(root, name))).update('\0');
  /** @param {string} directory */
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|json)$/u.test(entry.name) && !entry.name.includes('.generated.')) hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0');
    }
  };
  for (const source of ['src/client/game/shardfile', 'src/shared/game/shardfile', 'src/server/game/shardfile', 'src/client/engine/boot', 'src/shared/engine/boot', 'src/client/engine/pwa']) if (existsSync(resolve(root, source))) visit(resolve(root, source));
  return hash.digest('hex');
}
