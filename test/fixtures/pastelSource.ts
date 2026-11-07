// oxlint-disable-next-line import/no-nodejs-modules -- Native fixtures read only authored source and remaining immutable art.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture input paths belong to this source project.
import { resolve } from 'node:path';
import { pastelTerrain } from '../../src/shards/pastel-plain/generators/terrain';
import { pastelProps } from '../../src/shards/pastel-plain/generators/props';
import { pastelProduct } from '../../src/shards/pastel-plain/generators/product';
import { compilePastelBehaviour, pastelBehaviourMetadata, PASTEL_BEHAVIOUR_INPUTS } from '../../src/shards/pastel-plain/generators/behaviour';
import { compileScript } from '../../src/sharddev/bake/compileScript';
import { bakeProps } from '../../src/sharddev/bake/props';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

const root = resolve('src/shards/pastel-plain');
const scripts = await compilePastelBehaviour({ compileScript }, new Map(PASTEL_BEHAVIOUR_INPUTS.map(file => [file, new Uint8Array(readFileSync(resolve(root, file)))])));
export const PASTEL_BEHAVIOUR = pastelBehaviourMetadata(scripts);
const produced = pastelTerrain(), fixture = pastelProps(20);
const generated = new Map([...produced.assets, ...[...scripts.values()].map(bytes => [hashImmutableBytes(bytes), bytes] as const)]);
/** Same source producers and actual compiled modules as the build entry; no generated metadata intake. */
export const PASTEL_SOURCE = (() => {
  try {
    const props = bakeProps(fixture.source), { assets: _assets, ...terrain } = produced;
    for (const [hash, bytes] of props.assets) generated.set(hash, bytes);
    return pastelProduct(terrain, props, PASTEL_BEHAVIOUR);
  } finally { fixture.dispose(); }
})();
/** Each native admission receives detached immutable bytes. */
export function pastelAssets(): Map<string, Uint8Array> {
  return new Map(PASTEL_SOURCE.files.map(file => [file.hash, new Uint8Array(generated.get(file.hash) ?? readFileSync(resolve(root, 'assets', file.hash)))]));
}
