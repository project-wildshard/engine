import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

/** Pin the admission and verified-transport boundary for durable verdicts.
 * Format owns schemas, parser and memory policy; shardfile admission consumes
 * them and boot/PWA own verified cache bytes. Gameplay and rendering outside
 * this boundary do not change a saved asset-validation verdict. */
export function shardfileValidationRevision(project = resolve(import.meta.dirname, '..')) {
  // An author's empty folder is no checkout: the verdict belongs to the tools they run.
  const root = existsSync(resolve(project, 'pnpm-lock.yaml')) ? project : resolve(import.meta.dirname, '..');
  // LS1 (J250): computed live everywhere, with no stamp file. An installed engine has no lockfile and no tests, so the
  // inputs are the exact dependency specs (format is pinned by commit) and the shipped sources below, never the lockfile,
  // the package version or a test: a release's version bump no longer moves it.
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const hash = createHash('sha256');
  hash.update('package.json').update('\0').update(JSON.stringify({ dependencies: pkg.dependencies ?? {}, overrides: pkg.pnpm?.overrides ?? {} })).update('\0');
  /** @param {string} directory */
  const visit = directory => {
    // Code-unit order and `/` separators (Codex J206 MUST-FIX): an installed engine on any OS or locale hashes the
    // same bytes as the checkout that published it.
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|json)$/u.test(entry.name) && !entry.name.includes('.generated.') && !/\.(?:test|proof)\./u.test(entry.name)) hash.update(relative(root, path).split(sep).join('/')).update('\0').update(readFileSync(path)).update('\0');
    }
  };
  for (const source of ['src/client/game/shardfile', 'src/shared/game/shardfile', 'src/server/game/shardfile', 'src/client/engine/boot', 'src/shared/engine/boot', 'src/client/engine/pwa']) if (existsSync(resolve(root, source))) visit(resolve(root, source));
  return hash.digest('hex');
}
