/**
 * G600 L7: a declared view program (client plan `view.program`, format/viewProgram) on its entered world. It admits the
 * module's v2 view contract, lends the program its world (player, camera, registry floors), the entered objects its rows
 * name (entry-owner `object` loans) and the lent looks its channels write, and runs it in its rows' update system, or
 * inline in its owner's update where the owner calls the frame slot it lends (rows `slot`).
 */
import {isJsonData} from '@wildshard/format/json';
import type { InstancedMesh } from 'three';
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { viewProgram, type ViewProgram, type ViewSlots, type ViewTell } from '@wildshard/engine/script/viewProgram';
import { prepareViewMemory } from '@wildshard/engine/script/viewLane';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { speciesViewSlots } from '../population/speciesViewSlots';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../plugin/context';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import { setLentParam } from './lentLooks';

const lentSlots = new WeakMap<Scope, Map<string, ViewSlots>>(), lentValues = new WeakMap<Scope, Map<string, (field: string) => number>>();
const lentCells = new WeakMap<Scope, Map<string, { value: number }>>(), lentTells = new WeakMap<Scope, Map<string, ViewTell>>();
const lentArrays = new WeakMap<Scope, Map<string, () => ArrayLike<number>>>(), lentDraws = new WeakMap<Scope, Map<string, InstancedMesh>>();
/** an owner's inline frame slot: the program its rows install there (built once the owner lends it) */
interface FrameSlot { build: (() => ViewProgram | null) | null; program: ViewProgram | null }
const lentFrames = new WeakMap<Scope, Map<string, FrameSlot>>(), installedFrames = new WeakMap<Scope, Map<string, () => ViewProgram | null>>();
/** One lender book a scope: lend `value` as `id` for the scope's life (refused twice or once the scope is leaving). */
function lend<T>(books: WeakMap<Scope, Map<string, T>>, scope: Scope, id: string, value: T, what: string): void {
  let book = books.get(scope); if (book === undefined) { book = new Map(); books.set(scope, book); }
  if (book.has(id) || scope.disposed || scope.disposing) throw new Error(`View ${what} cannot be lent: ${id}`);
  const held = book; held.set(id, value); scope.onDispose(() => { held.delete(id); });
}
/** Check an owner's complete values/draw/frame inventory before lending any
 * resources. This neither allocates a program nor reserves a loan. */
export function preflightViewLends(scope:Scope,rows:{readonly values?:readonly string[];readonly draws?:readonly string[];readonly frames?:readonly string[]}):void{
  if(!isJsonData(rows)||Object.keys(rows).some(key=>key!=='values'&&key!=='draws'&&key!=='frames'))throw new Error('View inventory requires plain JSON rows');
  if(scope.disposed||scope.disposing)throw new Error('View lender scope has ended');
  for(const [kind,book]of [['values',lentValues],['draws',lentDraws],['frames',lentFrames]] as const){
    const ids=rows[kind]??[];
    if(new Set(ids).size!==ids.length||ids.some(id=>!/^[A-Za-z][A-Za-z0-9_.:-]{0,255}$/u.test(id)||book.get(scope)?.has(id)===true))throw new Error(`Conflicting view ${kind} loans`);
  }
}
/** An owner lends a numeric snapshot (named finite fields, read once a frame and never written back) to its scope's view programs. */
export function lendViewValues(scope: Scope, source: string, read: (field: string) => number): void { lend(lentValues, scope, source, read, 'values'); }
/** An owner lends its inline frame slot, after the values, cells and tells the slot's program samples and writes: the
 * program builds now (or when it installs, if later) and runs only where the owner calls `frame` in its own update;
 * `frame` says whether the module ran (false before it builds, or on a frame its lane's rate skips). */
