import type { EncounterNetView } from '../sim/encounterRows';
import { ENCOUNTER, ENCOUNTER_STATES } from '@wildshard/wire/classes';
import { bindClass, type NetSchema } from './schema';

// P1-E3.4 (E5-REPLICATION §3.2): what a boss bar or an elite bar shows. No position: a bar is shown anywhere in the cell.
/** A state the wire declares for a bar. */
type EncounterState = (typeof ENCOUNTER_STATES)[number];
const DECLARED: ReadonlySet<string> = new Set(ENCOUNTER_STATES);
const isDeclared = (state: string): state is EncounterState => DECLARED.has(state);
/** A brain's state as the wire carries it; an undeclared one throws, as the v0 column always has. */
function declaredState(state: string): EncounterState {
  if (!isDeclared(state)) throw new RangeError(`Undeclared state value ${state}`);
  return state;
}
/** The `encounter` class. */
export const ENCOUNTER_NET: NetSchema<EncounterNetView> = bindClass<EncounterNetView, typeof ENCOUNTER>(ENCOUNTER, {
  state: view => declaredState(view.state),
  hp: view => Math.max(0, Math.min(1, view.hp)),
  phase: view => view.phase,
  shield: view => view.shield,
  body: view => view.body,
  skip: view => view.skip,
  banners: view => view.banners % 256,
  signatures: view => view.signatures % 256,
  known: view => view.known,
  sleep: view => view.sleep,
  rewarded: view => view.reward !== null,
  rewardX: view => view.reward?.x ?? 0,
  rewardY: view => view.reward?.y ?? 0,
  rewardZ: view => view.reward?.z ?? 0,
  kind: view => view.kind,
});
