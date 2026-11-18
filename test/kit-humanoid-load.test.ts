import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Box3, Group, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { CREATURE_SKELETONS, MIN_VOLUME_RADIUS } from '@wildshard/format/creatureSkeletons';
import { parseGlbData } from '@wildshard/format/glbCost';
import { Scope } from '@wildshard/engine/app/scope';
import { AnimalFactory, DEFAULT_CREATURE_RENDER, type AnimalModel } from '@wildshard/engine/entities/AnimalFactory';
import { Animal } from '../src/client/engine/entities/AnimalView';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { NeighbourLife } from '../src/client/game/grid/neighbourLife';
import { loadClientSkins, skinSpeciesLook } from '../src/client/game/shardfile/clientSkins';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';
import { kitView } from './fixtures/kit-view';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm')), hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const original = new Uint8Array(readFileSync(new URL('./fixtures/kit-humanoid.glb', import.meta.url)));
const Doc = v.object({ nodes: v.array(v.object({ name: v.optional(v.string()) })), skins: v.array(v.object({ joints: v.array(v.number()) })) });
const length = new DataView(original.buffer).getUint32(12, true), doc = v.parse(Doc, JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + length))));
const joints = doc.skins[0]?.joints.map(index => doc.nodes[index]?.name);
const sockets = ['head', 'hand.L', 'hand.R', 'chest', 'back'];
const humanoidDims = { bodyY: .84, bodyHalfLen: .12, bodyRadius: .25, headRadius: .3082207035326514,
  legLen: .84, halfWidth: .25, feet: [[.14, .1], [-.14, .1]] as [number, number][] };

