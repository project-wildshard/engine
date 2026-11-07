import { Vector3 } from 'three';
import type { World } from '@wildshard/engine/core/bootstrap';
import type { LevelContext } from '@wildshard/engine/level/context';
import { KinematicMover, type MoverPose } from '@wildshard/engine/physics/mover';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { RopeChain } from '@wildshard/engine/physics/ropeChain';
import { MoverLifecycle, moverEndState } from '@wildshard/engine/sim/moverLifecycle';
import type { ScriptEntity } from '@wildshard/engine/script/effects';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { parseMovers, type MoverData } from '@wildshard/format/movers';
import { moverScriptEntities } from '../../../shared/game/shardfile/movers';
import { carryPrompt } from '../../../shared/game/shardfile/wirePrompts';
import { wirePage } from '../shardfile/wirePage';

/** What a mover poses on a page. `place` is a replay's deck: its collider stands at `at` now, and `next` waits for the physics step after the replay. */
export interface MoverView {
  pose: (value: MoverPose, fields: Readonly<Record<number, number>>) => void; chain?: RopeChain;
  place?: (at: MoverPose, next: MoverPose) => void;
}
/** Rows without a move before a carry counts as stopped: a client's rows arrive in steps. */
const STILL = 30;

/**
 * The movers on a page (J130): the server steps them, and each row poses the collider prediction walks on and the view
 * that draws it. No script, no save and no fixed step run here; a prompt only asks.
 */
export class FollowedMovers {
  readonly data: MoverData;
  readonly chains: Map<string, RopeChain> = new Map<string, RopeChain>();
  private readonly entities: Map<number, ScriptEntity>;
  private readonly sinks = new Map<string, (pose: MoverPose) => void>();
  private readonly views = new Map<string, (pose: MoverPose) => void>();
  private readonly bodies = new Map<string, KinematicMover>();
  private readonly poses = new Map<string, MoverPose>();
  private readonly seen = new Map<string, { x: number; y: number; z: number; still: number }>();
  private readonly lifecycle: MoverLifecycle;
  constructor(data: MoverData, ports: { readonly physics: Physics; readonly scope: Scope; readonly adopt?: (id: string) => MoverView | undefined; readonly restoreFlags?: ReadonlySet<string> }) {
    this.data = parseMovers(data);
    this.lifecycle = new MoverLifecycle(this.data.map(row => ({ id: row.id, ...(row.atEnd === undefined ? {} : { atEnd: row.atEnd }), ...(row.restoreFrom === undefined ? {} : { restoreFrom: row.restoreFrom }) })));
    if (this.data.some(row => row.restoreFrom !== undefined) && ports.restoreFlags === undefined) throw new Error('Mover restore requires saved flag data');
    this.entities = new Map(moverScriptEntities(this.data).map(entity => [entity.id, entity]));
    for (const row of this.data) {
      const entity = this.entity(row);
      if (row.restoreFrom !== undefined && ports.restoreFlags?.has(row.restoreFrom.flag) === true) { const end = moverEndState(row); entity.position = [...end.position]; entity.fields = { ...entity.fields, ...end.fields }; }
      this.lifecycle.seed(row.id, entity.fields);
    }
    for (const row of this.data) {
      const adopted = ports.adopt?.(row.id);
      if (adopted !== undefined) {
        const chain = adopted.chain; let enabled = row.enabled;
        const draw = (pose: MoverPose): void => { adopted.pose(pose, this.entity(row).fields); };
        this.sinks.set(row.id, pose => { if (chain !== undefined && enabled !== pose.enabled) { enabled = pose.enabled; chain.setEnabled(enabled); } draw(pose); });
        this.views.set(row.id, draw);
        if (chain !== undefined) this.chains.set(row.id, chain);
      } else if (row.kind === 'chain') {
        if (row.chain === undefined) throw new Error('Missing chain');
        const chain = new RopeChain(ports.physics, row.chain); this.chains.set(row.id, chain);
        let enabled = row.enabled; chain.setEnabled(enabled);
        this.sinks.set(row.id, pose => { if (enabled !== pose.enabled) { enabled = pose.enabled; chain.setEnabled(enabled); } });
        ports.scope.onDispose(() => { chain.dispose(); });
      } else if (row.kind !== 'channel') {
        const body = new KinematicMover(ports.physics, row.boxes, this.pose(row.id), row.id, row.kind === 'static'); this.bodies.set(row.id, body);
        this.sinks.set(row.id, pose => { body.setPose(pose); });
        ports.scope.onDispose(() => { body.dispose(); });
      }
    }
  }
  private entity(row: MoverData[number]): ScriptEntity {
    const entity = this.entities.get(row.entity); if (entity === undefined) throw new Error('Missing mover script entity'); return entity;
  }
  /** Pose a mover off a server's row: its collider and its view. */
  follow(id: string, pose: MoverPose): void {
    this.sinks.get(id)?.(pose); this.poses.set(id, pose);
    if (!this.data.some(row => row.id === id && row.carry !== undefined)) return;
    const was = this.seen.get(id), at = pose.position;
    if (was === undefined) { this.seen.set(id, { x: at.x, y: at.y, z: at.z, still: STILL }); return; }
    was.still = was.x === at.x && was.y === at.y && was.z === at.z ? was.still + 1 : 0;
    was.x = at.x; was.y = at.y; was.z = at.z;
  }
  /** A replay of a command under a predicted body: no physics steps between replayed commands, so the deck goes where this one
   * meets it at once, and the pose the next live step carries from waits behind it. */
  replayPose(id: string, at: MoverPose, next: MoverPose): void { const body = this.bodies.get(id); body?.resetPose(at); body?.setPose(next); }
  /** Nothing steps here, so the only ride this page knows is one it sees move. */
  riding(id?: string): boolean {
    const rows = id === undefined ? this.data : this.data.filter(row => row.id === id);
    if (id !== undefined && rows.length === 0) throw new Error('Unknown mover');
    return rows.some(row => row.carry !== undefined && (this.seen.get(row.id)?.still ?? STILL) < STILL);
  }
  /** The endpoint it entered at: a server's mover moves on from it, and a quest hears that through flags. */
  atEnd(id: string): boolean { return this.lifecycle.atEnd(id); }
  /** A mover's script field at entry. */
  field(id: string, field: number): number | undefined { const row = this.data.find(entry => entry.id === id); return row === undefined ? undefined : this.entity(row).fields[field]; }
  pose(id: string): MoverPose {
    const held = this.poses.get(id); if (held !== undefined) return held;
    const row = this.data.find(entry => entry.id === id); if (row === undefined) throw new Error('Unknown mover');
    const entity = this.entity(row);
    return { position: { x: entity.position[0], y: entity.position[1], z: entity.position[2] }, euler: { x: entity.fields[1] ?? 0, y: entity.fields[2] ?? 0, z: entity.fields[3] ?? 0 }, enabled: !entity.frozen && entity.fields[4] === 1 };
  }
  /** The declared prompts a carry takes: the press goes by `wireId`, and the server decides. */
  ridePrompts(): Interactable[] {
    const busy = (): boolean => this.riding();
    return this.data.flatMap(row => row.carry?.prompts.map((prompt, end): Interactable => ({ position: new Vector3(...prompt.at),
      get radius() { return busy() ? 0 : prompt.radius; }, label: prompt.label, wireId: carryPrompt(row.id, end), onInteract: () => undefined })) ?? []);
  }
  /** Draw every adopted view at its declared rest pose, presentation only: the map bake reads it. */
  showRest(): void {
    for (const row of this.data) this.views.get(row.id)?.({ position: { x: row.at.x, y: row.at.y, z: row.at.z }, euler: { x: row.euler.x, y: row.euler.y, z: row.euler.z }, enabled: row.enabled });
  }
}

