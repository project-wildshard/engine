// TEST-SPEED TS5 (J255): wind-elite-room was 26-31 s hosted.
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import { encounterRows } from '../../src/shared/engine/sim/encounterRows';
import { actRoutes } from '../../src/shared/engine/sim/actRoutes';
import { ELITE_MOMENTS, shardRows } from '../../src/shared/engine/sim/shardRows';
import type { SimHost } from '../../src/server/engine/sim';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../../src/server/host/headlessRuntime';
import { builtProduct } from './builtProduct';

// Qyran in a room: the page's wind law on a body the world raises, on the shipped product. His own save joins a world's, and an older one loads.

export const ADAPTER = 'nalati.patrol.wind';
export async function nalati(snapshot?: string) {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, snapshot, { room: true });
}
export const row = (host: SimHost) => {
  const read = encounterRows(host).get('encounter:qyran');
  if (read === undefined) throw new Error('No Qyran row');
  return read();
};
export const body = (host: SimHost) => { const found = [...host.entities.values()].find(actor => actor.kind === 'eagle'); return found ?? null; };
export const lead = (host: SimHost) => { const [first] = host.players.values(); if (first === undefined) throw new Error('No player'); return first; };
export const stand = (host: SimHost, x: number, z: number): void => { const player = lead(host), at = new Vector3(x, host.groundHeightAt(x, z) + .1, z); player.position.copy(at); player.motor.resetAt(at); };
export const storm = (host: SimHost): void => { actRoutes(host).climate?.({ op: 'force', name: 'storm', at: 0.1 }); };
export const words = (host: SimHost): string[] => shardRows(host).calls.splice(0).map(call => call.name === 'elite.moment:qyran' ? `${call.name}.${ELITE_MOMENTS[call.args[0] ?? -1] ?? '?'}` : call.name);
