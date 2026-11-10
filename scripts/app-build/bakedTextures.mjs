import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Every declared texture mode is a supported path, including the native
 * compressed-texture probe's image fallback. Check all tiers before bundling
 * and again after output publication, independently of the build machine GPU.
 * @param {string} root @param {string} publication */
export function checkBakedTextures(root, publication) {
  const products = resolve(root, 'out'), publicRoot = resolve(publication);
  /** @type {Set<string>} */
  const declared = new Set();
  if (!existsSync(products)) return 0;
  for (const entry of readdirSync(products, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const discovery = join(products, entry.name, 'mounts/shardfiles', entry.name, 'discovery.json');
    if (!existsSync(join(products, entry.name, 'shard.json')) || !existsSync(discovery)) continue;
    /** @type {{rows?: {bootBindings?: unknown}}} */
    const document = JSON.parse(readFileSync(discovery, 'utf8'));
    /** @type {unknown[]} */
    const pending = [document.rows?.bootBindings];
    while (pending.length > 0) {
      const value = pending.pop();
      if (typeof value === 'string' && /^\/assets\/(?:gpu\/)?baked\/[^/]+\/.+\.(?:png|jpe?g|webp|ktx2|hdr|avif)$/u.test(value)) declared.add(value);
      else if (Array.isArray(value)) pending.push(...value);
      else if (value !== null && typeof value === 'object') pending.push(...Object.values(value));
    }
  }
  const missing = [];
  for (const url of declared) {
    const file = resolve(publicRoot, `.${url}`);
    if (!file.startsWith(publicRoot + sep) || url.split('/').includes('..')) throw new Error(`Invalid baked texture declaration: ${url}`);
    if (!existsSync(file) || !statSync(file).isFile()) missing.push(url);
  }
  if (missing.length > 0) throw new Error(`Declared baked textures absent from ${publicRoot} (all tiers/modes):\n${missing.sort().join('\n')}`);
  return declared.size;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? '.');
  console.log(`baked textures: ${checkBakedTextures(root, resolve(process.argv[3] ?? join(root, 'public')))} declarations complete across all tiers/modes`);
}
