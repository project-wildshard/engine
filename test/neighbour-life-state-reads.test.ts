// @vitest-environment node
// TEMPLATE-E2E TC-SHIP-d2 (opus-te2e5, 2026-11-17): a grid data cell's client lane reads the cell's public shared state off
// the wire. Brasscap's Dust Wyrm glows its gullet (particles reading `brasscap.wyrm-gullet`) and tells its strike (the sand
// ring reading `brasscap.wyrm-tell`); on staging v0.1.37 the grid page built its lane with no state view, refused the whole
// lane (`Declared client reads require an owned state view`), and drew no particle in the cell at all.
import { beforeAll, expect, test } from 'vitest';
import { Group } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { GridCell } from '../src/shared/game/grid/assembly';
import { NeighbourLife } from '../src/client/game/grid/neighbourLife';
import { frozenLegacyGuest } from './fixtures/sdk-built/scriptGuests';

let bytes: Uint8Array = new Uint8Array();
const moduleId = 'a'.repeat(64);
beforeAll(async () => {
  // the same frozen guest as client-script-bridge-values: two output rows from the reads it is given
  bytes = await frozenLegacyGuest(`
export function abi_version():i32{return 0;}
export function init(lo:i32,hi:i32):void{}
export function in_ptr():i32{return 16384;}
export function in_cap():i32{return 4096;}
export function out_ptr():i32{return 24576;}
export function out_cap():i32{return 32;}
export function out_count():i32{return 2;}
export function on_tick():void{
  let count=i32(load<f64>(16440));
  store<f64>(24576,101);store<f64>(24584,count==0?0:load<f64>(16448));
  store<f64>(24616,102);store<f64>(24624,load<f64>(16416)/10);
}`, { maximumPages: 1 });
});

const cell: GridCell = { instance: 'brasscap-mesa', slug: 'brasscap-mesa', cell: [-1, -1], origin: { x: -500, z: -500 } as GridCell['origin'] };
const glow = { id: 111, name: 'brasscap.wyrm-gullet', type: 'bool', privacy: 'public', default: false };
const ring = { id: 110, name: 'brasscap.wyrm-tell', type: 'bool', privacy: 'public', default: false };

/** A data cell with no creatures and one particle binding that reads two public shared fields. */
function shard(): Shardfile {
  const binding = { module: moduleId, entity: 13, name: 'gullet', target: { kind: 'particles', id: 'brasscap.gullet', at: [2, 3.1, -99.1] },
    reads: [{ scope: 'shared', id: 111 }, { scope: 'shared', id: 110 }], parameters: [2, 1, 1, 0], pose: false, maxOffset: 0, minScale: 1, maxScale: 1, emitters: [] };
  return { runtime: null, identity: { slug: 'brasscap-mesa', seed: 1 }, state: { shared: [ring, glow], player: [] }, sim: { scripts: [] },
    files: [{ hash: moduleId, kind: 'wasm', dependencies: [] }], library: [moduleId], props: { panels: [], models: [] },
    clientScripts: { divisor: 1, bindings: [binding] }, creatures: { spawns: [], groups: [], brains: [] }, rows: { species: [], looks: [] } } as unknown as Shardfile;
}

async function admitted(field: (instance: string, name: string) => number | undefined): Promise<NeighbourLife> {
  const life = new NeighbourLife({ scope: new Scope('neighbour state reads'), simulation: () => undefined, active: () => true, field });
  await life.admit(cell, new Group(), shard(), new Map([[moduleId, bytes]]), (() => undefined) as never, new Map([['brasscap-mesa', Promise.resolve(new Map())]]));
  return life;
}

test('a data cell lane reads its public shared fields off the wire and keeps stepping', async () => {
  const asked: string[] = [];
  const life = await admitted((instance, name) => { asked.push(`${instance}:${name}`); return name === 'brasscap.wyrm-gullet' ? 1 : 0; });
  for (let tick = 0; tick < 3; tick++) { life.fixed(); life.late(1 / 60); }
  expect(life.state()).toEqual([expect.objectContaining({ instance: 'brasscap-mesa', failed: null })]);
  expect(asked).toContain('brasscap-mesa:brasscap.wyrm-gullet');
  expect(asked).toContain('brasscap-mesa:brasscap.wyrm-tell');
});

test('a field the wire has not sent yet reads its declared default', async () => {
  const life = await admitted(() => undefined);
  for (let tick = 0; tick < 3; tick++) { life.fixed(); life.late(1 / 60); }
  expect(life.state()).toEqual([expect.objectContaining({ failed: null })]);
});
