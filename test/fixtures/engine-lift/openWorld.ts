// oxlint-disable-next-line import/no-nodejs-modules -- Boots the shipped product bytes and physics module.
import { existsSync, readFileSync } from 'node:fs';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder';
import type { HeadlessRuntimeInput } from '../../../src/server/host/headlessRuntime';
import { builtFolder, runtimeAssets } from './folder';

export const openWorldPins: readonly string[] = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: readonly { slug: string }[] }).shards.map(pin => pin.slug);
const rapierBytes = readFileSync('public/assets/physics/rapier.wasm');

export async function loadOpenWorldInput(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtFolder(slug);
  if (!existsSync(directory)) throw new Error(`${slug} is pinned but not installed: pnpm pins`);
  const product = await loadHeadlessFolder(directory);
  return { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier: await loadRapier(rapierBytes) };
}
