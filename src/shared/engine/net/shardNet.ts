import type { ScriptNetView, StateNetRow } from '../sim/shardRows';
import { netSchema, type NetSchema } from './schema';

// P1-E3.10 (E5-REPLICATION §3.2): shard state as a client reads it. Authors never declare wire fields: these three
// tables carry any shard. A guest's memory, clocks and host-only fields stay on the server.
/** The `script` class: a shard-script body's pose. No relevance radius: a far lift still has to be where it is. */
export const SCRIPT_NET: NetSchema<ScriptNetView> = netSchema<ScriptNetView>({
  cls: 'script',
  fields: {
    // Exact: a client's prompts ask whether a deck stands at its stop, to the millimetre.
    x: { kind: 'f32', read: view => view.position.x },
    y: { kind: 'f32', read: view => view.position.y },
    z: { kind: 'f32', read: view => view.position.z },
    pitch: { kind: 'angle', bits: 16, read: view => view.euler.x },
    yaw: { kind: 'angle', bits: 16, read: view => view.euler.y },
    roll: { kind: 'angle', bits: 16, read: view => view.euler.z },
    enabled: { kind: 'bool', read: view => view.enabled },
  },
});
/** The `state` class: one public shared field. A declared field's value is exact, and its row is its name's entity. */
export const STATE_NET: NetSchema<StateNetRow> = netSchema<StateNetRow>({
  cls: 'state',
  fields: { value: { kind: 'f32', read: row => row.value } },
});
/** The `flag` class: a flag's entity exists while it is set, so spawn and despawn say all of it and a frame carries nothing. */
export const FLAG_NET: NetSchema<string> = netSchema<string>({ cls: 'flag', fields: {} });
/** A flag's entity id, and the flag an id names. */
export const FLAG_PREFIX = 'flag:';
/** A public shared field's entity id. */
export const STATE_PREFIX = 'state:';
