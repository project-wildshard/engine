// oxlint-disable-next-line import/no-nodejs-modules -- Exercise admitted products on their shipped native physics binary.
import { readFileSync } from 'node:fs';
import { beforeAll } from 'vitest';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type HeadlessRuntimeInput, type TrustedHeadlessResident } from '../../../src/server/host/headlessRuntime';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import type { snapshotSimHostBytes } from '../../../src/shared/engine/sim/snapshot';
import { actRoutes } from '../../../src/shared/engine/sim/actRoutes';
import type { HeadlessCommand } from '../../../src/shared/host/tickProtocol';
import { builtProduct, runtimeAssets } from './product';

export interface AdmittedResidents {
  input: (slug: string) => HeadlessRuntimeInput;
  open: (slug: string, saved?: ReturnType<typeof snapshotSimHostBytes>) => Promise<TrustedHeadlessResident>;
}

/** Admit each named product once per file, before its cases, through the same strict resident admission.
 * Keeps every earned native checkpoint without boxing each Rapier byte into a number array. */
export function admittedResidents(slugs: readonly string[]): AdmittedResidents {
  const products = new Map<string, HeadlessRuntimeInput>();
  beforeAll(async () => {
    const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
    for (const slug of slugs) {
      const directory = builtProduct(slug), product = await loadHeadlessProduct(directory);
      products.set(slug, { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier });
    }
  });
  const input = (slug: string): HeadlessRuntimeInput => { const value = products.get(slug); if (value === undefined) throw new Error('Missing admitted test product'); return value; };
  return { input, open: (slug, saved) => createTrustedHeadlessResident(input(slug), saved, { room: true }) };
}

export function step(live: TrustedHeadlessResident, ticks = 1, commands: readonly HeadlessCommand[] = []): void {
  for (let tick = 0; tick < ticks; tick++) live.step(tick === 0 ? commands : []);
}
export function press(live: TrustedHeadlessResident, id: string): void {
  const route = actRoutes(live.host).interactions.get(id);
  if (route === undefined) throw new Error(`No published interaction: ${id}`);
  step(live, 1, [{ kind: 'script', actorId: route.actorId, value: route.value }]);
}
