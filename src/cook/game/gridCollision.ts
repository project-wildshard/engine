// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {join} from 'node:path';
import type {GeneratedStrip} from '@wildshard/engine/sim/strips';
import {GRID_COLLISION_BODY, GRID_COLLISION_HEADER, type GridCollisionHeader} from '../../shared/game/grid/gridCollision';
import type {ServerPack} from '../../shared/game/shardfile/serverPack';
import {cookServerPack} from './shardCook';
import type {PartEncoder} from './spawnParts';

/** Where the bake leaves the road's collision for the build to pack. */
const FOLDER = 'out/.app/grid-collision';

/** The grid pack's two files for one catalogue's strips. The bake writes them with the pages, in the same generated order. */
export function encodeGridCollision(source: string, strips: readonly GeneratedStrip[]): {readonly header: Uint8Array; readonly body: Uint8Array} {
  const shapes = new Map<string, number>(), rows: GridCollisionHeader['shapes'][number][] = [], chunks: Uint8Array[] = [];
  let at = 0;
  const push = (array: Float32Array | Uint32Array): [number, number] => {
    const bytes = new Uint8Array(array.slice().buffer), start = at;
    chunks.push(bytes); at += bytes.length;
    return [start, array.length];
  };
  const shapeOf = ({mesh}: GeneratedStrip): number => {
    const key = createHash('sha256').update(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength)).update(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength)).digest('hex');
    const known = shapes.get(key); if (known !== undefined) return known;
    rows.push({positions: push(mesh.positions), indices: push(mesh.indices)}); shapes.set(key, rows.length - 1);
    return rows.length - 1;
  };
  const placed = strips.map(strip => ({id: strip.id, shape: shapeOf(strip), origin: {x: strip.mesh.origin.x, z: strip.mesh.origin.z},
    duplicates: strip.duplicates.map(row => ({instance: row.instance, origin: {x: row.mesh.origin.x, z: row.mesh.origin.z}}))}));
  const body = new Uint8Array(at);
  let cursor = 0;
  for (const chunk of chunks) { body.set(chunk, cursor); cursor += chunk.length; }
  const header: GridCollisionHeader = {version: 1, source, shapes: rows, strips: placed};
  return {header: new TextEncoder().encode(JSON.stringify(header)), body};
}

export function writeGridCollision(root: string, source: string, strips: readonly GeneratedStrip[]): void {
  const {header, body} = encodeGridCollision(source, strips), folder = join(root, FOLDER);
  mkdirSync(folder, {recursive: true});
  writeFileSync(join(folder, 'strips.json'), header); writeFileSync(join(folder, 'shapes.bin'), body);
}

/** C2: the catalogue's grid pack, or nothing for a build with no baked grid. The same content-named part as a product's. */
export function cookGridPack(root: string, out: string, encoder: PartEncoder): Promise<ServerPack | undefined> {
  const folder = join(root, FOLDER);
  if (!existsSync(join(folder, 'strips.json'))) return Promise.resolve(undefined);
  const files = new Map([[GRID_COLLISION_HEADER, readFileSync(join(folder, 'strips.json'))], [GRID_COLLISION_BODY, readFileSync(join(folder, 'shapes.bin'))]]);
  const rows = [...files].map(([path, bytes]) => ({path, bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex')}));
  return cookServerPack(rows, path => files.get(path) ?? new Uint8Array(), out, encoder);
}
