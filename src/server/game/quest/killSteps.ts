import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import { parseQuestKillRows } from '@wildshard/format/questSteps';
import { createAchievementCounters, type AchievementDef } from '../../../shared/game/achievements';
import { QuestStepRunner } from '../../../shared/game/quest/steps';
import { commitQuestEffects } from '../../../shared/game/quest/effects';

/** Actor identity is borrowed; this observer never spawns, retires or saves actors. */
export interface QuestKilledBody {
  readonly kind: string;
  readonly actor: { readonly combatActor: () => unknown } | null;
}
/** A roster's lookup: the kind of the body that is `actor`. */
export function rosterKind(roster: () => readonly QuestKilledBody[]): (actor: unknown) => string | undefined {
  return actor => roster().find(candidate => candidate.actor?.combatActor() === actor)?.kind;
}
/** Run ordered kill steps and achievement counts in their existing listener phase. The authored adapter key and
 * exact flat count envelope are retained, including saturation and silent legacy restore. */
export function installQuestKillSteps(host: SimHost, input: unknown, feats: readonly Pick<AchievementDef, 'id' | 'kind' | 'count'>[],
  kindOf: (actor: unknown) => string | undefined, fact: (name: string, entity: string) => void): { readonly count: (id: string) => number } {
  const rows = parseQuestKillRows(input), kills = feats.filter(feat => feat.kind !== undefined);
  let counts: Record<string, number> = Object.fromEntries(kills.map(feat => [feat.id, 0]));
  const counter = createAchievementCounters({ feats: kills.map(feat => {
    if (feat.kind === undefined) throw new Error('Missing kill feat kind');
    return { id: feat.id, count: feat.count, kind: feat.kind };
  }), prefix: rows.prefix, floorTotals: false, validateTotals: true, write: 'each' },
  { read: () => counts, write: current => { counts = current; }, emit: fact });
  const saved = v.strictObject(Object.fromEntries(kills.map(feat => [feat.id, v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(feat.count))])));
  const runner = new QuestStepRunner(rows.runner);
  host.events.on('actor.died', ({ actor }) => {
    const kind = kindOf(actor);
    if (kind === undefined) return;
    commitQuestEffects(host, 'pack', runner.signal({ kind: 'kill', target: kind }, { flags: host.flags.all }));
    counter.kill(kind);
  }, host.scope);
  host.onStep(rows.step, () => undefined, { snapshot: () => ({ ...counts }), restore: value => { counts = v.parse(saved, value); } });
  return { count: id => Object.hasOwn(counts, id) ? counts[id] ?? 0 : 0 };
}
