import type { ScriptEntity } from '@wildshard/engine/script/effects';
import type * as v from 'valibot';
import type { MoversSchema } from '@wildshard/format/movers';

/** Frozen legacy mover adapters retain their type path; format owns the declaration. */
type MoverData = v.InferOutput<typeof MoversSchema>;
/** Six entity-local fields: YXZ Euler pose, collision enabled, raised and raising. They never expose a player record. */
export const MOVER_FIELDS: Readonly<{ pitch: 1; yaw: 2; roll: 3; enabled: 4; raised: 5; raising: 6; }> = Object.freeze({ pitch: 1, yaw: 2, roll: 3, enabled: 4, raised: 5, raising: 6 });
/** Lower-only entity field ranges supplied to the session's one script effect world. */
export const MOVER_FIELD_RANGES: Readonly<Record<number, readonly [number, number]>> = Object.freeze({ 1: [-Math.PI, Math.PI], 2: [-Math.PI, Math.PI], 3: [-Math.PI, Math.PI], 4: [0, 1], 5: [0, 1], 6: [0, 1] });
/** Merge these handles into the host's entity catalogue before its one script lane is constructed. */
export function moverScriptEntities(data: MoverData): ScriptEntity[] {
  return data.map((m) => ({ id: m.entity, name: m.id, position: [m.at.x, m.at.y, m.at.z], fields: { 1: m.euler.x, 2: m.euler.y, 3: m.euler.z, 4: Number(m.enabled), 5: 0, 6: 0 }, frozen: false, interactive: true }));
}
