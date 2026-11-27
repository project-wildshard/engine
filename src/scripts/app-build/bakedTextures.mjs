import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Every declared image mode is a supported path, including the native
 * compressed-texture probe's image fallback. Check all tiers before bundling
 * and again after output publication, independently of the build machine GPU.
 * Standalone shardfiles SF11: no pin publishes a zone's mounts, so a file the zone carries in its own mounts
 * (a `cook.json` mount row, under `mounts/` or over a blob, read through its cook) counts as present; the engine's own
 * files must be published.
 * @param {string} root @param {string} publication */
export function checkBakedTextures(root, publication) {
  const products = resolve(root, 'out'), publicRoot = resolve(publication);
  /** @type {Map<string, Set<string>>} the declared URL and the product folders whose mounts may carry it */
  const declared = new Map();
  if (!existsSync(products)) return 0;
  for (const entry of readdirSync(products, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const discovery = join(products, entry.name, 'mounts/shardfiles', entry.name, 'discovery.json');
    if (!existsSync(join(products, entry.name, 'shard.json')) || !existsSync(discovery)) continue;
    /** @type {{rows?: {bootBindings?: unknown}, native?: {ktx2?: unknown}}} */
    const document = JSON.parse(readFileSync(discovery, 'utf8'));
    const pending = [{value: document.rows?.bootBindings, modelsOnly: false}, {value: document.native?.ktx2, modelsOnly: true}];
    while (pending.length > 0) {
      const current = pending.pop();if (current === undefined) break;
      const item = current.value, value = typeof item === 'string' ? item.split('#')[0] : item;
      if (typeof value === 'string' && (!current.modelsOnly && /^\/assets\/.+\.(?:png|jpe?g|webp|hdr|avif)$/u.test(value)
        || /^\/assets\/.+\.(?:glb|gltf)$/u.test(value) && !value.startsWith('/assets/gpu/') && !value.includes('/astc6/')
        || !current.modelsOnly && /^\/assets\/(?:gpu\/)?baked\/[^/]+\/.+\.ktx2$/u.test(value))) declared.set(value, (declared.get(value) ?? new Set()).add(entry.name));
      else if (Array.isArray(value)) pending.push(...value.map(child => ({value: child, modelsOnly: current.modelsOnly})));
      else if (value !== null && typeof value === 'object') pending.push(...[...Object.keys(value), ...Object.values(value)].map(child => ({value: child, modelsOnly: current.modelsOnly})));
    }
  }
  // A zone's own file is a row of its `cook.json` mounts, under `mounts/` or over one of its blobs (an images-only upload).
  /** @type {Map<string, Set<string>>} */
  const carried = new Map();
  const ownMount = (/** @type {string} */ owner, /** @type {string} */ url) => {
    let urls = carried.get(owner);
    if (urls === undefined) {
      const cook = join(products, owner, 'cook.json');
      /** @type {{mounts?: {url?: unknown, path?: unknown}[]}} */
      const data = existsSync(cook) ? JSON.parse(readFileSync(cook, 'utf8')) : {};
      urls = new Set((data.mounts ?? []).flatMap(row => typeof row.url === 'string' && typeof row.path === 'string'
        && !row.path.split('/').includes('..') && existsSync(join(products, owner, row.path)) ? [row.url] : []));
      carried.set(owner, urls);
    }
    return urls.has(url);
  };
  const missing = [];
  for (const [url, owners] of declared) {
    const file = resolve(publicRoot, `.${url}`);
    if (!file.startsWith(publicRoot + sep) || url.split('/').some(part => part === '.' || part === '..')) throw new Error(`Invalid baked texture declaration: ${url}`);
    const present = (/** @type {string} */ path) => existsSync(path) && statSync(path).isFile();
    if (!present(file) && ![...owners].some(owner => ownMount(owner, url))) missing.push(url);
  }
  if (missing.length > 0) throw new Error(`Declared boot image/baked textures absent from ${publicRoot} (all tiers/modes):\n${missing.sort().join('\n')}`);
  return declared.size;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? '.');
  console.log(`baked textures: ${checkBakedTextures(root, resolve(process.argv[3] ?? join(root, 'public')))} declarations complete across all tiers/modes`);
}
