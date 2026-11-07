/** DL22: the level files a boot reads before control that its spawn set did not carry (Pine's late models and props
 * tiles, recorded by a cold boot), kept by a stable identity so the list survives content edits: a props tile file by its
 * tile and slot, a file a section names by that section path (`ref:`), a file with a plain authored name by its name. A
 * name that carries a content hash is not stable (it changes with the bytes, sp-x8's review), so a recording keys such a
 * file by its section reference. The build maps identities back to the current hashes and refuses one it cannot resolve. */
export interface FenceReads {readonly version: 1; readonly files: readonly string[]}
interface IndexFile {readonly hash: string; readonly path?: string; readonly name?: string}
interface PropsTile {readonly lod: number; readonly x: number; readonly z: number; readonly file: string; readonly additionalFiles?: readonly string[]}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A name without a content hash in it (8+ hex digits) stays the same when the file's bytes change. */
const stableName = (name: string): boolean => !/[a-f0-9]{8,}/u.test(name);
function propsTiles(sections: ReadonlyMap<string, unknown>): readonly PropsTile[] {
  const section = sections.get('world/props'), props = object(section) ? section['props'] : undefined, tiles = object(props) ? props['tiles'] : undefined;
  if (!Array.isArray(tiles)) return [];
  return tiles.filter((row: unknown): row is PropsTile => object(row) && typeof row['file'] === 'string' && typeof row['lod'] === 'number'
    && typeof row['x'] === 'number' && typeof row['z'] === 'number');
}
const tileSlots = (tile: PropsTile): readonly (readonly [string, string])[] =>
  [[`props-tile:${tile.lod}/${tile.x}/${tile.z}:file`, tile.file], ...(tile.additionalFiles ?? []).map((hash, at) => [`props-tile:${tile.lod}/${tile.x}/${tile.z}:${at}`, hash] as const)];
/** Every identity each file has in this product, best first: props tile slots, plain names, section references. A file
 *  several rows name has several identities (sp-x8: an alias must still resolve when its sibling changes). */
export function fenceReadIdentities(files: readonly IndexFile[], sections: ReadonlyMap<string, unknown>): ReadonlyMap<string, readonly string[]> {
  const identities = new Map<string, string[]>(), add = (hash: string, identity: string): void => {
    const list = identities.get(hash) ?? []; if (!list.includes(identity)) list.push(identity); identities.set(hash, list);
  };
  for (const tile of propsTiles(sections)) for (const [identity, hash] of tileSlots(tile)) add(hash, identity);
  for (const file of files) if (file.name !== undefined && stableName(file.name)) add(file.hash, `name:${file.name}`);
  // A section names a file by its hash, path or name: each first place is a `ref:` identity.
  const byText = new Map<string, string>();
  for (const file of files) for (const text of [file.hash, file.path, file.name]) if (text !== undefined) byText.set(text, file.hash);
  // The path is a JSON Pointer (RFC 6901: '~' -> '~0', '/' -> '~1'), so a key 'a.b' and a.b never collide (sp-x8's
  // review). An array index is part of the path: reordering rows changes the identity, and the build refuses it as stale.
  const segment = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
  const walk = (value: unknown, at: string): void => {
    if (typeof value === 'string') { const hash = byText.get(value); if (hash !== undefined) add(hash, `ref:${at}`); return; }
    if (Array.isArray(value)) { value.forEach((item: unknown, row) => { walk(item, `${at}/${row}`); }); return; }
    if (object(value)) for (const [key, item] of Object.entries(value)) walk(item, `${at}/${segment(key)}`);
  };
  for (const [name, value] of sections) walk(value, `${name}:`);
  // A name with a content hash still resolves (lists recorded before it was skipped), last: when the bytes change the
  // name goes, and the build refuses the stale entry instead of quietly fetching it on demand again.
  for (const file of files) if (file.name !== undefined && !stableName(file.name)) add(file.hash, `name:${file.name}`);
  return identities;
}
/** The current hashes of a recorded list's identities, and the identities this product no longer has. */
export function resolveFenceReads(reads: FenceReads, files: readonly IndexFile[], sections: ReadonlyMap<string, unknown>): {readonly hashes: ReadonlySet<string>; readonly unresolved: readonly string[]} {
  const byIdentity = new Map<string, string>();
  for (const [hash, identities] of fenceReadIdentities(files, sections)) for (const identity of identities) if (!byIdentity.has(identity)) byIdentity.set(identity, hash);
  const hashes = new Set<string>(), unresolved: string[] = [];
  for (const identity of reads.files) { const hash = byIdentity.get(identity); if (hash === undefined) unresolved.push(identity); else hashes.add(hash); }
  return {hashes, unresolved};
}
/** The identity a recording keeps for a file: its first (most stable) one. */
export function fenceReadIdentity(identities: ReadonlyMap<string, readonly string[]>, hash: string): string | undefined { return identities.get(hash)?.[0]; }
/** Every identity a recording keeps for a file, so a later split of a shared file (two rows naming one hash) leaves an
 *  entry that no longer resolves to the same file, and the build refuses it as stale (sp-x8's review). */
