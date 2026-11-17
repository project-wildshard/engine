import { createHash } from 'node:crypto';
import { Matrix4 } from 'three';
import { parseRows } from '@wildshard/format/rows';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import { groundFixture } from './plain-ground';

export const volumeJoints = ['body', 'chest', 'head', 'hand.L'];
export function creatureVolumeGlb(path: 'translation' | 'rotation' | 'scale' = 'translation'): Uint8Array {
  const chunks: Buffer[] = [], views: object[] = [], accessors: object[] = [];
  let at = 0;
  const add = (data: ArrayBufferView, type: string, count: number, componentType = 5126): number => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength), pad = (4 - bytes.length % 4) % 4;
    views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length }); chunks.push(bytes, Buffer.alloc(pad)); at += bytes.length + pad;
    accessors.push({ bufferView: views.length - 1, type, count, componentType }); return accessors.length - 1;
  };
  const position = add(new Float32Array([0, 0, 0, .1, 0, 0, 0, .1, 0]), 'VEC3', 3);
  const normal = add(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3', 3);
  const joints = add(new Uint8Array(12), 'VEC4', 3, 5121), weights = add(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', 3);
  const indices = add(new Uint16Array([0, 1, 2]), 'SCALAR', 3, 5123);
  const binds = add(new Float32Array([[0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 1, 0]].flatMap(([x = 0, y = 0, z = 0]) => new Matrix4().makeTranslation(x, y, z).invert().elements)), 'MAT4', 4);
  const values = path === 'rotation' ? [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2] : path === 'scale' ? [1, 1, 1, 2, 2, 2] : [0, 1, 0, 1, 1, 0];
  const times = add(new Float32Array([0, 1]), 'SCALAR', 2), moves = add(new Float32Array(values), path === 'rotation' ? 'VEC4' : 'VEC3', 2);
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'fixture.mesh', mesh: 0, skin: 0 }, { name: 'body', children: [2] },
      { name: 'chest', translation: [0, 1, 0], children: [3, 4] }, { name: 'head', translation: [0, 1, 0] }, { name: 'hand.L', translation: [1, 0, 0] }],
    skins: [{ joints: [1, 2, 3, 4], inverseBindMatrices: binds }], materials: [{ name: 'Body' }],
    meshes: [{ primitives: [{ attributes: { POSITION: position, NORMAL: normal, JOINTS_0: joints, WEIGHTS_0: weights }, indices, material: 0 }] }],
    animations: [{ name: 'idle', channels: [{ sampler: 0, target: { node: 3, path } }], samplers: [{ input: times, output: moves, interpolation: 'LINEAR' }] }],
    accessors, bufferViews: views, buffers: [{ byteLength: at }] };
  const json = Buffer.from(JSON.stringify(doc)), text = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]), bin = Buffer.concat(chunks);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + text.length + bin.length, 8);
  header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binary = Buffer.alloc(8); binary.writeUInt32LE(bin.length); binary.writeUInt32LE(0x004e4942, 4);
  return Uint8Array.from(Buffer.concat([header, text, binary, bin]));
}
export async function creatureVolumeFixture() {
  await prepareGlbCost();
  const source = groundFixture(true), species = source.rows.species[0], spawn = source.creatures.spawns[0];
  if (species === undefined || spawn === undefined) throw new Error('Missing actual volume fixture');
  species.temperament = { brain: 'none', reaction: 'neutral', leash: 25, assist: 0, home: { speed: 1, stop: 1 } };
  species.body = { skeleton: 'biped', size: 'medium', scale: 1, look: 'fixture.look', volumes: [
    { part: 'shield', bone: 'hand.L', shape: 'sphere', radius: .4, halfLength: 0, axis: 'y', multiplier: 0 }] };
  spawn.yaw = 0;
  const glb = creatureVolumeGlb(), cost = parseGlbData(glb), sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'), file = sha(glb);
  const metadata = new TextEncoder().encode(JSON.stringify({ row: { id: 'fixture.skin', file, family: 'toon',
    rig: { skeleton: 'fixture.biped', joints: [volumeJoints], clips: ['idle'], sockets: volumeJoints }, cost },
    binding: { skin: 'fixture.skin', material: { family: 'pbr', vertexColours: false }, loops: ['idle'] } }));
  const skin = sha(metadata), assets = new Map([[file, glb], [skin, metadata]]);
  source.rows.looks.push({ id: 'fixture.look', species: species.id, recipe: 'platform.skin', material: null,
    parameters: { skin }, animation: { recipe: 'platform.clips', parameters: { attackSpan: 1 } } });
  source.files.push({ hash: file, kind: 'glb', compressed: glb.length, ...cost, dependencies: [], critical: false },
    { hash: skin, kind: 'json', compressed: metadata.length, decoded: metadata.length, gpu: 0, triangles: 0, draws: 0, dependencies: [file], critical: false });
  source.library.push(skin); source.rows = parseRows(source.rows);
  return { source, assets, glb, file, skin };
}
