import { afterEach, beforeEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the native loader on the shipped rig bytes.
import { readFileSync } from 'node:fs';
import { readSourceModel } from '../src/sharddev/bake/skinned';
import * as rigLoader from '../src/client/engine/anim/rig';
import * as lookCompiler from '../src/client/game/shardfile/runtimeFolder';
import { ToonLook } from '../src/client/engine/render/families/toon';
import { BufferGeometry, InterleavedBufferAttribute, Color, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector2, Vector3, Vector4 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { parseToonArmsLook } from '@wildshard/format/heldArms';
import { HeldView } from '../src/client/game/systems/viewmodel/heldView';
import { parseHeldView } from '@wildshard/format/heldView';
import { toonLighting } from '../src/client/game/looks/toonLighting';
import { heldArmsGear } from '../src/client/game/models/heldGear';
import { RigArms } from '../src/client/game/systems/viewmodel/rigArms';
import { ARM_CLIPS, armClipNames } from '../src/client/game/systems/viewmodel/armClips';

// A fictional harbour look uses the native rig loader and resolver. Spies observe the file/compiler
// seams; neither seam is a parameter of the held host's public API.
type Looks = Awaited<ReturnType<typeof lookCompiler.runtimeLookMaterials>>;
function context(): ShardContext { return { scope: new Scope('held-fixture'), product: { shardfile: {} } } as ShardContext; }


const row = {
  kind: 'toon' as const, id: 'harbour.held-arms',
  lighting: { id: 'fixture-harbour.day', initial: { uToonLift: [.1, .2, .3], uToonRim: [.3, .2, .1], uCloudShadow: .6, uToonNight: 0, uSeaLevel: 2, uCloudTime: 3 } },
  url: '/assets/fixture-harbour/arms.glb', skeleton: 'harbour-rig', sockets: ['R_weapon', 'L_hand'],
  joints: { sides: ['R', 'L'], arm: ['shoulder', 'upperarm', 'forearm', 'twist1', 'twist2', 'twist3', 'hand'], fingers: ['thumb', 'index', 'middle', 'ring', 'pinky'], phalanges: 3 },
  offset: [.1, -.02, 0], frame: { size: .7, pitch: -.1, yaw: .02, roll: 0 }, sunward: 2, bladeBase: .01,
  swim: { tilt: .8, handsZ: -.4, waterY: -.2, startD: -.3 },
  materials: { arms: 'harbour-linen', wood: 'harbour-oak', iron: 'harbour-steel', swim: 'harbour-wet' },
};
function lighting() {
  const admitted = parseHeldView(row); if (admitted.kind !== 'toon') throw new Error('Missing toon fixture');
  return { source: toonLighting(admitted.lighting),
    target: { famToonLift: { value: new Color() }, famToonRim: { value: new Color() },
      famToonCloud: { value: new Vector4() }, famToonWater: { value: new Vector2() }, famToonTime: { value: 0 } } };
}

const sky = { csm: { lightDirection: new Vector3(1, -2, 3) } } as SkyRig;
const catalogue = (): Looks => ({ toon: new ToonLook(), materials: new Map(Object.values(row.materials).map(id => [id, new MeshBasicMaterial()])),
  setParam: vi.fn<Looks['setParam']>(), setTexture: vi.fn<Looks['setTexture']>(), textures: new Map(), compile: () => new MeshBasicMaterial(),
  bindMeshMap: () => new MeshBasicMaterial(), tick: () => undefined, outline: () => [],
  graphs: { bind: () => undefined, readout: { compiled: 0, fallback: 0, reasons: [] } }, surfaces: null });
let queuedLooks: Looks[] = [];

beforeEach(() => {
  vi.spyOn(rigLoader, 'loadRigFile').mockImplementation(async () => {
    const source = await readSourceModel(readFileSync('public/assets/models/driftwood-fp/fp-arms.glb'));
    const root = source.gltf.scene.getObjectByName('vm_root');
    if (root === undefined) throw new Error('Missing fixture rig root');
    root.userData['rig'] = row.skeleton;
    root.userData['swords'] = { wood: { bladeBase: .012, bladeTip: .532 }, iron: { bladeBase: .025, bladeTip: .572 } };
    return source.gltf;
  });
  vi.spyOn(lookCompiler, 'runtimeLookMaterials').mockImplementation(() => {
    const next = queuedLooks.shift(); if (next === undefined) throw new Error('Missing compiled fixture catalogue');
    return Promise.resolve(next);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

test('second-shard rows drive held materials, sword glow, sockets and independent loans', async () => {
  const host = new HeldView(row), first = catalogue(), latest = catalogue(), light = lighting();
  expect(host.contract).toMatchObject({ skeleton: row.skeleton, sockets: row.sockets });
  expect(host.bake.joints?.[0]).toHaveLength(44);
  expect(host.bake.joints?.[0]?.slice(0, 3)).toEqual(['R_shoulder', 'R_upperarm', 'R_forearm']);
  const firstScope = context(), latestScope = context();
  queuedLooks = [first, latest];
  await host.prepare(firstScope); await host.prepare(latestScope);
  light.target = latest.toon.uniforms;
  const held = await host.sword();
  const wood = held.arms;
  if (wood === undefined) throw new Error('Missing fixture sword arms');
  wood.setup?.(sky); held.ironArms?.setup?.(sky);
  expect(latest.setParam).toHaveBeenCalledWith(row.materials.iron, 'bladeBase', .025);
  held.ironArms?.glow?.(.7);
  expect(latest.setParam).toHaveBeenCalledWith(row.materials.iron, 'rim', .7);
  const root = await host.specimen({ sky, blade: 'iron' });
  const mesh = root.children.find((part): part is Mesh<BufferGeometry, MeshBasicMaterial> => part instanceof Mesh && part.name === 'arms');
  expect(mesh).toBeInstanceOf(Mesh);
  if (mesh === undefined) throw new Error('Missing fixture arms');
  expect(mesh.material).toBe(latest.materials.get(row.materials.arms));
  const ironMesh = root.getObjectByName('sword_iron');
  if (!(ironMesh instanceof Mesh)) throw new Error('Missing fixture iron mesh');
  const ironGeometry: unknown = ironMesh.geometry;
  if (!(ironGeometry instanceof BufferGeometry)) throw new Error('Missing fixture iron geometry');
  expect(ironGeometry.getAttribute('aMetal')).toBeInstanceOf(InterleavedBufferAttribute);
  expect(ironGeometry.hasAttribute('_metal')).toBe(false);
  // The host follows the original light only at draw time, with borrowed graph parameters.
  const draw = mesh.onBeforeRender.bind(mesh);
  Reflect.apply(draw, mesh, []);
  expect(light.target.famToonLift.value).toEqual(light.source.uToonLift.value);
  expect(light.target.famToonRim.value).toEqual(light.source.uToonRim.value);
  expect(light.target.famToonCloud.value.x).toBe(.6);
  expect(light.target.famToonWater.value.x).toBe(2);
  expect(light.target.famToonTime.value).toBe(3);
  expect(latest.setParam).toHaveBeenCalledWith(row.materials.wood, 'sunward', [-2, 4, -6]);
  expect(first.setParam).not.toHaveBeenCalled();
  firstScope.scope.dispose();
  expect(() => wood.glow?.(.2)).not.toThrow();
  latestScope.scope.dispose();
  expect(() => wood.glow?.(.2)).toThrow('no looks prepared');
  const geometry: BufferGeometry = mesh.geometry; geometry.dispose();
});

test('second-shard swimming uses its material and plane; submerged hands clip below water', async () => {
  const host = new HeldView(row), looks = catalogue(); queuedLooks = [looks]; await host.prepare(context());
  const { swim } = await host.sword();
  if (swim === undefined) throw new Error('Missing fixture swim arms');
  swim.setup(sky);
  expect(looks.setParam).toHaveBeenCalledWith(row.materials.swim, 'waterD', -.3);
  const camera = new PerspectiveCamera(70, .5, .1, 100);
  swim.update(.016, { stroke: 1, phase: .4, camera, eyeAbove: 1 });
  expect(looks.setParam).toHaveBeenCalledWith(row.materials.swim, 'waterN', expect.any(Array));
  swim.update(.016, { stroke: 1, phase: .4, camera, eyeAbove: 0 });
  expect(looks.setParam).toHaveBeenLastCalledWith(row.materials.swim, 'waterD', 50);
  expect(swim.root.scale.toArray()).toEqual([1, 1, 1]);
});

test('held arms refuse malformed rows and missing catalogue bindings before dressing', async () => {
  const { kind: _kind, ...look } = row;
  expect(parseToonArmsLook(look)).toEqual(look); expect(parseHeldView(row)).toEqual(row);
  for (const bad of [{ ...row, offset: [0, 0] }, { ...row, sunward: Infinity },
    { ...row, joints: { ...row.joints, phalanges: 0 } }, { ...row, sockets: ['R_weapon', 'R_weapon'] },
    { ...row, frame: { ...row.frame, surprise: 1 } }, { ...row, kind: 'clay' }]) expect(() => new HeldView(bad)).toThrow();
  // a graph row is read from its product, never admitted as a toon host
  expect(() => HeldView.admit({ ...row, kind: 'graph' })).toThrow();
  queuedLooks = [{ ...catalogue(), materials: new Map() }];
  await expect(new HeldView(row).prepare(context())).rejects.toThrow('look.materials lacks');
});

test('shared rig player preserves the multi-mesh Jian and held grapple clips', async () => {
  vi.mocked(rigLoader.loadRigFile).mockImplementation(async () =>
    (await readSourceModel(readFileSync('public/assets/nine-dragon/viewmodel/fp-rig.glb'))).gltf);
  const contract = { skeleton: 'nine-dragon-fp', clips: armClipNames(ARM_CLIPS), sockets: ['R_weapon', 'L_claw'] };
  const bake = { skeleton: contract.skeleton, clips: ARM_CLIPS,
    joints: ['R', 'L'].map(side => ['shoulder', 'upperarm', 'forearm', 'twist1', 'twist2', 'twist3', 'hand'].map(joint => `${side}_${joint}`)) };
  const options = { aliases: ARM_CLIPS, holdRight: ['charge'], holdLeft: ['grapple_hold'] };
  const first = await RigArms.load('fixture:jian-native', contract, bake, false, options);
  const second = await RigArms.load('fixture:jian-native', contract, bake, false, options);
  expect(first.meshes().length).toBeGreaterThan(3);
  expect(first.nodes.get('R_weapon')).toBeDefined();
  const claw = first.nodes.get('L_claw');
  expect(claw).toBeDefined();
  expect(claw).not.toBe(second.nodes.get('L_claw'));
  const state = { speed: 0, lookVel: new Vector2() };
  first.play('charge'); first.playLeft('grapple_hold'); first.update(2, state);
  expect(first.move).toBe('charge');
  const held = claw?.quaternion.toArray(); first.update(.1, state);
  expect(claw?.quaternion.toArray()).toEqual(held);
  expect(second.move).toBeNull();
  first.play('light'); first.update(.1, state);
  expect(first.move).toBe('light');
});

test('graph held arms list finite Explorer cards from rows and refuse malformed ones', () => {
  const card = { id: 'harbour/fp-arms', name: 'Harbour arms', file: 'src/shards/harbour/data/heldCards.json', size: [0.9, 0.6, 0.9],
    pipeline: ['blender', 'code'], clips: ['idle', 'walk'], settleFrames: 12, copies: 1 };
  const rows = { kind: 'graph', slug: 'harbour', file: 'weapons/arms.json', cards: [card] };
  expect(heldArmsGear(rows).map(entry => entry.id)).toEqual(['harbour/fp-arms']);
  for (const bad of [{ ...rows, cards: [] }, { ...rows, cards: [{ ...card, pipeline: ['magic'] }] }, { ...rows, cards: [{ ...card, settleFrames: -1 }] },
    { ...rows, surprise: 1 }, { ...rows, kind: 'clay' }, { ...rows, cards: [{ ...card, build: () => null }] }]) expect(() => heldArmsGear(bad)).toThrow();
});
