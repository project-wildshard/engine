import { afterEach, expect, test, vi } from 'vitest';
import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import { defineModel, modelContext } from '../src/client/engine/models/model';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { WorldRegistry } from '../src/client/engine/world/registry';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { EncounterSites } from '../src/client/game/boss/encounterView';
import balbal from './fixtures/nalati-balbal-original.json' with { type: 'json' };

// A made-up orchard (the sites' fixture second user): guard statues on their plinths, every second one crowned.
const material = new MeshStandardMaterial();
const guard = defineModel<{ crowned: boolean }>({ id: 'orchard/guard', name: 'Guard', category: 'props', pipeline: 'code', file: 'test/encounter-sites.test.ts', defaults: { crowned: false },
  variants: [{ id: 'plain', label: 'Plain', params: { crowned: false } }, { id: 'crowned', label: 'Crowned', params: { crowned: true } }],
  build: () => [{ geometry: new BoxGeometry(1, 2, 1), material }] });
const orchard = { name: 'orchard-guard', label: 'Guard', file: 'test/encounter-sites.test.ts', surface: 'stone', variants: ['plain', 'crowned'], variantCycle: [0, 1],
  sink: 0.5, collider: { hw: 0.5, hd: 0.4, top: 2, bottom: 1 }, generated: balbal.generated,
  sites: [{ x: 1, z: 2, yaw: 0, scale: 1 }, { x: 4, z: 2, yaw: 1, scale: 2, tilt: 0.1 }, { x: 7, z: 2, yaw: 0, scale: 1 }] };

let restore = (): void => undefined;
afterEach(() => { restore(); vi.restoreAllMocks(); });

function sites(): EncounterSites { restore = bindFlatTerrain({ heightAt: () => 3 }); return new EncounterSites(orchard); }

test('a second shard\'s sites stand on the ground in their variant cycle, each a collider that sinks with its scale', () => {
  const view = sites();
  expect(view.sites.map(site => [site.variant, site.slot])).toEqual([[0, 0], [1, 0], [0, 1]]);
  expect(view.sites[1]).toMatchObject({ y: 2, tilt: 0.1, collider: { hw: 1, hd: 0.8, yTop: 6, yBottom: 1, rot: -1, ghost: true } });
  expect(view.colliders).toHaveLength(3);
});

test('placed instanced per variant; a waking site hides its copy and stops colliding until it is home', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);   // no generated asset is served in the test
  const view = sites(), registry = new WorldRegistry();
  const placed = view.place(guard, modelContext(null), registry, {} as SkyRig);
  view.register(registry);
  const plain = placed.object.getObjectByName('orchard/guard:plain:0') ?? (placed.object.name === 'orchard/guard:plain:0' ? placed.object : undefined);
  expect(plain).toBeInstanceOf(InstancedMesh);
  if (!(plain instanceof InstancedMesh)) throw new Error('Missing plain guards');
  const pieces = registry.pieces.filter(piece => piece.id.startsWith('orchard-guard-'));
  expect(pieces.map(piece => piece.id)).toEqual(['orchard-guard-0', 'orchard-guard-1', 'orchard-guard-2']);
  view.apply([{ index: 2, awake: 1 }]);
  expect(view.isAwake(2)).toBe(true); expect(pieces[2]?.active?.()).toBe(false); expect(pieces[0]?.active?.()).toBe(true);
  const copy = new Matrix4(); plain.getMatrixAt(1, copy);
  expect(new Vector3().setFromMatrixScale(copy).length()).toBe(0);
  view.apply([{ index: 2, awake: 0 }]);
  plain.getMatrixAt(1, copy); expect(new Vector3().setFromMatrixPosition(copy).toArray()).toEqual([7, 2.5, 2]); expect(pieces[2]?.active?.()).toBe(true);
});

test('sites refuse a variant cycle naming a variant they do not draw', () => {
  restore = bindFlatTerrain({ heightAt: () => 0 });
  expect(() => new EncounterSites({ ...orchard, variantCycle: [2] })).toThrow('variant');
});
