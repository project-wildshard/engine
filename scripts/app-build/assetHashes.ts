/// <reference types="node" />
/**
 * Content hashes of the files under public/ (E160: "a deploy re-downloads only what changed").
 *
 * `hashTree(sub)` → `{ '/<sub>/<path>': '<sha256 hex, first 8>' }` for every file under public/<sub>. Memoised on path +
 * size + mtime, so vite.config.ts (the page's `?v=` table, `/asset-manifest.json`) and scripts/app-build/serviceWorker.ts (the static
 * cache's name) share one pass over the ~250 MB of art per process, and a rebuild re-reads only what changed.
 *
 * `contentNamed(path)`: a file whose NAME already carries its content hash — the boot packs
 * (`/assets/packs/<slug>.<tier>-<hash8>.bin`), the audio (`<name>-<sha1[:8]>.m4a`), `<name>-<hash8>.<ext>` and full
 * SHA-256 basenames (`<sha256>.<ext>`, the admitted named-blob contract)
 * (E157's KTX2). Such a URL is content-addressed as it stands: it gets no `?v=`, and the worker keeps it while the build
 * names it. The same rule lives in src/client/engine/pwa/sw.js (CONTENT_NAMED_RE) — keep the two in step.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export {CONTENT_NAMED_RE, contentNamed} from '../../src/cook/game/contentNamed.ts';

const memo = new Map<string, { key: string; hash: string }>();

/** sha256[:8] of one file, memoised on size + mtime */
function hashFile(abs: string): string {
  const st = statSync(abs);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = memo.get(abs);
  if (hit?.key === key) return hit.hash;
  const hash = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 8);
  memo.set(abs, { key, hash });
  return hash;
}

/** `/<sub>/…` → hash8 for selected files under `<root>/public/<sub>`.
 * Filtering happens before reading bodies; the default includes every file. */
export function hashTree(sub: string, root: string = process.cwd(), include: (path: string) => boolean = () => true): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, pub: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name === '.DS_Store') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${pub}/${name}`);
      else if (include(`${pub}/${name}`)) out[`${pub}/${name}`] = hashFile(p);
    }
  };
  walk(join(root, 'public', sub), `/${sub}`);
  return out;
}

/** Build-owned static keys, including files that browsers request without a version query. */
export function staticAssetHashes(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const sub of ['assets', 'basis', 'fonts']) Object.assign(hashes, hashTree(sub, root));
  for (const name of ['apple-touch-icon.png', 'favicon.png', 'icon-192.png', 'icon-512.png']) {
    const file = join(root, 'public', name);
    if (existsSync(file)) hashes[`/${name}`] = hashFile(file);
  }
  return hashes;
}
