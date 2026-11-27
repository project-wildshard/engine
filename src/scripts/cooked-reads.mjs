// Fix preview PV6 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md; Jake, 2026-11-26 ~14:45: "the roads, the grid,
// that is still ENGINE ENGINE"): build-time reads of a zone's files from the cook instead of an installed pin. Each zone of a zone table
// (PV2) is opened through its index at the table's key; a page path (`/shardfiles/<slug>/…`, `/assets/<slug>/…`, `/programs/<slug>.json`)
// is read at the object key the index maps it to. The origin is the cooked bucket, or a `file:` folder laid out like it (a local cook,
// or `cooked-fixture.mjs`'s copy of the installed pins, for the byte-for-byte proof).
import {readFile} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {checkedCookedMember, COOKED_ORIGIN, cookedMemberAddresses, cookedObjectKey, readCookedIndexAddress} from '../shared/game/shardfile/cookedPackPaths.ts';
import {zoneRef} from '../shared/game/grid/zoneTable.ts';
import {agentFetch} from './agent-requests.mjs';

/** @typedef {import('../shared/game/grid/zoneTable.ts').ZoneTable} ZoneTable */

/** One object's bytes, or null for a 404. @param {string} url @returns {Promise<Uint8Array | null>} */
async function readObject(url) {
  if (url.startsWith('file:')) {
    try { return new Uint8Array(await readFile(new URL(url))); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  }
  const response = await agentFetch(url, {redirect: 'error', signal: AbortSignal.timeout(60_000)});
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Every zone of `table` opened at `origin`: `fetchFile` answers a page path from the zone that maps it (404 when none does), and
 * `header` names a zone's `shard.json` page path. A zone whose index is missing or not the table's refuses.
 * @param {ZoneTable} table @param {{origin?: string}} [options]
 * @returns {Promise<{fetchFile: (path: string) => Promise<Response>, header: (slug: string) => string | undefined, zones: number, objects: number}>}
 */
export async function cookedReader(table, {origin = COOKED_ORIGIN} = {}) {
  const root = origin.endsWith('/') ? origin : `${origin}/`;
  /** @type {Map<string, string>} */ const objects = new Map();
  /** @type {Map<string, import('../shared/engine/boot/tables.ts').CookedPartMember>} */ const members = new Map();
  /** @type {Map<string, string>} */ const headers = new Map();
  for (const row of table.zones) {
    const ref = zoneRef(table, row), body = await readObject(new URL(row.index, root).href);
    if (body === null) throw new Error(`No cooked index for ${row.slug} at ${row.index}`);
    const index = JSON.parse(new TextDecoder().decode(body)), address = readCookedIndexAddress(index);
    if (address.slug !== ref.slug || address.shardVersion !== ref.shardVersion || address.cookVersion !== ref.cookVersion || address.cookHash !== ref.cookHash) throw new Error(`${row.index} is not ${row.slug}'s index under the table's cook`);
    if (typeof index.header === 'string') headers.set(row.slug, `/${index.header}`);
    for (const [path, member] of cookedMemberAddresses(address, key => new URL(key, root).href)) {
      if (!members.has(path)) members.set(path, member);
    }
    for (const path of Object.keys(address.objects)) {
      const key = cookedObjectKey(ref, address.objects, path);
      if (key !== undefined && !objects.has(`/${path}`)) objects.set(`/${path}`, new URL(key, root).href);
    }
  }
  return {
    fetchFile: async path => {
      const pathname = decodeURIComponent(new URL(path, 'https://build.invalid/').pathname);
      const at = objects.get(pathname), member = members.get(pathname);
      if (at !== undefined) {
        const bytes = await readObject(at);
        return bytes === null ? new Response(null, {status: 404}) : new Response(bytes);
      }
      if (member === undefined) return new Response(null, {status: 404});
      const part = await readObject(member.part);
      if (part === null) return new Response(null, {status: 404});
      const decoded = member.part.startsWith('file:') ? brotliDecompressSync(part) : part;
      return new Response(await checkedCookedMember(decoded, member));
    },
    header: slug => headers.get(slug.replace(/^_/u, '')),
    zones: table.zones.length, objects: objects.size,
  };
}
