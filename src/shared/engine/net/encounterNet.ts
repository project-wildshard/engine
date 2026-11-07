import { ENCOUNTER_STATES, type EncounterNetView } from '../sim/encounterRows';
import { netSchema, type NetSchema } from './schema';

// P1-E3.4 (E5-REPLICATION §3.2): what a boss bar or an elite bar shows. No position: a bar is shown anywhere in the cell.
const metres = { kind: 'f32q', min: -260, max: 260, bits: 16 } as const;
/** The `encounter` class. */
export const ENCOUNTER_NET: NetSchema<EncounterNetView> = netSchema<EncounterNetView>({
  cls: 'encounter',
  fields: {
    state: { kind: 'enum', values: ENCOUNTER_STATES, read: view => view.state },
    hp: { kind: 'f32q', min: 0, max: 1, bits: 10, read: view => Math.max(0, Math.min(1, view.hp)) },
    phase: { kind: 'u8', read: view => view.phase },
    shield: { kind: 'bool', read: view => view.shield },
    body: { kind: 'ref', read: view => view.body },
    skip: { kind: 'f32q', min: 0, max: 1, bits: 6, read: view => view.skip },
    banners: { kind: 'u8', read: view => view.banners % 256 },
    signatures: { kind: 'u8', read: view => view.signatures % 256 },
    known: { kind: 'bool', read: view => view.known },
    sleep: { kind: 'f32q', min: 0, max: 1, bits: 8, read: view => view.sleep },
    rewarded: { kind: 'bool', read: view => view.reward !== null },
    rewardX: { ...metres, read: view => view.reward?.x ?? 0 },
    rewardY: { ...metres, read: view => view.reward?.y ?? 0 },
    rewardZ: { ...metres, read: view => view.reward?.z ?? 0 },
    kind: { kind: 'text', send: 'initial', read: view => view.kind },
  },
});
