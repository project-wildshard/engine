import type { ShardContext } from '../plugin/context';
import type { TimedEncountersRows } from '@wildshard/format/encounterRows';
import type { BufferGeometry, Vector3 } from 'three';
import { app } from '@wildshard/engine/app/runtime';
import type { TargetHit } from '@wildshard/engine/combat/types';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Game } from '@wildshard/engine/core/Game';
import type { Player } from '@wildshard/engine/player/Player';
import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { CueDirector } from '../audio/cueDirector';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { PATROL_SHOT, PATROL_TEAR } from '../../../shared/game/shardfile/wirePrompts';
import { pageAir } from '../population/pageAir';
import { wirePage } from '../shardfile/wirePage';
import { PatrolEncounterView, SlotEncounterView, type EncounterSites } from './encounterView';
import { SlotRowsView } from './slotRowsView';

interface TimedEncounterContext {
  readonly game: Game; readonly sky: SkyRig; readonly player: Player; readonly forest: Forest;
  readonly sites: EncounterSites | null; readonly clock: DayCycleClock;
}
/** Encounters on the day clock (format/encounterRows TimedEncounters): a slot encounter waking its sites and a patrol of
 *  riders, each in its declared day phases, over their AS program and native slot/patrol views; the riders' contact strike
 *  hits the player through cover. Its owner borrows the declared cue presentation. */
export class TimedEncounters {
  readonly slots: SlotEncounterView; readonly riders: PatrolEncounterView;
  private readonly rows;
  /** On the wire the server runs the night: this draws its rows, and no law steps here. */
  private readonly rowsView: SlotRowsView | null;
  private animals: RowBodiesView | null = null;
  /** A cue this page only heard: drawn, and counted for a proof. */
  private readonly heard: Pick<CueDirector, 'cue'> = { cue: (id, at, up) => { wirePage.drew(id); this.cues.cue(id, at, up); } };
  constructor(ctx: TimedEncounterContext, input: TimedEncountersRows,
    figures: Readonly<Record<string, BufferGeometry>>, guest: ReturnProgram, private readonly cues: CueDirector) {
    const rows = this.rows = input, scope = ctx.game.levelScope;
    if (scope.disposed) throw new Error('Encounter owner was disposed during admission');
    const program = ReturnProgram.page(rows.program, scope);
    this.slots = new SlotEncounterView(rows.slots, rows.view, program, { scene: ctx.game.scene, cues: this.cues, sites: ctx.sites?.sites ?? null, guest });
    this.riders = new PatrolEncounterView({ patrol: rows.patrol, motion: rows.motion, view: rows.ride }, program,
      { game: ctx.game, sky: ctx.sky, player: ctx.player, forest: ctx.forest, cues: this.cues, figures });
    const actors = rows.slots.actors, sites = ctx.sites;
    this.rowsView = actors !== undefined && sites !== null ? new SlotRowsView(actors.kind, rows.view, sites, this.slots.tells, { cues: this.heard, guest, row: name => wirePage.row(name), cosmetic: () => app.rng.stream('cosmetic').next(), drew: what => { wirePage.drew(what); } }) : null;
    wirePage.whenLive(scope, client => client.onView(({ name, args }) => {
      if (name === PATROL_TEAR) this.riders.hearTear(args, this.heard);
      if (name !== PATROL_SHOT) return;
      this.riders.hearShot(args); wirePage.drew('shot');
    }));
  }
  /** Borrow declared presentation owners while the encounter keeps its clock. */
  static async install(owner: ShardContext, ctx: TimedEncounterContext, file: string,
    figures: Readonly<Record<string, BufferGeometry>>, guest: ReturnProgram): Promise<TimedEncounters> {
    const scope = owner.scope, construction = ctx.game.levelScope, product = owner.product;
    const live = (): void => {
      if (scope.disposed || scope.disposing || construction.disposed || construction.disposing || owner.scope !== scope
        || owner.product !== product || ctx.game.levelScope !== construction) throw new Error('Encounter owner left during admission');
    };
    live();
    const input = await owner.product.json<TimedEncountersRows>(file);
    live();
    const presentation = CueDirector.entered(owner,input.presentation);
    if (presentation === undefined) throw new Error('Missing declared encounter presentation');
    return scope.run(() => new TimedEncounters(ctx, input, figures, guest, presentation));
  }
  update(dt: number, _time: number): void {
    const { rows, rowsView } = this;
    rowsView?.update(dt, this.animals?.animals ?? []);
    const riders = rows.patrol.actors?.kind;
    if (this.animals !== null && riders !== undefined) this.riders.showRows(riders, this.animals.animals, dt, this.heard);
    this.riders.flyRows(dt);
    if (this.riders.arrows.inFlight > 0) wirePage.drew('arrow frame');
    this.cues.setLight(Math.max(rows.lightFloor, pageAir.light)); this.cues.update(dt);
  }
  attach(animals: RowBodiesView): void {
    this.animals = animals;
    try { this.slots.attachActors(animals); } catch (cause) { console.error('[encounters] slot actors disabled:', cause); }
    try { this.riders.attachActors(animals); } catch (cause) { console.error('[encounters] patrol actors disabled:', cause); }
  }
  target(origin: Vector3, direction: Vector3, maxDistance: number, hit: TargetHit | null): TargetHit | null {
    return this.riders.target(origin, direction, maxDistance, hit);
  }
}
