// CI12 Nalati chapter: the quest observation split out of readQuestObservation (questObservation, page-free) answers
// exactly as the page's inline read did, calls the same owners in the same order, and refuses and recovers the same way.
import { expect, test } from 'vitest';
import type { ObservationRef } from '@wildshard/format/sceneRefs';
import { questObservation, type ObservedQuest, type ObservedRecords } from '../src/shared/game/quest/questObservation';

interface World {
  readonly flags: Set<string>; readonly quests: Map<string, ObservedQuest>; readonly active: ObservedQuest | undefined;
  readonly records: ObservedRecords; readonly log: string[];
}
/** readQuestObservation before the split (chapterBindings.ts, before CI12), over the same owners */
function inline(world: World, ref: ObservationRef): number {
  const bound = (id: string): ObservedQuest => { world.log.push(`quest ${id}`); const q = world.quests.get(id); if (q === undefined) throw new Error(`Quest ${id} is not bound in this entry`); return q; };
  if ('flag' in ref) { world.log.push('flags'); return Number(world.flags.has(ref.flag)); }
  if ('quest' in ref) {
    const state = bound(ref.quest);
    if (ref.state === 'complete' && !state.isComplete) return 0;
    if (ref.state === 'active') { world.log.push('active'); if (world.active !== state) return 0; }
    return Number(ref.step === undefined ? ref.state === 'active' || state.isComplete : state.current?.id === ref.step);
  }
  if (!('saved' in ref)) throw new Error('Observation requires its admitted scene owner');
  world.log.push('saved');
  const persistence = world.records, row = ref.saved;
  if (row.record === 'bosses') {
    const saved = persistence.bosses.read()[row.id];
    return saved === undefined ? 0 : Number(saved[row.field]);
  }
  if (row.field !== 'kills') throw new Error('Elite observation requires its kill field');
  let saved: ReturnType<ObservedRecords['elites']['read']>;
  try { saved = persistence.elites.read(); } catch { return 0; }
  return saved[row.id]?.kills ?? 0;
}
function split(world: World, ref: ObservationRef): number {
  return questObservation(ref, {
    flags: () => { world.log.push('flags'); return world.flags; },
    quest: id => { world.log.push(`quest ${id}`); const q = world.quests.get(id); if (q === undefined) throw new Error(`Quest ${id} is not bound in this entry`); return q; },
    active: () => { world.log.push('active'); return world.active; },
    saved: () => { world.log.push('saved'); return world.records; },
  });
}

const ids = ['tulpar', 'kokpar', 'balbal', 'missing'], steps = ['pond', 'ridge', 'king', 'absent'];
function worldOf(n: number): World {
  const quests = new Map<string, ObservedQuest>(ids.slice(0, 3).map((id, i) => [id, { isComplete: (n >> i) % 2 === 1, current: (n + i) % 3 === 0 ? null : { id: steps[(n + i) % 4] ?? 'pond' } }]));
  const bosses = { king: { defeated: n % 2 === 0, rewardTaken: n % 3 === 0, kills: n % 4 } }, elites = { kokbori: { kills: n % 5 } };
  return { flags: new Set(n % 2 === 0 ? ['seen:camp', 'lit:pond'] : ['seen:camp']), quests, active: quests.get(ids[n % 4] ?? 'tulpar'), log: [],
    records: { bosses: { read: () => { if (n % 13 === 0) throw new Error('Boss record failed'); return bosses; } },
      elites: { read: () => { if (n % 7 === 0) throw new Error('Elite record failed'); return elites; } } } };
}
function refOf(n: number): ObservationRef {
  const k = n % 9, quest = ids[(n >> 2) % 4] ?? 'tulpar', step = n % 5 === 0 ? undefined : steps[(n >> 3) % 4];
  if (k === 0) return { flag: n % 2 === 0 ? 'lit:pond' : 'seen:camp' };
  if (k <= 3) return step === undefined ? { quest, ...(k === 1 ? {} : { state: k === 2 ? 'active' : 'complete' }) } : { quest, step, ...(k === 1 ? {} : { state: k === 2 ? 'active' : 'complete' }) };
  if (k <= 6) return { saved: { record: 'bosses', id: n % 3 === 0 ? 'absent' : 'king', field: (['defeated', 'rewardTaken', 'kills'] as const)[k - 4] ?? 'defeated' } };
  return { saved: { record: 'elites', id: n % 3 === 0 ? 'absent' : 'kokbori', field: k === 7 ? 'kills' : 'defeated' } };
}
const outcome = (read: () => number): string => { try { return `= ${String(read())}`; } catch (error) { return `! ${error instanceof Error ? error.message : String(error)}`; } };

test('the split observation answers, reads and refuses exactly as the page read did', () => {
  const answers = new Set<string>();
  for (let n = 0; n < 3000; n++) {
    const ref = refOf(n), a = worldOf(n), b = worldOf(n), before = outcome(() => inline(a, ref)), after = outcome(() => split(b, ref));
    expect(after).toBe(before); expect(b.log).toEqual(a.log); answers.add(before);
  }
  // every kind of answer came round: 0 / 1 / counts, both refusals and an unbound quest
  for (const seen of ['= 0', '= 1', '= 3', '! Elite observation requires its kill field', '! Boss record failed', '! Quest missing is not bound in this entry']) expect(answers).toContain(seen);
});

test('only an elite record read failure answers 0; a scene ref without an owner refuses', () => {
  const world = worldOf(7);
  expect(split(world, { saved: { record: 'elites', id: 'kokbori', field: 'kills' } })).toBe(0);
  expect(() => split(worldOf(13), { saved: { record: 'bosses', id: 'king', field: 'defeated' } })).toThrow('Boss record failed');
  for (const scene of [{ mover: 'ferry', state: 'moving' }, { mark: 'camp' }] satisfies ObservationRef[])
    expect(() => split(world, scene)).toThrow('Observation requires its admitted scene owner');
});
