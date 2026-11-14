import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The app publishes its data products, never their temporary TypeScript sources: each built product's folder under
 *  `<root>/out` (one with a shard.json) goes to `<outDir>/shardfiles`, without its runtime sources or its build key.
 *  `mounts/` and `cook.json` (C0, J137) are the cook's input: their files already serve at their public URLs, but for a
 *  discovery document and its art, which are served beside their product.
 *  The server class (J91, `<slug>/server/`) stays out of that tree, which is what a client reads. Standalone's server is a
 *  worker on the same device: it reads those files from its server pack (C2, `src/shared/game/shardfile/serverPack.ts`),
 *  which nothing precaches and no client manifest names.
 * @param {string} root @param {string} outDir */
export function copyOutputProducts(root, outDir) {
  const products = resolve(root, 'out'), shardfiles = resolve(outDir, 'shardfiles');
  rmSync(shardfiles, { recursive: true, force: true });
  if (!existsSync(products)) return;
  for (const entry of readdirSync(products, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const source = resolve(products, entry.name);
    if (!existsSync(resolve(source, 'shard.json'))) continue;
    cpSync(source, resolve(shardfiles, entry.name), { recursive: true, filter: path => basename(path) !== 'runtime' && basename(path) !== '.build-key' && !['server', 'mounts', 'cook.json'].includes(relative(source, path)) });
    // C3: the mounts a page reads by this folder's URL: a discovery document and the art of a product that packs none.
    const own = resolve(source, 'mounts/shardfiles', entry.name);
    if (existsSync(own)) cpSync(own, resolve(shardfiles, entry.name), { recursive: true });
    // S12d: the discovery document as the build's cook serves it (the phone tier's table), over the product's own.
    const served = resolve(products, '.app/discovery', entry.name, 'discovery.json');
    if (existsSync(served)) copyFileSync(served, resolve(shardfiles, entry.name, 'discovery.json'));
  }
}

/** A product's mounts serve from `public/` (`pins.ts install` publishes them), so a product dropped into `out/` by hand keeps
 *  whatever an older head left there. AUDIO AU7 re-encodes a recording under its old URL, so a new revision and its
 *  predecessor share URLs with different bytes: a preparation preview then serves the old head's audio, its manifests
 *  name the old hashes, and `wildshard prepare` records no audio in the new head's fence (meta QA 2026-11-13 row 34).
 *  Refuse a build whose `public/` copy of a product's mount differs from the product's own bytes; a missing copy is the
 *  cook's to refuse. Under 0.5 s over every pinned product.
 * @param {string} root @returns {number} the mounts checked */
export function checkPublishedMounts(root) {
  const products = resolve(root, 'out'), stale = [];
  if (!existsSync(products)) return 0;
  let checked = 0;
  for (const entry of readdirSync(products, { withFileTypes: true })) {
    const cook = resolve(products, entry.name, 'cook.json');
    if (!entry.isDirectory() || entry.name.startsWith('.') || !existsSync(cook)) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(cook, 'utf8')); } catch (error) { throw new Error(`out/${entry.name}/cook.json does not parse`, { cause: error }); }
    const { mounts } = /** @type {{mounts?: {url: string, hash: string}[]}} */ (parsed);
    for (const row of mounts ?? []) {
      const copy = resolve(root, `public${row.url}`);
      if (!/^\/(?:assets|programs)\/(?!.*(?:^|\/)\.\.(?:\/|$))/u.test(row.url) || !existsSync(copy)) continue;
      checked++;
      if (createHash('sha256').update(readFileSync(copy)).digest('hex') !== row.hash) stale.push(`${entry.name} ${row.url}`);
    }
  }
  if (stale.length > 0) throw new Error(`public/ holds ${stale.length} ${stale.length === 1 ? 'mount' : 'mounts'} with other bytes than their product in out/ `
    + `(${stale.slice(0, 3).join(', ')}): publish that product's mounts (node scripts/pins.ts install for a pin, or copy a candidate's `
    + 'mounts/ into public/), or remove its out/ folder if nothing pins it any more, and build again');
  return checked;
}

/** DL20: a level file leaves the deploy when a part holds it and nothing reads its URL directly. Every default manifest's file
 *  stays: a neighbour's rings and a road crossing read those by URL (G828, G1011; through parts each would cost a whole part),
 *  a title's `<img>` reads its art, and the harness's shardfile arm reads the same set. What goes is the rest of a whole-level
 *  set, which a home reads from its parts and a page past a crossing reads through them (`spawnDownload.ts`). A page reads
 *  only its own tier's parts, so a copy leaves when every tier that can read it holds it in one: a fenced shard's phone list is
 *  smaller than its desktop's, and what only the desktop's parts hold is still a phone's by URL (Pine's cabin specimens).
 *  @param {string} outDir @returns {{files: number, bytes: number}} */
