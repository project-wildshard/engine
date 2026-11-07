// Compile the real author project in plain Node, outside Vitest's simulated browser environment.
// oxlint-disable-next-line import/no-nodejs-modules -- Serialize immutable SDK assets for the native proof worker.
import { Buffer } from 'node:buffer';
import { readProjectAssets } from '../../../src/sharddev/project.ts';

const product = await readProjectAssets('src/shards/blender-template');
console.info(JSON.stringify({ shard: product.shard, assets: Object.fromEntries([...product.assets].map(([hash, bytes]) => [hash, Buffer.from(bytes).toString('base64')])) }));