test.each([.5, 1, 2].flatMap(scale => sockets.map(socket => ({ scale, socket }))))('actual Kit humanoid loads at $scale through socket $socket', async ({ scale, socket }) => {
  const { source } = await creatureVolumeFixture(), species = source.rows.species[0], look = source.rows.looks[0];
  if (species === undefined || look === undefined) throw new Error('Missing normal fixture rows');
  species.body = { skeleton: 'biped', size: 'medium', scale, look: look.id, lock: [socket] };
  species.dims = humanoidDims;
  const glb = original.slice(), file = hash(glb), cost = parseGlbData(glb);
  expect(file).toBe('2aeff55167b63543bb4215842fafd439b89dc4fc5e3a4e42c3be4c1cbc955ddb');
  const metadata = new TextEncoder().encode(JSON.stringify({ row: { id: 'fixture.humanoid', file, family: 'pbr', cost,
    rig: { skeleton: 'kit.biped', joints: [joints], sockets: joints, clips: [] } },
    binding: { skin: 'fixture.humanoid', material: { family: 'pbr', vertexColours: true }, loops: [] } }));
  const skin = hash(metadata); look.parameters = { skin };
  source.files = [{ hash: file, kind: 'glb', compressed: glb.length, ...cost, dependencies: [], critical: false },
    { hash: skin, kind: 'json', compressed: metadata.length, decoded: metadata.length * 2, gpu: 0, triangles: 0, draws: 0, dependencies: [file], critical: false }];
  source.library = [skin];
  const assets = new Map([[file, glb], [skin, metadata]]), scope = new Scope('kit-humanoid-load');
  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  let view: Animal | undefined;
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor?.hitVolumes === undefined || actor.lockPoints === undefined) throw new Error('Missing actual humanoid body ports');
    const loaded = (await loadClientSkins(source, assets, () => new MeshStandardMaterial(), scope)).get(look.id);
    if (loaded === undefined) throw new Error('Missing actual loaded GLB');
    const definition = skinSpeciesLook(look, species, loaded), variant = { id: actor.variant, label: 'Humanoid', weight: 1, rarity: 'common' as const, scale: [1, 1] as [number, number], hp: 100 };
    const material = new MeshStandardMaterial(); scope.onDispose(() => material.dispose());
    const render = { ...DEFAULT_CREATURE_RENDER, waitForModels: false, furRim: false };
    const model: AnimalModel = { kind: actor.kind, variant: actor.variant, style: 'toon', render,
      species: { ...definition, kind: actor.kind, label: 'Humanoid', variants: [variant] }, variantDef: variant,
      geometry: loaded.geometry, bones: loaded.bones.map(bone => ({ name: bone.name, parent: bone.parent, pos: [...bone.pos] })),
      dims: species.dims, fur: material, hard: material, eye: material, shells: [] };
    // The CPU fixture omits renderer material setup; GLB loading, factory rig,
    // simulation binding, bones and scale all use their real production owners.
    const sky = { setupMaterial: (): void => undefined } as unknown as Sky;
    const factory = new AnimalFactory(sky, { style: 'toon', render }), rig = factory.instantiate(model);
    for (const owned of rig.materials) scope.onDispose(() => owned.dispose());
    view = new Animal(rig, model, actor.seed, 1, actor.entityId).bindSimulation(actor);
    expect(view.mesh.scale.toArray()).toEqual([scale, scale, scale]); expect(actor.scale).toBe(scale);
    view.mesh.updateMatrixWorld(true); view.mesh.skeleton.update();
    const bounds = new Box3().setFromObject(view.mesh, true), size = bounds.getSize(new Vector3());
    expect(size.y).toBeCloseTo(1.82 * scale, 5);
    expect(size.x).toBeCloseTo(1.03 * scale, 5);
    const points = new Map(loaded.bones.map(bone => [bone.name, new Vector3(...bone.pos)]));
    for (const [index, name] of actor.lockPoints.names.entries()) {
      const socket = CREATURE_SKELETONS.biped.sockets[name], bone = socket === undefined ? undefined : points.get(socket.bone);
      if (socket === undefined || bone === undefined) throw new Error('Missing defining socket');
      const expected = bone.clone().add(new Vector3(...socket.at)).multiplyScalar(scale).add(actor.position);
      expect(actor.lockPoints.point(index, new Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
      const rendered = rig.bones[socket.bone]; if (rendered === undefined) throw new Error('Missing actual view socket bone');
      const at = rendered.localToWorld(new Vector3(...socket.at));
      expect(at.clone().sub(view.mesh.position).distanceTo(expected.clone().sub(actor.position))).toBeLessThan(1e-6);
    }
    const rear = new Vector3(), front = new Vector3();
    for (const [index, volume] of actor.hitVolumes.volumes.entries()) {
      const contract = CREATURE_SKELETONS.biped.volumes.find(row => row.part === volume.part), bone = contract === undefined ? undefined : points.get(contract.bone);
      if (contract === undefined || bone === undefined) throw new Error('Missing actual default volume');
      expect(volume.radius).toBeCloseTo(Math.max(MIN_VOLUME_RADIUS, contract.radius * scale), 6);
      expect(volume.halfLength).toBeCloseTo(contract.halfLength * scale, 6);
      actor.hitVolumes.segment(index, rear, front);
      const centre = bone.clone().multiplyScalar(scale).add(actor.position);
      expect(rear.add(front).multiplyScalar(.5).distanceTo(centre)).toBeLessThan(1e-6);
    }
    expect(sim.host.entities.size).toBe(1); expect(glb).toEqual(original);
  } finally { view?.mesh.skeleton.dispose(); view?.mesh.removeFromParent(); sim.dispose(); scope.dispose(); }
});

test('the actual clipless biped swings alternating legs and returns to bind on idle', async () => {
  const f = await kitView(original, 'biped', humanoidDims, await rapier);
  try {
    const left = f.rig.bones['thigh.L'], right = f.rig.bones['thigh.R'];
    if (left === undefined || right === undefined) throw new Error('Missing canonical thighs');
    f.actor.levelGround = true;
    f.actor.speed = 1.5;
    f.actor.state = 'flee';
    const before = f.actor.snapshot();
    const swing: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      swing.push(left.rotation.x);
      expect(left.rotation.x + right.rotation.x).toBeCloseTo(0, 6);
    }
    expect(Math.min(...swing)).toBeLessThan(-.25);
    expect(Math.max(...swing)).toBeGreaterThan(.25);
    expect(f.actor.snapshot()).toEqual(before);
    f.actor.speed = 0;
    f.actor.state = 'idle';
    f.view.update(1 / 60, 2, true);
    expect(left.rotation.x).toBeCloseTo(0, 6);
    expect(right.rotation.x).toBeCloseTo(0, 6);
  } finally { f.dispose(); }
});

