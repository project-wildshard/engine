// Engine's shard list for tests: the pinned products' discovery documents, as a page reads them. `pnpm pins` fills `out/`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shardFromDiscovery } from '@wildshard/engine/game/shard/discovery';

const products = resolve('out');
const documents = existsSync(products)
  ? readdirSync(products).map(name => join(products, name, 'mounts/shardfiles', name, 'discovery.json')).filter(file => existsSync(file))
  : [];
if (documents.length === 0) throw new Error('No pinned products in out/: run pnpm pins');

export const SHARDS = documents.map(file => shardFromDiscovery(JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof shardFromDiscovery>[0])).sort((a, b) => a.order - b.order);