export function fenceReadAliases(identities: ReadonlyMap<string, readonly string[]>, hash: string): readonly string[] { return identities.get(hash) ?? []; }
/** A file's content digests (hex: sha1, sha256), read from its bytes; a name's hash must match one to be stripped. */
export type AssetDigests = (path: string) => readonly string[];
/** A `/assets` file's path without its content hash or version query: `/assets/sfx/best/bed-forest-2-0cd11be5.m4a` →
 *  `/assets/sfx/best/bed-forest-2.m4a` (0cd11be5 is the file's sha1), `/assets/gpu/x/rifle.phone-fd73a325.glb` →
 *  `/assets/gpu/x/rifle.phone.glb` (its sha256). A suffix is a hash only when the file's own bytes say so, never by its
 *  shape: `forest-2` is a name (sp-x1, wildshard-new). Without digests nothing is stripped. */
export function assetStem(url: string, digests: AssetDigests = () => []): string {
  const path = url.split('?')[0] ?? url, at = path.lastIndexOf('/'), name = path.slice(at + 1);
  const match = /[-.]([a-f0-9]{8,})(?=\.[a-z0-9]+$)/u.exec(name), hash = match?.[1];
  if (match === null || hash === undefined || !digests(path).some(digest => digest.startsWith(hash))) return path;
  return path.slice(0, at + 1) + name.slice(0, match.index) + name.slice(match.index + match[0].length);
}
/** A stem is no identity when its name is still a hash: a pure-hash basename (`cabin-materials/<64 hex>.glb`, sp-x8) or
 *  a hex run its bytes did not confirm (refused, never guessed). A bundler file is named by its source instead. */
function stableStem(stem: string): boolean {
  const name = stem.slice(stem.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/u, '');
  return name !== '' && !/[a-f0-9]{8,}/u.test(name);
}
/** Every place the sections name each of `paths` (JSON Pointers `ref:<section>:<pointer>`), in section order, so a file
 *  two rows share keeps both aliases and a later split is stale, not silently dropped (sp-x8's review). */
export function sectionRefs(sections: ReadonlyMap<string, unknown>, paths: ReadonlySet<string>): ReadonlyMap<string, readonly string[]> {
  const refs = new Map<string, string[]>(), segment = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
  const walk = (value: unknown, at: string): void => {
    if (typeof value === 'string') { const path = value.split('?')[0] ?? value; if (paths.has(path)) refs.set(path, [...refs.get(path) ?? [], `ref:${at}`]); return; }
    if (Array.isArray(value)) { value.forEach((item: unknown, row) => { walk(item, `${at}/${row}`); }); return; }
    if (object(value)) for (const [key, item] of Object.entries(value)) walk(item, `${at}/${segment(key)}`);
  };
  for (const [name, value] of sections) walk(value, `${name}:`);
  return refs;
}
/** DL22: the boot tables' audio manifests as a reference source (sfx sets and music styles: set → a definition naming
 *  its files, served at `/assets/<kind>/<set>/<file>`, audioFiles.ts). Each file is named by its slot in the table,
 *  `ref:boot-<kind>:/<set>/<JSON Pointer>`: two revisions of one clip (Pine's 8 stem collisions) are told apart by the
 *  slot that names the shipped one, which section references cannot do (sp-x1). */