test('an owned biped walk clip takes the whole pose and returns to bind at the next idle', async () => {
  const walk = new Uint8Array(readFileSync(new URL('./fixtures/kit-biped-walk.glb', import.meta.url)));
  const f = await kitView(walk, 'biped', humanoidDims, await rapier);
  try {
    const left = f.rig.bones['thigh.L'], right = f.rig.bones['thigh.R'];
    if (left === undefined || right === undefined) throw new Error('Missing canonical thighs');
    f.actor.levelGround = true;
    f.actor.speed = 1.5;
    f.actor.state = 'flee';
    for (let frame = 0; frame < 120; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      expect(left.rotation.x).toBeCloseTo(.42, 6);
      expect(right.rotation.x).toBe(0);
    }
    f.actor.speed = 0;
    f.actor.state = 'idle';
    f.view.update(1 / 60, 2, true);
    expect(left.rotation.x).toBe(0);
  } finally { f.dispose(); }
});

test('an entered cell uses the same clipless biped fallback on the published actor row', async () => {
  const f = await kitView(original, 'biped', humanoidDims, await rapier);
  const scope = new Scope('kit-neighbour'), root = new Group();
  try {
    const actor = f.actor, slug = f.source.identity.slug;
    const life = new NeighbourLife({ scope, active: () => true, simulation: () => ({ host: { entities: {
      get: id => id === actor.entityId ? { position: actor.position, yaw: actor.yaw, scale: actor.scale, speed: actor.speed,
        strafe: actor.strafe, alive: actor.alive, attackPhase: actor.attackPhase, state: actor.state, hp: actor.hp, flinch: 0 } : undefined,
    } } }) });
    await life.admit({ instance: slug, slug, cell: [0, 0], origin: { x: 0, y: 0, z: 0 } }, root, f.source, f.assets,
      () => new MeshStandardMaterial(), new Map());
    const mesh = root.children.find(node => node instanceof SkinnedMesh);
    if (!(mesh instanceof SkinnedMesh)) throw new Error('Missing entered-cell biped');
    const thigh = mesh.skeleton.bones.find(bone => bone.name === 'thigh.L');
    if (thigh === undefined) throw new Error('Missing entered-cell thigh');
    f.actor.speed = 1.5;
    f.actor.state = 'flee';
    const swing: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      life.late(1 / 60);
      swing.push(thigh.rotation.x);
    }
    expect(Math.min(...swing)).toBeLessThan(-.25);
    expect(Math.max(...swing)).toBeGreaterThan(.25);
  } finally { scope.dispose(); f.dispose(); }
});

test.each([
  { asset: 'kit-biped-pack-die.glb', owned: false },
  { asset: 'kit-biped-pack-owned.glb', owned: true },
])('the actual Kit pack $asset retains walk precedence and plays the sampled death', async ({ asset, owned }) => {
  const glb = new Uint8Array(readFileSync(new URL(`./fixtures/${asset}`, import.meta.url)));
  const f = await kitView(glb, 'biped', humanoidDims, await rapier);
  try {
    const thigh = f.rig.bones['thigh.L'], hips = f.rig.bones['hips'];
    if (thigh === undefined || hips === undefined) throw new Error('Missing canonical walk or death joints');
    f.actor.levelGround = true;
    f.actor.speed = 1.5; f.actor.state = 'flee';
    const walk: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      walk.push(thigh.rotation.x);
    }
    expect(f.loaded.clips.has('walk')).toBe(owned);
    if (owned) for (const angle of walk) expect(angle).toBeCloseTo(.42, 6);
    else expect(Math.max(...walk) - Math.min(...walk)).toBeGreaterThan(.5);
    f.actor.alive = false;
    f.view.update(1 / 60, 2, true);
    const start = hips.position.y;
    for (let frame = 1; frame <= 60; frame++) f.view.update(1 / 60, 2 + frame / 60, true);
    expect(start - hips.position.y).toBeGreaterThan(.6);
    expect(hips.rotation.x).toBeGreaterThan(1.2);
    const rested = hips.quaternion.clone();
    f.view.update(1 / 60, 5, true);
    expect(hips.quaternion.toArray()).toEqual(rested.toArray());
  } finally { f.dispose(); }
});
