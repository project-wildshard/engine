import { isJsonData } from '@wildshard/format/json';
import type { Actor } from '@wildshard/engine/combat/pipeline';
import { lockOn } from '@wildshard/engine/player/AimTargets';
import type { FirstHints } from '@wildshard/engine/ui/FirstHints';
import { parseQuestHintRows, type QuestHintRows } from '@wildshard/format/questSteps';
import type { ShardContext } from '../plugin/context';

/** Read existing actors without changing their population or save ownership. */
export interface QuestHintBody {
  readonly position: { readonly x: number; readonly z: number };
  readonly alive: boolean; readonly hidden: boolean; readonly kind: string;
  readonly combatActor?: () => Actor;
}
/** The existing hints own appearance, used-control detection and persistence. */
export interface QuestHintPorts {
  readonly hints: Pick<FirstHints, 'feed' | 'done' | 'distance'>;
  readonly animals: () => readonly QuestHintBody[];
  readonly player: { readonly position: { readonly x: number; readonly z: number } };
  readonly prompt: () => string;
}
/** Ordered quest onboarding predicates; no UI, actor or save slot is created here. */
export class QuestHintFeed {
  readonly rows: QuestHintRows;
  private readonly hostile: ReadonlySet<string>;
  private nearest = Infinity;
  private scanT = 0;
  private windupT = Infinity;
  constructor(input: unknown, private readonly ports: QuestHintPorts, private readonly aim: { readonly state: string }) {
    this.rows = parseQuestHintRows(input);
    this.hostile = new Set(this.rows.hostile);
    ports.hints.feed(this.rows.hints.map(row => ({ control: row.control, when: () => row.when.every(condition => this.test(condition)),
      ...(row.touch === undefined ? {} : { touch: row.touch }), ...(row.desk === undefined ? {} : { desk: row.desk }) })));
  }
  private test(condition: QuestHintRows['hints'][number]['when'][number]): boolean {
    if (condition.kind === 'windup') return this.windupT < condition.seconds;
    if (condition.kind === 'nearest') return condition.relation === 'lt' ? this.nearest < condition.radius : this.nearest > condition.radius;
    if (condition.kind === 'done') return this.ports.hints.done(condition.control);
    if (condition.kind === 'lockable') return this.aim.state === 'available';
    if (condition.kind === 'prompt') return this.ports.prompt().includes(condition.contains);
    return this.ports.hints.distance >= condition.metres;
  }
  /** Observe the native wind-up event at its existing listener phase. */
  windup(actor: Actor): void {
    const body = this.ports.animals().find(candidate => candidate.combatActor?.() === actor);
    if (body === undefined) return;
    const player = this.ports.player.position;
    if (this.hostile.has(body.kind) && Math.hypot(body.position.x - player.x, body.position.z - player.z) < this.rows.windupRadius) this.windupT = 0;
  }
  /** The existing update scheduler calls this before its FirstHints update. */
  update(dt: number): void {
    this.windupT += dt; this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = this.rows.scanEvery;
    const player = this.ports.player.position, bodies = this.ports.animals();
    this.nearest = Infinity;
    for (let i = 0; i < Math.min(bodies.length, this.rows.maxScan); i++) {
      const body = bodies[i];
      if (body === undefined || !body.alive || body.hidden || !this.hostile.has(body.kind)) continue;
      this.nearest = Math.min(this.nearest, Math.hypot(body.position.x - player.x, body.position.z - player.z));
    }
  }
}
/** Bind authored onboarding rows to existing events, scheduler and hint owners. */

export function installQuestHints(ctx: ShardContext, input: unknown): void {
  if (ctx.scope.disposed || ctx.scope.disposing || !isJsonData(input)) throw new Error('Quest hints require live JSON rows');
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play, hints = play?.firstHints;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null || hints === undefined) throw new Error('Missing entered quest hint owners');
  const animals = play.animals, ui = ctx.app.ui;
  const feed = new QuestHintFeed(input, { hints, animals: () => animals.animals, player: world.player, prompt: () => ui.prompt() }, lockOn);
  ctx.on('ai.windup', ({ actor }) => { feed.windup(actor); });
  ctx.system({ ...feed.rows.system, phase: 'update', run: dt => { feed.update(dt); } });
}

/** Read hint rows over the exact entered native owners, refusing a leave or
 * replacement before any feed, listener or update system can be installed. */
export async function installQuestHintFile(ctx: ShardContext, file: string): Promise<void> {
  const scope = ctx.scope, product = ctx.product, runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play, hints = play?.firstHints;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null || hints === undefined) throw new Error('Missing entered quest hint owners');
  const animals = play.animals, player = world.player, ui = ctx.app.ui;
  const live = (): void => {
    if (scope.disposed || scope.disposing || ctx.scope !== scope || ctx.product !== product || ctx.game.runtime !== runtime
      || runtime.world !== world || runtime.play !== play || play.firstHints !== hints || play.animals !== animals
      || world.player !== player || ctx.app.ui !== ui) throw new Error('Quest hint owners left or changed during admission');
  };
  live();
  const input = await product.json(file);
  live();
  installQuestHints(ctx, input);
}
