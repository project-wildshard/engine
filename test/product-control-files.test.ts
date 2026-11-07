import { PropMaterialsSchema } from '@wildshard/format/propMaterials';
import * as v from 'valibot';
import { AdmissionLateSchema } from '@wildshard/format/admissionLate';
import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { controlFiles, deferredFiles, lateFiles } from '../src/client/game/shardfile/controlFiles';

test('control transport keeps critical and library dependencies but leaves distant tiles declared', () => {
  const source = emptyShardfile({ slug: 'control-files', name: 'Control', author: 'Fixture', seed: 1, revision: 1 });
  const hashes = ['a', 'b', 'c', 'd'].map(value => value.repeat(64));
  const [critical, dependency, distant, shared] = hashes;
  if (critical === undefined || dependency === undefined || distant === undefined || shared === undefined) throw new Error('Missing fixture hash');
  source.files = hashes.map(hash => ({ hash, kind: 'binary', compressed: 4, decoded: 4, gpu: 0, triangles: 0, draws: 0,
    critical: false, dependencies: hash === critical ? [dependency] : [] }));
  source.critical = [critical]; source.library = [shared];
  const before = structuredClone(source);
  expect(controlFiles(source, source.files).map(file => file.hash)).toEqual([critical, dependency, shared]);
  expect(deferredFiles(source, source.files, new Set([critical, dependency, shared])).map(file => file.hash)).toEqual([distant]);
  expect(source).toStrictEqual(before);
  source.critical = ['e'.repeat(64)]; expect(() => controlFiles(source, source.files)).toThrow('not declared');
});

test('distant warming preserves nearest-first dependency order and keeps non-tile bytes last', () => {
  const source = emptyShardfile({ slug: 'control-order', name: 'Control', author: 'Fixture', seed: 1, revision: 1 });
  source.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
  const near = 'a'.repeat(64), far = 'b'.repeat(64), dependency = 'c'.repeat(64), other = 'd'.repeat(64);
  source.files = [other, far, dependency, near].map(hash => ({ hash, kind: 'binary', compressed: 4, decoded: 4, gpu: 0, triangles: 0, draws: 0,
    critical: false, dependencies: hash === near ? [dependency] : [] }));
  for (const [x, hash] of [[0, near], [3, far]] as const) source.tiles.push({ lod: 0, x, z: 0, files: [hash], compressed: 4, decoded: 4, gpu: 0,
    draws: 1, triangles: 1, geometricError: 0, bounds: { min: [x * 62.5, 0, 0], max: [(x + 1) * 62.5, 0, 62.5] } });
  const ordered = deferredFiles(source, source.files, new Set()).map(file => file.hash);
  expect(ordered.indexOf(near)).toBeLessThan(ordered.indexOf(far));
  expect(ordered.indexOf(dependency)).toBeLessThan(ordered.indexOf(far));
  expect(ordered.at(-1)).toBe(other);
});

test('late library roots preserve control dependencies and order their own closures by declared position', () => {
  const source = emptyShardfile({ slug: 'late-files', name: 'Late', author: 'Fixture', revision: 1, seed: 1 });
  const hashes = ['a', 'b', 'c', 'd', 'e'].map(value => value.repeat(64));
  const [critical, near, far, shared, other] = hashes;
  if (critical === undefined || near === undefined || far === undefined || shared === undefined || other === undefined) throw new Error('Missing late fixture');
  source.files = hashes.map(hash => ({ hash, kind: 'binary', compressed: 1, decoded: 8, gpu: 4, triangles: 0, draws: 0,
    dependencies: hash === critical ? [shared] : [], critical: hash === critical }));
  source.library = hashes; source.critical = [critical];
  source.late = [{hash:far,at:[240,0]},{hash:near,at:[1,0]},{hash:shared,at:[100,0]},{hash:critical,at:[240,0]},{hash:other}];
  source.spawn = {x:0,y:0,z:0,yaw:0};
  const snapshot = structuredClone(source), initial = controlFiles(source, source.files);
  expect(initial.map(file => file.hash)).toEqual([critical, shared]);
  expect(lateFiles(source, source.files).map(file => file.hash)).toEqual([near, far, other]);
  expect(source).toStrictEqual(snapshot);
});

test('late metadata refuses duplicate roots and positions outside the cell', () => {
  const hash = 'a'.repeat(64);
  expect(v.safeParse(AdmissionLateSchema, [{hash,at:[250,-250]}]).success).toBe(true);
  for (const input of [[{hash},{hash}], [{hash,at:[251,0]}], [{hash,at:[0,Infinity]}], [{hash:'missing'}]]) {
    expect(v.safeParse(AdmissionLateSchema, input).success).toBe(false);
  }
});

test('a late global LUT remains a required control dependency', () => {
  const source = emptyShardfile({slug:'late-lut',name:'LUT',author:'Fixture',seed:1,revision:1}), hash = 'a'.repeat(64);
  source.files = [{hash,kind:'binary',compressed:3,decoded:3,gpu:0,triangles:0,draws:0,dependencies:[],critical:false}];
  source.library = [hash]; source.late = [{hash,at:[200,0]}]; source.look.grade.lut = hash;
  expect(controlFiles(source,source.files)).toEqual(source.files);
  expect(lateFiles(source,source.files)).toEqual([]);
});


test('material construction keeps prop-only textures ready outside the library and critical lists', () => {
  const source = emptyShardfile({slug:'material-roots',name:'Materials',author:'Fixture',seed:1,revision:1}), texture = 'a'.repeat(64), graph = 'b'.repeat(64), dependency = 'c'.repeat(64);
  source.files = [texture,graph,dependency].map(hash => ({hash,kind:'ktx2',compressed:3,decoded:0,gpu:8,triangles:0,draws:0,dependencies:hash===graph?[dependency]:[],critical:false}));
  source.props = {version:1,family:'toon',tiles:[],panels:[],models:[],far:null,textures:[],colliders:[],materials:v.parse(PropMaterialsSchema,{Landmark:{id:'toon',colour:{file:texture}}})};
  source.look.materials = {surface:{family:'graph',file:graph}};
  expect(source.library).toEqual([]); expect(source.critical).toEqual([]);
  expect(controlFiles(source,source.files)).toEqual(source.files);
  const missing = {...source,files:source.files.filter(row => row.hash!==texture)};
  expect(() => controlFiles(missing,missing.files)).toThrow('Control file is not declared');
});
