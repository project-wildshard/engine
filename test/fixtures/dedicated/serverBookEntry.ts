// E7.3d: a build's server book and parts, as an origin holds them, from built products, with the cook's own writer. `src/scripts/server-origin.mjs` runs it.
// GC15: and the grid pack the bake left in `--grid=<root>` (default this checkout), so a rig's road has its strips as staging's does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { cookGridPack } from '../../../src/cook/game/gridCollision';
import { cookShardServerPack } from '../../../src/cook/game/shardCook';
import { createPartEncoder, type PartEncoder } from '../../../src/cook/game/spawnParts';
import { serverPackBookPath } from '../../../src/shared/game/shardfile/serverPack';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder';

/** `--fast-encode`: Brotli quality 1 in this process, no shared cache. For a proof of what reads the packs, not of their
 *  wire size: the cook's q11 costs about 1 MB/s cold, and a CI test job holds no encode cache (C2: 33 MB, 83 s cold). */
function fastEncoder(): PartEncoder {
  let parts = 0, rawBytes = 0, wireBytes = 0;
  return { lanes: 1,
    encode: body => {
      const wire = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 1, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
      parts++; rawBytes += body.length; wireBytes += wire.length;
      return Promise.resolve(wire);
    },
    stats: () => ({ parts, rawBytes, wireBytes, encoded: parts }),
    close: () => Promise.resolve() };
}
const args = process.argv.slice(2), gridRoot = args.find(arg => arg.startsWith('--grid='))?.slice(7) ?? process.cwd();
const fast = args.includes('--fast-encode'), encoder = fast ? fastEncoder() : createPartEncoder(), packs: Record<string, unknown> = {};
const [out = 'tmp/origin', build = 'dev', ...shards] = args.filter(arg => !arg.startsWith('--grid=') && arg !== '--fast-encode');
for (const row of shards) {
  const [slug = '', folder = ''] = row.split('='), product = await loadHeadlessFolder(folder), header = readFileSync(join(folder, 'shard.json'));
  const index: unknown = JSON.parse(header.toString('utf8'));
  packs[slug] = await cookShardServerPack({ slug, index, source: product.shardfile, sections: new Map(), cook: undefined, header, read: (path: string) => new Uint8Array(readFileSync(join(folder, path))) } as never, out, encoder);
}
const grid = await cookGridPack(gridRoot, out, encoder);
await encoder.close(); // its workers would hold this process open
const book = join(out, serverPackBookPath(build));
mkdirSync(dirname(book), { recursive: true });
writeFileSync(book, JSON.stringify({ book: 'server', build, shards: packs, ...(grid === undefined ? {} : { grid }) }));
console.log(JSON.stringify({ book, shards: Object.keys(packs), grid: grid !== undefined }));
