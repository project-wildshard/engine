/**
 * The view half of declared movers (E6): binding a shard's rendered groups and native chains to the poses a mover
 * publishes. `NetMovers` feeds these views off `script` rows.
 */
import * as v from 'valibot';
import type { Object3D } from 'three';
import type { World } from '@wildshard/engine/core/bootstrap';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { NetClient } from '@wildshard/engine/net/client';
import type { PredictedMover } from '@wildshard/engine/net/predictionWorld';
import type { MoverPose } from '@wildshard/engine/physics/mover';
import { RopeChain } from '@wildshard/engine/physics/ropeChain';
import type { MoverData } from '@wildshard/format/movers';
import { installFollowedMovers, type FollowedMoverInstallation, type FollowedMovers, type MoverView } from './followedMovers';

/** One authored binding of a mover to a rendered group or a native chain of the constructed world. */
export interface BorrowedMoverRow {
  readonly id: string; readonly target: string; readonly chain?: boolean; readonly group?: 'group'; readonly visibility?: 'enabled';
  readonly order?: 'XYZ'; readonly afterPose?: 'refreshPose';
}
function hasPosePresentation(target: object): target is { refreshPose: () => void } {
  return 'refreshPose' in target && typeof target.refreshPose === 'function';
}
function isRenderedGroup(value: unknown): value is Object3D {
  return typeof value === 'object' && value !== null && 'isObject3D' in value && value.isObject3D === true;
}
const identifier = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_.-]{1,128}$/u));
const Rows = v.pipe(v.array(v.strictObject({ id: identifier, target: identifier, chain: v.exactOptional(v.boolean()), group: v.exactOptional(v.literal('group')),
  visibility: v.exactOptional(v.literal('enabled')), order: v.exactOptional(v.literal('XYZ')), afterPose: v.exactOptional(v.literal('refreshPose')) })), v.maxLength(32));

/** Admit data bindings for already constructed native resources: the views each row's mover poses. */
export function borrowedMoverViews(data: MoverData, input: readonly BorrowedMoverRow[], targets: unknown): ReadonlyMap<string, MoverView> {
  const views = new Map<string, MoverView>(), rows = v.parse(Rows, input);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate borrowed mover binding');
  if (targets === null || typeof targets !== 'object') throw new Error('Missing borrowed mover targets');
  for (const row of rows) {
    if (!Object.hasOwn(targets, row.target) || !data.some(value => value.id === row.id)) throw new Error('Unbound borrowed mover target');
    const target: unknown = Reflect.get(targets, row.target);
    if (row.chain === true) {
      if (!(target instanceof RopeChain) || row.group !== undefined || row.afterPose !== undefined) throw new Error('Borrowed mover requires its native chain');
      views.set(row.id, { chain: target, pose: () => undefined });
      continue;
    }
    if (target === null || typeof target !== 'object' || row.group === undefined || !('group' in target)
      || !isRenderedGroup(target.group)) throw new Error('Borrowed mover requires its rendered group');
    const group = target.group;
    if (row.afterPose !== undefined && !hasPosePresentation(target)) throw new Error('Missing borrowed pose presentation');
    group.userData['declaredMotion'] = true;
    views.set(row.id, { pose: pose => {
      if (row.visibility === 'enabled') group.visible = pose.enabled;
      group.position.set(pose.position.x, pose.position.y, pose.position.z);
      group.rotation.set(pose.euler.x, pose.euler.y, pose.euler.z, row.order ?? 'YXZ');
      if (row.afterPose !== undefined && hasPosePresentation(target)) target.refreshPose();
    } });
  }
  return views;
}

/** Admit data bindings for already constructed native resources (formerly `MoverRuntime.enter`). The caller
 * lends actual flags/prompts/assets; the page's mover host retains the fixed-step owner. */
export function enterMovers(ctx: LevelContext, world: World, data: MoverData,
    rows: { readonly systemId: string; readonly bindings: readonly BorrowedMoverRow[] }, targets: unknown,
    ports: Pick<FollowedMoverInstallation, 'prompts'> = {}): FollowedMovers {
  v.parse(v.strictObject({ systemId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)), bindings: v.unknown() }), rows);
  return installFollowedMovers(ctx, world, { ...ports, data, systemId: rows.systemId, views: borrowedMoverViews(data, rows.bindings, targets), restoreFlags: new Set() });
}

/** A deck this near the feet, or under them, stands in the present and not at render time. A far one costs a step nothing. */
const DECK_REACH = 24;
/** Ticks a deck runs on past its newest row: a page that has fallen behind its rows by half a second. */
const DECK_RUN_ON = 30;
interface Deck { readonly id: string; readonly handle: number; readonly view: MoverView }
/** A row's pose, or null for a row that doesn't hold one. */
function rowPose(row: ReturnType<NetClient['interpolator']['fields']>): MoverPose | null {
  if (row === null) return null;
  const { x, y, z, pitch, yaw, roll, enabled } = row;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof pitch !== 'number' || typeof yaw !== 'number' || typeof roll !== 'number') return null;
  return { position: { x, y, z }, euler: { x: pitch, y: yaw, z: roll }, enabled: enabled === true };
}

/**
 * The same views off the wire. Every `script` row the client holds poses the mover of that id: a far one once a frame at render
 * time, and a near one as `at` asks, a step at a time, in the tick its command meets it. A body on a deck drawn a render delay
 * behind the server is a correction a frame: the feet ride what the deck was, and one command later the server says otherwise.
 */
export class NetMovers implements PredictedMover {
  private readonly decks: Deck[] = [];
  constructor(private readonly client: NetClient, private readonly views: ReadonlyMap<string, MoverView>, private readonly feet: { readonly x: number; readonly z: number }) {}
  /** Once a frame. */
  frame(renderTick: number): void {
    const { client, views, decks, feet } = this;
    decks.length = 0;
    for (const [handle, info] of client.entities) {
      if (!info.id.startsWith('script:')) continue;
      const id = info.id.slice('script:'.length), view = views.get(id), pose = view === undefined ? null : rowPose(client.interpolator.fields(handle, renderTick));
      if (view === undefined || pose === null) continue;
      if (view.place !== undefined && Math.hypot(pose.position.x - feet.x, pose.position.z - feet.z) < DECK_REACH) decks.push({ id, handle, view });
      else view.pose(pose, {});
    }
  }
  /** Off a replay `tick`'s pose waits for the next physics step, as the server's does. On one no step comes: the command read the
   *  pose of the tick before it, as every server tick does, and `tick`'s waits for the step after the replay. */
  at(tick: number, replay: boolean): void {
    const { interpolator } = this.client;
    for (const { id, handle, view } of this.decks) {
      if (this.views.get(id) !== view) continue; // the page crossed since the frame
      const next = rowPose(interpolator.fields(handle, tick, DECK_RUN_ON));
      if (next === null) continue;
      if (!replay) { view.pose(next, {}); continue; }
      const here = rowPose(interpolator.fields(handle, tick - 1, DECK_RUN_ON));
      if (here !== null) view.place?.(here, next);
    }
  }
}
