// oxlint-disable-next-line import/no-nodejs-modules -- The no-shard-nouns check reads the host's own sources.
import { readdirSync, readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test, vi } from 'vitest';
import { Bone, BufferGeometry, Material, Mesh, MeshStandardMaterial, Skeleton } from 'three';
import { MountedSpecimenSeatSchema } from '@wildshard/format/mountedSpecimenRows';
import { Scope } from '@wildshard/engine/app/scope';
import { SeatedFigure, seatedFigureView } from './seatedFigure';
import {sha256} from '../../../shared/game/plugin/moduleHash';

// G603 L10 host bar, tests 2-6, for the riding host's rider seated on a mount, on a made-up lamplighter riding a donkey:
// its own named shapes, a scene-declared standard coat (no lent look), another joint, speed clock and two cue kinds.
// Exact original zlib wires: position [x, 0, 0, 1, 0, 0, 0, 1, 0], index deltas [0, 1, 1].
const shapeBytes=(x:2|3):Uint8Array=>{
  const bytes=new Uint8Array(48);
  new Float32Array(bytes.buffer,0,9).set([x,0,0,1,0,0,0,1,0]);
  new Int32Array(bytes.buffer,36,3).set([0,1,1]);
  return bytes;
};
const files=new Map([["shapes/2.bin",shapeBytes(2)],["shapes/3.bin",shapeBytes(3)]]);
const shape = (key: string, x: 2 | 3) => ({ key,file:`shapes/${String(x)}.bin`,
  geometry: { attrs: [['position', 'f32', 3, false]], count: 3, index: 'u16', indexCount: 3, box: true, expand: false } });
const lamplighter = () => ({ mount: 'saddle',
  figure: { version: 1, root: 'rider', materials: [{ kind: 'standard', id: 'coat', properties: { color: 0x334455, roughness: 0.8 } }],
    nodes: [{ kind: 'group', id: 'rider', position: [0, 0.5, 0], children: ['torso', 'lamp'] },
      { kind: 'mesh', id: 'torso', geometry: 'torso', material: 'coat', missing: 'empty' },
      { kind: 'mesh', id: 'lamp', geometry: 'lamp', material: 'coat', missing: 'empty', position: [0.2, 0.4, 0] }] },
  shapes: [shape('torso', 2), shape('lamp', 3)],
  clips: [{ bone: 'rider', channel: 'rotation.x', cases: [{ when: { mem: { key: 'pace', above: 2 } }, sum: [0.1] }, { sum: [0] }] },
    { bone: 'lamp', channel: 'rotation.z', cases: [{ when: { mem: { key: 'swingT', atLeast: 0 } }, sum: [0.5] }, { sum: [0] }] }],
  speed: 'pace', gestures: [{ cue: 'dusk', clock: 'swingT', duration: 0.3 }, { cue: 'greet', clock: 'swingT', duration: 0.3 }] });
const painted = () => ({ ...lamplighter(), material: { look: 'painterly', id: 'coat', rim: 0.3, bands: 0.6 },
  figure: { ...lamplighter().figure, materials: [{ kind: 'port', id: 'coat', source: 'coat' }] } });
const isMesh = (value: unknown): value is Mesh => value instanceof Mesh;
const mesh = (figure: SeatedFigure, index: number): Mesh => {
  const part: unknown = figure.root.children[index];
  if (!isMesh(part)) throw new Error('Missing figure mesh');
  return part;
};

test('named host shapes keep the exact predecessor compressed-wire payloads',()=>{
  expect([...files.values()].map(bytes=>sha256(bytes))).toEqual(['a648af4212ef3b0ce38f7794202a368b2080d2387f810286878b51cfd537c968','8e5fccd646e846bd87baf0ea9bac27a0fa4f06139e047ddd182ad787673d9beb']);
});

