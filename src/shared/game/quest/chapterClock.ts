import type { Scope } from '@wildshard/engine/app/scope';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import { chapterObservationReader, type ChapterDirectorRows } from '@wildshard/format/chapterDirector';
import { DirectorScriptStageLane, type readDirectorProduct } from '../plugin/director';
import { questPhaseSpan, questPhaseAt } from './storyLaw';

type ChapterEffect = ChapterDirectorRows['actions'][string][number];
interface Day { phase: number; readonly night: number; set: (phase: number) => Promise<void> }
/** Internal timing shared by the row-only page/native entry points. Concrete
 * entry adapters retain their presentation/effect owners and saved envelopes;
 * no shard hook or new scheduler crosses the public quest boundary. */
export class ChapterClock {
  readonly lane: DirectorScriptStageLane;
  readonly fast: { on: { from: number; span: number; t: number; dur: number; to: number } | null } = { on: null };
  constructor(private readonly scope: Scope, director: Awaited<ReturnType<typeof readDirectorProduct>>,
    private readonly rows: ChapterDirectorRows, private readonly flags: Flags,
    private readonly frame: { readonly day: Day | null; readonly player: { readonly x: number; readonly z: number };
      readonly reward: { readonly x: number; readonly z: number } | null; readonly finish: 'set' | 'assign' },
    private readonly publish: (effect: Exclude<ChapterEffect, { kind: 'phase' | 'flag' }>) => void, restoring = false) {
    const script = director.create();
    this.lane = new DirectorScriptStageLane(director.stages, script, { scope,
      observe: chapterObservationReader(rows.observations, { ...frame, flags }),
      emits: { source: rows.source, value: 'literal', actions: new Map(Object.keys(rows.actions)
        .filter(key => script.data.events.some(event => event.direction === 'output' && event.key === key)).map(key => [key, () => { this.run(key); }])) },
    }, restoring, rows.initialDt);
    scope.onDispose(flags.onChange((flag, on) => {
      if (!on) return;
      if (rows.changes.includes(flag)) this.lane.changed();
      for (const request of rows.requests) if ('flag' in request && flag === request.flag) this.lane.request(request.request);
    }));
  }
  run(id: string): void {
    if (this.scope.disposed) return;
    const effects = this.rows.actions[id]; if (effects === undefined) throw new Error(`Unknown chapter publication ${id}`);
    for (const effect of effects) {
      if (effect.kind === 'phase') {
        const day = this.frame.day;
        if (day !== null) this.fast.on = { from: day.phase, span: questPhaseSpan(day.phase, effect.to), t: 0, dur: effect.seconds, to: effect.to };
      } else if (effect.kind === 'flag') {
        if (effect.value === false) this.flags.clear(effect.flag); else this.flags.set(effect.flag);
      } else this.publish(effect);
    }
  }
  requestStep(step: string | undefined): void {
    for (const request of this.rows.requests) if ('step' in request && step === request.step) this.lane.request(request.request);
  }
  update(dt: number, step?: string): void {
    if (this.scope.disposed) return;
    const day = this.frame.day, fast = this.fast.on;
    if (fast !== null && day !== null) {
      fast.t += dt; day.phase = questPhaseAt(fast.from, fast.span, fast.t, fast.dur);
      if (fast.t / fast.dur >= 1) { this.fast.on = null; if (this.frame.finish === 'set') void day.set(fast.to); else day.phase = fast.to; }
    }
    this.requestStep(step); this.lane.update(dt);
  }
}
