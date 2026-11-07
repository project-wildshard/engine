import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Material, Mesh, Vector3 } from 'three';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { Scope } from '@wildshard/engine/app/scope';
import type { ModelContext } from '@wildshard/engine/models/model';
import type { OwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { WorldAssembly } from './worldAssembly';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import type { FixedDraws } from '../models/fixedDraws';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

// G603: a drawn-models stage on a made-up orchard: its two signs drawn from the loaded fixed draws in one painterly look.
const tri = (x: number): BufferGeometry => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([x, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
const stage = (models: readonly { id: string; draw: string }[]) => ({ stages: [{ kind: 'drawn-models', id: 'orchard.signs', look: { painterly: { rim: 0.4 } }, models }] });
const signs = [{ id: 'north', draw: 'sign:north' }, { id: 'south', draw: 'sign:south' }];
function fixture(slots: Readonly<Record<string, number>>, ready = true) {
  const copies: BufferGeometry[] = [];
  const handle = vi.fn((slot: string): OwnedGeometry => {
    const x = slots[slot]; if (x === undefined) throw new Error(`Undeclared fixed draw: ${slot}`);
    return legacyDouble<OwnedGeometry>({ copy: () => { const geometry = tri(x); copies.push(geometry); return geometry; } });
  });
  const draws: FixedDraws = { ready, handle, load: () => Promise.resolve() }, scope = new Scope('orchard');
  return { scope, handle, copies, ports: { scope, context: legacyDouble<ModelContext>({ sky: legacyDouble<SkyRig>({ csm: legacyDouble<SkyRig['csm']>({ lights: [] }), sunDir: new Vector3(0, 1, 0), setupMaterial: () => undefined }) }), registry: null, draws, slice: vi.fn(() => Promise.resolve()) } };
}
const isMesh = (value: unknown): value is Mesh => value instanceof Mesh;

test('every model is a group holding its own draw copy in one shared material, published as one typed loan', async () => {
  const f = fixture({ 'sign:north': 3, 'sign:south': 5 });
  await WorldAssembly.admit(stage(signs), f.ports).next('orchard.signs');
  const models = entryOwner(f.scope, 'drawn-models', 'orchard.signs');
  expect([...models.keys()]).toEqual(['north', 'south']);
  const meshes = [...models.values()].map(group => { expect(group).toBeInstanceOf(Group); const mesh: unknown = group.children[0]; if (!isMesh(mesh)) throw new Error('Missing drawn mesh'); return mesh; });
  expect(meshes.map(mesh => mesh.geometry)).toEqual(f.copies);
  expect(f.copies.map(geometry => geometry.getAttribute('position').getX(0))).toEqual([3, 5]);
  const material: unknown = meshes[0]?.material;
  if (!(material instanceof Material)) throw new Error('Missing drawn material');
  expect(meshes[1]?.material).toBe(material);
  expect(f.ports.slice).not.toHaveBeenCalled();
  const disposed = vi.spyOn(material, 'dispose'), copies = f.copies.map(geometry => vi.spyOn(geometry, 'dispose'));
  f.scope.dispose();
  expect(disposed).toHaveBeenCalled(); for (const copy of copies) expect(copy).toHaveBeenCalled();
});

test('the whole bank is found before any copy; unloaded draws, a missing draw or repeated ids refuse', async () => {
  const missing = fixture({ 'sign:north': 3 });
  await expect(WorldAssembly.admit(stage(signs), missing.ports).next('orchard.signs')).rejects.toThrow('Undeclared fixed draw: sign:south');
  expect(missing.copies).toEqual([]);
  expect(() => entryOwner(missing.scope, 'drawn-models', 'orchard.signs')).toThrow();
  const unloaded = fixture({ 'sign:north': 3, 'sign:south': 5 }, false);
  await expect(WorldAssembly.admit(stage(signs), unloaded.ports).next('orchard.signs')).rejects.toThrow('loaded fixed draws');
  expect(unloaded.handle).not.toHaveBeenCalled();
  const first = signs[0];
  if (first === undefined) throw new Error('Missing sign');
  expect(() => WorldAssembly.admit(stage([first, { id: 'north', draw: 'sign:south' }]), missing.ports)).toThrow();
  expect(() => WorldAssembly.admit({ stages: [{ ...stage(signs).stages[0], build: 'callback' }] }, missing.ports)).toThrow();
  expect(() => WorldAssembly.admit({ stages: [{ ...stage(signs).stages[0], look: { painterly: { rim: 2 } } }] }, missing.ports)).toThrow();
});

test('a closed construction owner keeps nothing it made', async () => {
  const f = fixture({ 'sign:north': 3, 'sign:south': 5 });
  const assembly = WorldAssembly.admit(stage(signs), f.ports);
  f.scope.dispose();
  await expect(assembly.next('orchard.signs')).rejects.toThrow('owner left');
  expect(f.copies).toEqual([]);
});