export function lendViewFrame(scope: Scope, id: string): { frame: (dt: number, time: number) => boolean } {
  const slot: FrameSlot = { build: installedFrames.get(scope)?.get(id) ?? null, program: null };
  lend(lentFrames, scope, id, slot, 'frame'); slot.program = slot.build?.() ?? null;
  return { frame: (dt, time) => scope.disposed||scope.disposing?false:slot.program?.frame(dt, time) ?? false };
}
/** An owner lends a numeric array its scope's view programs read whole once a frame (`arrays` rows), never written back. */
export function lendViewArray(scope: Scope, id: string, read: () => ArrayLike<number>): void { lend(lentArrays, scope, id, read, 'array'); }
/** An owner lends an instanced draw its scope's view programs write in bulk (`batches` rows: its count, matrices, attribute). */
export function lendViewDraw(scope: Scope, id: string, draw: InstancedMesh): void { lend(lentDraws, scope, id, draw, 'draw'); }
/** An owner lends a numeric cell its scope's view programs write (`cell` channels); it reads the cell after their frame. */
export function lendViewCell(scope: Scope, id: string, cell: { value: number }): void { lend(lentCells, scope, id, cell, 'cell'); }
/** An owner lends a ground tell its scope's view programs draw (`tell` channels). */
export function lendViewTell(scope: Scope, id: string, tell: ViewTell): void { lend(lentTells, scope, id, tell, 'tell'); }

export function installViewProgram(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'view.program' }>, module: Uint8Array): void {
  const world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('View program requires its entered world');
  const bytes = Uint8Array.from(module);
  admitScriptV2(bytes, { lane: 'view', ioBytes: row.rows.budget.ioBytes });
  const { system, slot } = row.rows;
  if (slot !== undefined && (ctx.scope.disposed || ctx.scope.disposing || installedFrames.get(ctx.scope)?.has(slot) === true))
    throw new Error(`View frame program cannot be lent: ${slot}`);
  // Feature admission already yields between rows. Reserve a slot's fresh
  // memory here instead of allocating several when its native owner binds.
  const preparedMemory = slot !== undefined && !lentFrames.get(ctx.scope)?.has(slot)
    ? prepareViewMemory(bytes, row.rows.budget.pages, ctx.scope) : undefined;
  // a pool group `species:<kind>` is every live actor of that kind (game/population/speciesViewSlots), one lender per group
  const species = new Map<string, ViewSlots>();
  const speciesPool = (group: string): ViewSlots | null => {
    if (!group.startsWith('species:')) return null;
    let slots = species.get(group);
    if (slots === undefined) {
      const count = row.rows.pools.find(pool => pool.group === group)?.count ?? 64;
      slots = speciesViewSlots(() => ctx.game.runtime?.play?.animals.animals ?? null, group.slice('species:'.length), count, terrainHeight);
      species.set(group, slots);
    }
    return slots;
  };
  const build = (): ViewProgram | null => viewProgram(bytes, row.rows, { scope: ctx.scope, player: world.player, camera: world.game.camera,
    ...(preparedMemory === undefined ? {} : { preparedMemory }),
    floor: piece => { const found = world.registry.get(piece); return found === undefined ? null : (x, z) => found.floor?.(x, z); },
    slots: group => lentSlots.get(ctx.scope)?.get(group) ?? speciesPool(group), values: source => lentValues.get(ctx.scope)?.get(source) ?? null, object: id => entryOwner(ctx.scope, 'object', id),
    cell: id => { const cell = lentCells.get(ctx.scope)?.get(id); if (cell === undefined) throw new Error(`View cell ${id} is not lent`); return cell; },
    tell: id => { const tell = lentTells.get(ctx.scope)?.get(id); if (tell === undefined) throw new Error(`View tell ${id} is not lent`); return tell; },
    array: id => { const read = lentArrays.get(ctx.scope)?.get(id); if (read === undefined) throw new Error(`View array ${id} is not lent`); return read; },
    draw: id => { const draw = lentDraws.get(ctx.scope)?.get(id); if (draw === undefined) throw new Error(`View draw ${id} is not lent`); return draw; }, look: (look, param, value) => { setLentParam(look, param, value); } });
  if (slot !== undefined) {
    lend(installedFrames, ctx.scope, slot, build, 'frame program');
    const lent = lentFrames.get(ctx.scope)?.get(slot); if (lent !== undefined) { lent.build = build; lent.program = build(); }
    return;
  }
  const program = build();
  if (program === null || system === undefined) return;
  ctx.system({ id: system, phase: 'update', before: [...row.rows.before], run: (dt, time) => { program.frame(dt, time); } });
}