export function audioTableRefs(tables: {readonly sfx?: unknown; readonly music?: unknown}): ReadonlyMap<string, readonly string[]> {
  const refs = new Map<string, string[]>(), segment = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
  for (const [kind, table] of [['sfx', tables.sfx], ['music', tables.music]] as const) {
    if (!object(table)) continue;
    for (const [set, definition] of Object.entries(table)) {
      const walk = (value: unknown, at: string): void => {
        if (typeof value === 'string') {
          if (!/^[^/?]+\.(?:m4a|mp3|ogg|opus|wav|webm|aac|flac)$/u.test(value)) return;
          const path = `/assets/${kind}/${set}/${value}`; refs.set(path, [...refs.get(path) ?? [], `ref:boot-${kind}:/${segment(set)}${at}`]); return;
        }
        if (Array.isArray(value)) { value.forEach((item: unknown, row) => { walk(item, `${at}/${row}`); }); return; }
        if (object(value)) for (const [key, item] of Object.entries(value)) walk(item, `${at}/${segment(key)}`);
      };
      walk(definition, '');
    }
  }
  return refs;
}
/** The bundler manifest (`.vite/manifest.json`: source key → {file}) as emitted non-code file → every source naming it.
 *  A vendor source (the key starts at the install root: `node_modules/…`, or above the project: `../../../../node_modules/
 *  .pnpm/three@0.186.0/node_modules/three/…`) is keyed by its package path, `node_modules/three/…`: the relative prefix and
 *  the store layout depend on where the build ran (a local mirror vs CI's checkout broke Pine's list on CI, 5591d76604).
 *  Any other key, even one with a `node_modules/` folder inside the project, keeps its project path (sp-x9). */
export function bundlerSources(manifest: unknown): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  if (!object(manifest)) return found;
  for (const [key, row] of Object.entries(manifest)) {
    const file = object(row) ? row['file'] : undefined;
    if (typeof file !== 'string' || /\.(?:js|mjs|css)$/u.test(file)) continue;
    // a vendor key's last `node_modules/` is its package (pnpm nests the store: .pnpm/<pkg@ver>/node_modules/<pkg>/…)
    const vendor = /^(?:\.\.\/)*node_modules\//u.test(key), at = key.lastIndexOf('/node_modules/');
    const source = !vendor ? key.replace(/^(?:\.\/)+/u, '') : at === -1 ? key.replace(/^(?:\.\.\/)+/u, '') : key.slice(at + 1);
    found.set(`/${file}`, [...found.get(`/${file}`) ?? [], source]);
  }
  return found;
}
/** DL11: the engine's KTX2 stand-in map (tier → authored source → the GPU file shipped for it, ktx2.generated.ts) as a
 *  reference source: each GPU file named by every authored source it stands in for, `ref:gpu-<tier>:/<source>`. Pine packs
 *  two variants of one texture set (`pine_bark/diffuse_1k.phone.webp` and its `#layer` array layer) whose stems collide;
 *  the source key tells them apart, and stays put when the bytes change. */
export function standInRefs(files: Readonly<Record<string, Readonly<Record<string, string>>>>): ReadonlyMap<string, readonly string[]> {
  const refs = new Map<string, string[]>(), segment = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');
  for (const [tier, map] of Object.entries(files)) for (const [source, file] of Object.entries(map)) {
    const path = file.split('?')[0] ?? file;
    refs.set(path, [...refs.get(path) ?? [], `ref:gpu-${tier}:/${segment(source)}`]);
  }
  return refs;
}
/** Each identity's files. An identity two distinct files share (two vendor versions under one package path, sp-x9) is
 *  ambiguous: the build refuses it and the recorder never records it; one file's own aliases are fine. */
export function identityFiles(identities: ReadonlyMap<string, readonly string[]>): ReadonlyMap<string, readonly string[]> {
  const files = new Map<string, string[]>();
  for (const [url, ids] of identities) for (const id of ids) { const list = files.get(id) ?? []; if (!list.includes(url)) list.push(url); files.set(id, list); }
  return files;
}
/** Reference maps joined: every identity each path has, in the order given. */
export function joinRefs(...maps: readonly ReadonlyMap<string, readonly string[]>[]): ReadonlyMap<string, readonly string[]> {
  const joined = new Map<string, string[]>();
  for (const map of maps) for (const [path, ids] of map) joined.set(path, [...joined.get(path) ?? [], ...ids]);
  return joined;
}
/** A boot asset table's pack parts (`packs`: bank → pack → {parts: [{url, files: [[path, …]]}]}): each part URL, its bank
 *  and pack, and the paths of its member files. */