export function pruneLooseCopies(outDir) {
  const spawn = resolve(outDir, 'assets/spawn'), kept = new Set();
  /** @type {{phone: Set<string>, desktop: Set<string>}} */
  const packed = { phone: new Set(), desktop: new Set() };
  const path = url => url.split('?')[0] ?? url;
  if (!existsSync(spawn)) return { files: 0, bytes: 0 };
  for (const name of readdirSync(spawn)) {
    const tier = /-(?:client|grid)-(phone|desktop)-[a-f0-9]{16}\.json$/u.exec(name)?.[1];
    if (tier === undefined) continue;
    const manifest = JSON.parse(readFileSync(join(spawn, name), 'utf8'));
    if (manifest.parts === undefined) { for (const file of manifest.files) kept.add(path(file.url)); continue; }
    for (const part of manifest.parts) {
      // A part homed on another origin (J138) has its own home; a file here is this deploy's only copy.
      if (!existsSync(resolve(outDir, `.${part.url}`))) continue;
      for (const [index] of part.members) (tier === 'phone' ? packed.phone : packed.desktop).add(path(manifest.files[index].url));
    }
  }
  let files = 0, bytes = 0;
  for (const url of new Set([...packed.phone, ...packed.desktop])) {
    // The same names `shardCook.ts` splits a mount's tiers by.
    const phoneOnly = /\.phone[.-]|\/astc6\//u.test(url), desktopOnly = /\.desktop[.-]/u.test(url);
    if ((!desktopOnly && !packed.phone.has(url)) || (!phoneOnly && !packed.desktop.has(url))) continue;
    // An image can be read by `<img>` (three's TextureLoader: Driftwood's desktop horizon), which no part layer answers.
    if (kept.has(url) || !url.startsWith('/shardfiles/') || /\.(?:png|jpe?g|webp|gif|avif|svg)$/u.test(url)) continue;
    const file = resolve(outDir, `.${url}`);
    if (!existsSync(file)) continue;
    bytes += statSync(file).size; files++;
    rmSync(file);
  }
  return { files, bytes };
}

/** Only the standard app config with Vite's normal, fresh output is eligible.
 * Custom configs, roots and retained output keep Vite's original copy path.
 * @param {string} root @param {string} outDir @param {string[]} args */
export function deferredPublicCopy(root, outDir, args) {
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) return false;
    const equals = arg.indexOf('='), key = equals === -1 ? arg : arg.slice(0, equals);
    if ((key !== '--mode' && key !== '--outDir') || seen.has(key)) return false;
    seen.add(key);
    if (equals === -1) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('-')) return false;
      index++; continue;
    }
    if (equals === arg.length - 1) return false;
  }
  const output = resolve(outDir), local = relative(resolve(root), output);
  const publicPath = resolve(root, 'public'), fromPublic = relative(publicPath, output);
  return local !== '' && local !== '..' && !local.startsWith(`..${sep}`)
    && !isAbsolute(local) && fromPublic !== '' && (fromPublic === '..' || fromPublic.startsWith(`..${sep}`))
    && !existsSync(join(output, '.git'));
}

/** Vite has emptied the managed output and emitted its bundle. Public files
 * fill the remaining paths, preserving the bundle's precedence on collisions.
 * The final product publisher replaces shardfiles, so its obsolete public copy
 * has no consumer. Keep publicDir enabled for Vite's URL resolution and indexing.
 * @param {string} root @param {string} outDir */
export function copyDeferredPublic(root, outDir) {
  const source = resolve(root, 'public'), destination = resolve(outDir);
  if (!existsSync(source)) return;
  // One directory enumeration avoids an existence syscall for every public file.
  const emitted = new Set(existsSync(destination)
    ? readdirSync(destination, {recursive: true, withFileTypes: true}).map(row => join(row.parentPath, row.name)) : []);
  /** @param {string} from @param {string} to @param {boolean} top */
  function copy(from, to, top) {
    mkdirSync(to, {recursive: true});
    for (const name of readdirSync(from)) {
      if (top && name === 'shardfiles') continue;
      const input = join(from, name), output = join(to, name);
      if (statSync(input).isDirectory()) copy(input, output, false);
      else if (!emitted.has(output)) copyFileSync(input, output);
      else if (!statSync(output).isFile()) throw new Error(`Public file collides with bundle directory: ${name}`);
    }
  }
  copy(source, destination, true);
}
