import { PerspectiveCamera, Vector3, type InstancedMesh, type Object3D } from 'three';
import type { Scope } from '../../src/shared/engine/app/scope';
import { viewProgram, type ViewProgram } from '../../src/shared/engine/script/viewProgram';
import { ARENA_BURNT_PER_FRAME, ARENA_VIEW } from '@wildshard/format/arenaView';
import { fireViewRows } from '../../src/shards/nalati-grasslands/generators/titanFireView';
import { whirlsViewRows } from '../../src/shards/nalati-grasslands/generators/titanWhirlsView';
import { nalatiViewBytes } from '../fixtures/nalati-view-modules';

/** A generated view module's bytes, as the product carries them (a happy-dom Response cannot feed a runtime compile). */
const player = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };

/** The arena fire view module (R6) over any cell field and fire look: the arrays and values the test drives, and its program. */
export function arenaFireView(scope: Scope, field: Parameters<typeof fireViewRows>[0], view: Parameters<typeof fireViewRows>[1],
  draws: { readonly flames: InstancedMesh; readonly smoke: InstancedMesh; readonly scorch: InstancedMesh }): {
  readonly program: ViewProgram; readonly modes: Float32Array; readonly lifetimes: Float32Array; readonly ground: Float32Array; readonly burnt: Float32Array;
  readonly values: Record<string, number>;
} {
  const fire = ARENA_VIEW.fire, cells = field.width * field.depth;
  const modes = new Float32Array(cells).fill(field.states.idle), lifetimes = new Float32Array(cells), ground = new Float32Array(cells), burnt = new Float32Array(1 + ARENA_BURNT_PER_FRAME);
  const values: Record<string, number> = { on: 1, clear: 0, windX: 0, windZ: 0, windSpeed: 0, smokeCap: draws.smoke.instanceMatrix.count, smokeRate: 0, scorchCap: draws.scorch.instanceMatrix.count };
  const arrays = new Map<string, ArrayLike<number>>([[fire.arrays.modes, modes], [fire.arrays.lifetimes, lifetimes], [fire.arrays.ground, ground], [fire.arrays.burnt, burnt]]);
  const meshes = new Map<string, InstancedMesh>([[fire.draws.flames, draws.flames], [fire.draws.smoke, draws.smoke], [fire.draws.scorch, draws.scorch]]);
  const program = viewProgram(nalatiViewBytes('titan-fire-view'), fireViewRows(field, view), { scope, player, camera: new PerspectiveCamera(),
    values: id => id === fire.values ? name => values[name] ?? Number.NaN : null, floor: () => null, slots: () => null, look: () => undefined,
    object: () => { throw new Error('The fire lends no objects'); },
    array: id => { const array = arrays.get(id); if (array === undefined) throw new Error(`No array ${id}`); return () => array; },
    draw: id => { const mesh = meshes.get(id); if (mesh === undefined) throw new Error(`No draw ${id}`); return mesh; } });
  if (program === null) throw new Error('Missing arena fire view');
  return { program, modes, lifetimes, ground, burnt, values };
}

/** The arena whirl view module (R6) over any whirlwinds: their drawn state (ease, shown, x, ground, z) and its program. */
export function arenaWhirlsView(scope: Scope, rows: Parameters<typeof whirlsViewRows>[0], funnels: readonly Object3D[], debris: InstancedMesh,
  drawn: readonly { readonly k: number; readonly shown: number; readonly x: number; readonly y: number; readonly z: number }[]): ViewProgram {
  const whirls = rows.view, fields = new Map<string, () => number>();
  for (const [i, row] of drawn.entries()){const slot=whirls.slots[i];if(slot===undefined)throw new Error('Missing whirl view slot');for (const key of ['k', 'shown', 'x', 'y', 'z'] as const) fields.set(slot.fields[key], () => row[key]);}
  const program = viewProgram(nalatiViewBytes('titan-whirls-view'), whirlsViewRows(rows), { scope, player, camera: new PerspectiveCamera(),
    values: id => id === whirls.source ? name => fields.get(name)?.() ?? Number.NaN : null, floor: () => null, slots: () => null, look: () => undefined,
    object: id => { const funnel = funnels.find((_, i) => whirls.slots[i]?.object === id); if (funnel === undefined) throw new Error(`No funnel ${id}`); return funnel; },
    draw: id => { if (id !== whirls.draw) throw new Error(`No draw ${id}`); return debris; } });
  if (program === null) throw new Error('Missing arena whirl view');
  return program;
}