test('a lamplighter seats on its own joint, leans on its speed clock and swings on either cue (tests 3, 5)', () => {
  const scope = new Scope('lamplighter'), figure = new SeatedFigure(v.parse(MountedSpecimenSeatSchema, lamplighter()), scope,files);
  const saddle = new Bone(); saddle.name = 'saddle';
  figure.attach({ mesh: { skeleton: new Skeleton([saddle]) }, speed: 3 });
  expect(saddle.children).toEqual([figure.root]);
  const coat: unknown = mesh(figure, 0).material;
  if (!(coat instanceof MeshStandardMaterial)) throw new Error('The scene declares a standard coat');
  expect(coat.color.getHex()).toBe(0x334455);
  expect(mesh(figure, 1).geometry.getAttribute('position').getX(0)).toBe(3);
  figure.update(0.1, []); expect(figure.root.rotation.x).toBe(0.1); // the seat's own speed
  figure.update(0.1, [], 0); expect(figure.root.rotation.x).toBe(0);
  figure.update(0, ['rain'], 0); expect(mesh(figure, 1).rotation.z).toBe(0); // an undeclared cue kind does nothing
  for (const cue of ['dusk', 'greet']) {
    figure.update(0, [cue], 0); expect(mesh(figure, 1).rotation.z).toBe(0.5);
    figure.update(0.31, [], 0); expect(mesh(figure, 1).rotation.z).toBe(0.5);
    figure.update(0.01, [], 0); expect(mesh(figure, 1).rotation.z).toBe(0);
  }
  expect(() => { figure.attach({ mesh: { skeleton: new Skeleton() }, speed: 0 }); }).toThrow('joint');
  scope.dispose();
});

test('the rider is client presentation: its scope owns every decoded shape and made material (test 4)', () => {
  const owned: (BufferGeometry | Material)[] = [];
  const view = seatedFigureView(v.parse(MountedSpecimenSeatSchema, painted()), resource => { owned.push(resource); },files);
  expect(owned.filter(resource => resource instanceof BufferGeometry)).toHaveLength(2);
  const look = owned.find(resource => resource instanceof Material);
  if (look === undefined) throw new Error('The lent look makes the port material');
  const torso: unknown = view.parts.get('torso');
  if (!isMesh(torso)) throw new Error('Missing torso');
  expect(torso.material).toBe(look);
  view.dispose();
  const scope = new Scope('lamplighter'), figure = new SeatedFigure(v.parse(MountedSpecimenSeatSchema, lamplighter()), scope,files);
  const coat: unknown = mesh(figure, 0).material, shapeGeometry = mesh(figure, 0).geometry;
  if (!(coat instanceof Material)) throw new Error('Missing coat');
  const coatDisposed = vi.spyOn(coat, 'dispose'), shapeDisposed = vi.spyOn(shapeGeometry, 'dispose');
  scope.dispose();
  expect(coatDisposed).toHaveBeenCalled(); expect(shapeDisposed).toHaveBeenCalled();
});

test('seat rows refuse callbacks, unknown looks and malformed looks (test 6)', () => {
  expect(v.safeParse(MountedSpecimenSeatSchema, lamplighter()).success).toBe(true);
  expect(v.safeParse(MountedSpecimenSeatSchema, painted()).success).toBe(true);
  for (const input of [{ ...lamplighter(), build: () => undefined }, { ...lamplighter(), species: 'donkey' },
    { ...painted(), material: { look: 'toon', id: 'coat', rim: 0.3, bands: 0.6 } }, { ...painted(), material: { id: 'coat', rim: 0.3, bands: 0.6 } },
    { ...painted(), material: { look: 'painterly', id: 'coat', rim: Number.NaN, bands: 0.6 } }, { ...lamplighter(), shapes: [] }])
    expect(v.safeParse(MountedSpecimenSeatSchema, input).success).toBe(false);
});

test('the rider host names no shard and no shard-only figure (test 2)', () => {
  const nouns = [...readdirSync('src/shards', { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('_')).map(entry => entry.name), 'shepherd', 'ferryman'];
  expect(nouns.length).toBeGreaterThan(3);
  for (const file of ['src/client/game/riding/seatedFigure.ts', 'src/client/game/models/mountedSpecimen.ts', 'node_modules/@wildshard/format/src/format/mountedSpecimenRows.ts']) {
    const source = readFileSync(file, 'utf8').toLowerCase();
    expect(nouns.filter(noun => source.includes(noun))).toEqual([]);
  }
});
