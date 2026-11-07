import * as v from 'valibot';
import type { RoamingEncounterRow } from '@wildshard/format/bossEncounter';
import type { GroundBossBody, GroundBossFight } from './roaming';

const finite = v.pipe(v.number(), v.finite());
const Stream = v.strictObject({ version: finite, state: finite, initial: finite, scrambledFork: v.boolean() });
const Runner = v.strictObject({ version: finite, phase: v.picklist(['idle', 'windup', 'active', 'recover', 'cooldown']), currentId: v.nullable(v.string()), hit: v.boolean(),
  elapsed: finite, speedMul: finite, clock: finite, deadlines: v.array(v.strictObject({ id: v.string(), at: finite })), scores: v.array(v.strictObject({ id: v.string(), score: finite })),
  x0: finite, z0: finite, x1: finite, z1: finite, yaw: finite, length: finite });
const Lane = v.strictObject({ tellT: finite, runner: Runner });
const Fight = v.strictObject({ body: v.nullable(v.string()), present: v.boolean(), sealed: v.boolean(), sealK: finite, darkK: finite, glow: finite,
  decision: v.exactOptional(v.string()), invuln: v.boolean(), lockHp: finite, won: v.boolean(), phase: finite, mode: v.string(), modeT: finite, strikeCd: finite, burstCd: finite, summonCd: finite, chain: finite, open: finite,
  lane: Lane, rings: v.array(v.strictObject({ r: finite, on: v.boolean(), hit: v.boolean(), delay: finite })),
  hazards: v.array(v.strictObject({ x: finite, z: finite, y: finite, fallT: finite, acc: finite })),
  adds: v.array(v.strictObject({ a: v.string(), lane: finite, mode: v.picklist(['approach', 'charge']) })), addLanes: v.array(Lane), rngs: v.array(Stream) });

/** Encode existing saves in authored key order without replaying a decision or view. */
export function roamingFightState<B extends GroundBossBody>(row: RoamingEncounterRow, fight: GroundBossFight<B>): Record<string, unknown> {
  const state = fight.snapshot(), values = new Map(Object.entries(state));
  const saved: Record<string, unknown> = {};
  if (state.decision !== undefined) saved['decision'] = state.decision;
  for (const [wire, field] of row.wire) saved[wire] = values.get(field);
  return saved;
}
/** Validate the whole native continuation, then re-adopt existing roster bodies by ID.
 * The guest adapter preserves restored attack/motion when binding an old save. */
export function restoreRoamingFight<B extends GroundBossBody>(row: RoamingEncounterRow, fight: GroundBossFight<B>, input: unknown, bodiesById: ReadonlyMap<string, B>): void {
  const wire = v.parse(v.record(v.string(), v.unknown()), input);
  const allowed = new Set(['decision', 'first', 'lightActive', 'hidden', ...row.wire.map(([name]) => name)]);
  if (Object.keys(wire).some(name => !allowed.has(name))) throw new Error('Unknown boss continuation field');
  const state = v.parse(Fight, Object.fromEntries([...(wire['decision'] === undefined ? [] : [['decision', wire['decision']]]), ...row.wire.map(([name, field]) => [field, wire[name]])]));
  const bodies = new Map<string, B>();
  for (const id of [...(state.body === null ? [] : [state.body]), ...state.adds.map(add => add.a)]) {
    const actor = bodiesById.get(id); if (actor !== undefined) bodies.set(id, actor);
  }
  fight.restore(state, bodies);
}
