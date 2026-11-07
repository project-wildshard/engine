// E7.3d: a build's server book and parts, as an origin holds them, from built products, with the cook's own writer. `scripts/server-origin.mjs` runs it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cookShardServerPack } from '../../../src/cook/game/shardCook';
import { createPartEncoder } from '../../../src/cook/game/spawnParts';
import { serverPackBookPath } from '../../../src/shared/game/shardfile/serverPack';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct';

const [out = 'tmp/origin', build = 'dev', ...shards] = process.argv.slice(2), encoder = createPartEncoder(), packs: Record<string, unknown> = {};
for (const row of shards) {
  const [slug = '', folder = ''] = row.split('='), product = await loadHeadlessProduct(folder), header = readFileSync(join(folder, 'shard.json'));
  const index: unknown = JSON.parse(header.toString('utf8'));
  packs[slug] = await cookShardServerPack({ slug, index, source: product.shardfile, sections: new Map(), cook: undefined, header, read: (path: string) => new Uint8Array(readFileSync(join(folder, path))) } as never, out, encoder);
}
await encoder.close(); // its workers would hold this process open
const book = join(out, serverPackBookPath(build));
mkdirSync(dirname(book), { recursive: true });
writeFileSync(book, JSON.stringify({ book: 'server', build, shards: packs }));
console.log(JSON.stringify({ book, shards: Object.keys(packs) }));