export interface PackPart {readonly bank: string; readonly pack: string; readonly members: readonly string[]}
export function packMembers(packs: unknown): ReadonlyMap<string, PackPart> {
  const parts = new Map<string, PackPart>();
  if (!object(packs)) return parts;
  for (const [bank, named] of Object.entries(packs)) {
    if (!object(named)) continue;
    for (const [pack, def] of Object.entries(named)) {
      for (const row of object(def) && Array.isArray(def['parts']) ? def['parts'] : []) {
        if (!object(row) || typeof row['url'] !== 'string' || !Array.isArray(row['files'])) continue;
        const members = row['files'].flatMap((file: unknown) => Array.isArray(file) && typeof file[0] === 'string' ? [file[0]] : []);
        parts.set(row['url'], {bank, pack, members: [...parts.get(row['url'])?.members ?? [], ...members]});
      }
    }
  }
  return parts;
}
/** DL22 (Pine's 54.8 MB of `/assets` reads after its spawn download): each `/assets` URL's identities, or none (a
 *  recording refuses it). A pack part is named by its members, `asset-pack-member:<bank>:<pack>:<member stem>`, so a
 *  member a rebuild moves re-resolves to its new part and a gone one is stale. A part is refused when a member has no
 *  stable name: a stem that still carries a hash with no section reference, or a stem two members of its pack share (two
 *  revisions of one slot, in different parts). Any other file is `asset:<stem>` when its stem is hash-free and unique,
 *  else every place a section names it (`refs`). */
export function assetIdentities(urls: readonly string[], packs: ReadonlyMap<string, PackPart>, refs: ReadonlyMap<string, readonly string[]> = new Map(),
  files: {readonly digests?: AssetDigests; readonly sources?: ReadonlyMap<string, readonly string[]>} = {}): ReadonlyMap<string, readonly string[]> {
  const digests = files.digests ?? ((): readonly string[] => []), sources = files.sources ?? new Map<string, readonly string[]>();
  const stems = new Map<string, number>(), memberStems = new Map<string, number>();
  for (const url of urls) if (!packs.has(url.split('?')[0] ?? url)) { const stem = assetStem(url, digests); stems.set(stem, (stems.get(stem) ?? 0) + 1); }
  for (const part of packs.values()) for (const member of part.members) {
    const key = `${part.bank}:${part.pack}:${assetStem(member, digests)}`; memberStems.set(key, (memberStems.get(key) ?? 0) + 1);
  }
  const identities = new Map<string, readonly string[]>();
  for (const url of urls) {
    const path = url.split('?')[0] ?? url, part = packs.get(path), stem = assetStem(url, digests), source = sources.get(path);
    // the bundler's own files (`pine-hollow-C8hPt5PZ.jpg`): named by every source module the build's manifest maps to them,
    // so when a shared output splits, the source that changed no longer resolves to the unchanged peer (sp-x2's review)
    if (source !== undefined && source.length > 0) { identities.set(url, source.map(key => `asset-source:${key}`)); continue; }
    if (part !== undefined) {
      const named = part.members.map(member => {
        const memberStem = assetStem(member, digests), key = `${part.bank}:${part.pack}:${memberStem}`;
        if (stableStem(memberStem) && memberStems.get(key) === 1) return [`asset-pack-member:${key}`];
        // a member named by a reference is named inside its pack: its loose copy carries the same reference, and one name
        // for two files is ambiguous (Pine's rock_ground part was refused that way, DL11)
        const memberRefs = refs.get(member.split('?')[0] ?? member);
        return memberRefs === undefined ? null : memberRefs.map(id => `asset-pack-ref:${part.bank}:${part.pack}:${id}`);
      });
      if (named.length > 0 && named.every(ids => ids !== null && ids.length > 0)) identities.set(url, named.flatMap(ids => ids ?? []));
      continue;
    }
    if (stableStem(stem) && stems.get(stem) === 1) { identities.set(url, [`asset:${stem}`]); continue; }
    const named = refs.get(path);
    if (named !== undefined && named.length > 0) identities.set(url, named);
  }
  return identities;
}
/** A committed list, checked. */
export function readFenceReads(input: unknown): FenceReads {
  const files: unknown = object(input) ? input['files'] : undefined;
  if (!object(input) || input['version'] !== 1 || !Array.isArray(files) || files.length > 20_000
    || !files.every((row: unknown): row is string => typeof row === 'string'
      && /^(?:name:.+|ref:[^:]+:.+|props-tile:\d+\/\d+\/\d+:(?:file|\d+)|asset:\/assets\/[^?]+|asset-pack-member:[^:]+:[^:]+:\/assets\/[^?]+|asset-source:[^?:]+|asset-pack-ref:[^:]+:[^:]+:ref:.+)$/u.test(row))) throw new Error('Invalid fence reads');
  return {version: 1, files: [...new Set(files)].sort()};
}
