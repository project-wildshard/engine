// ZONE-SNAPSHOTS ZS9 (J507): tests read what players load. A live pin's files by logical name, read synchronously from
// the built product `pnpm pins` installed and checked (test/pins/shardfiles.json); never a frozen copy.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the installed live pin products.
import { readFileSync } from 'node:fs';
import { builtFolder } from '../../src/test/game/builtFolder';

type Entry = { name?: string; path: string; hash: string };
type Section = { name: string; path: string };
const products = new Map<string, { root: string; files: Map<string, string>; hashes: Map<string, string>; sections: Map<string, string> }>();
function product(slug: string) {
  let row = products.get(slug);
  if (row === undefined) {
    const root = builtFolder(slug), shard = JSON.parse(readFileSync(`${root}/shard.json`, 'utf8')) as { files: Entry[]; sections: Section[] };
    row = { root, files: new Map(shard.files.flatMap(file => file.name === undefined ? [] : [[file.name, file.path] as const])), hashes: new Map(shard.files.map(file => [file.hash, file.path])), sections: new Map(shard.sections.map(section => [section.name, section.path])) };
    products.set(slug, row);
  }
  return row;
}
/** A live pin's named file (`actors/sheep.json`, `behaviour/nalati.pasture.wasm`), fresh bytes on every read. */
export function liveBytes(slug: string, name: string): Uint8Array<ArrayBuffer> {
  const row = product(slug), path = row.files.get(name);
  if (path === undefined) throw new Error(`Live pin ${slug} names no file ${name}`);
  return new Uint8Array(readFileSync(`${row.root}/${path}`));
}
export function liveJson(slug: string, name: string): unknown {
  return JSON.parse(new TextDecoder().decode(liveBytes(slug, name)));
}
/** A live pin's platform section (`actors/return-scripts`). */
export function liveSection(slug: string, name: string): unknown {
  const row = product(slug), path = row.sections.get(name);
  if (path === undefined) throw new Error(`Live pin ${slug} has no section ${name}`);
  return JSON.parse(readFileSync(`${row.root}/${path}`, 'utf8'));
}
/** Every named file of a live pin. */
export function liveNames(slug: string): string[] { return [...product(slug).files.keys()]; }
/** A live pin's content-addressed file as a script row names it (`blobs/wasm/<hash>.wasm`), found by its hash. */
export function livePath(slug: string, path: string): Uint8Array<ArrayBuffer> {
  const hash = /^blobs\/[a-z0-9]+\/([0-9a-f]{64})\.[a-z0-9]+$/u.exec(path)?.[1], row = product(slug), file = hash === undefined ? undefined : row.hashes.get(hash);
  if (file === undefined) throw new Error(`Live pin ${slug} has no file ${path}`);
  return new Uint8Array(readFileSync(`${row.root}/${file}`));
}
/** A live pin's mounted file (`shardfiles/<slug>/discovery.json`), as the product mounts it. */
export function liveMount(slug: string, path: string): unknown {
  if (path.includes('..')) throw new Error(`Not a mount path: ${path}`);
  return JSON.parse(readFileSync(`${product(slug).root}/mounts/${path}`, 'utf8'));
}
