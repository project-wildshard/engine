import type { ScriptNetView, StateNetRow } from '../sim/shardRows';
import { FLAG, SCRIPT, STATE } from '@wildshard/wire/classes';
import { bindClass, type NetSchema } from './schema';

// P1-E3.10 (E5-REPLICATION §3.2): shard state as a client reads it. Authors never declare wire fields: these three
// tables carry any shard. A guest's memory, clocks and host-only fields stay on the server.
/** The `script` class: a shard-script body's pose. No relevance radius: a far lift still has to be where it is. */
export const SCRIPT_NET: NetSchema<ScriptNetView> = bindClass<ScriptNetView, typeof SCRIPT>(SCRIPT, {
  // Exact: a client's prompts ask whether a deck stands at its stop, to the millimetre.
  x: view => view.position.x,
  y: view => view.position.y,
  z: view => view.position.z,
  pitch: view => view.euler.x,
  yaw: view => view.euler.y,
  roll: view => view.euler.z,
  enabled: view => view.enabled,
});
/** The `state` class: one public shared field. A declared field's value is exact, and its row is its name's entity. */
export const STATE_NET: NetSchema<StateNetRow> = bindClass<StateNetRow, typeof STATE>(STATE, { value: row => row.value });
/** The `flag` class: a flag's entity exists while it is set, so spawn and despawn say all of it and a frame carries nothing. */
export const FLAG_NET: NetSchema<string> = bindClass<string, typeof FLAG>(FLAG, {});
/** A flag's entity id, and the flag an id names. */
export const FLAG_PREFIX = 'flag:';
/** A public shared field's entity id. */
export const STATE_PREFIX = 'state:';