/** What a page's movers are lent. */
export interface FollowedMoverInstallation {
  readonly data: MoverData; readonly systemId: string; readonly views?: ReadonlyMap<string, MoverView>;
  readonly prompts?: Interactable[]; readonly restoreFlags?: ReadonlySet<string>; readonly onDispose?: () => void;
}
/** Install a page's movers on its level, and hand each to the rows that pose it. */
export function installFollowedMovers(ctx: LevelContext, world: World, options: FollowedMoverInstallation): FollowedMovers {
  if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Mover scope left during admission');
  const views = options.views, movers = new FollowedMovers(options.data, { physics: world.physics, scope: ctx.scope,
    ...(views === undefined ? {} : { adopt: (id: string) => views.get(id) }), ...(options.restoreFlags === undefined ? {} : { restoreFlags: options.restoreFlags }) });
  options.prompts?.push(...movers.ridePrompts());
  ctx.scope.onDispose(() => { if (movers.riding()) world.player.carried = false; });
  if (options.onDispose !== undefined) ctx.scope.onDispose(options.onDispose);
  ctx.debug.expose(`movers.${options.systemId}`, { showRest: () => { movers.showRest(); } }); // the map bake poses movers at rest
  for (const row of options.data) wirePage.movers.set(row.id, { pose: pose => { wirePage.posed++; movers.follow(row.id, pose); }, place: (at, next) => { movers.replayPose(row.id, at, next); } });
  return movers;
}
