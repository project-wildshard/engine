import * as v from 'valibot';
import type { ScriptLanePort } from '@wildshard/engine/script/lane';
import { LogicalStateSchema, type LogicalState } from '@wildshard/format/migrations';

const finite = v.pipe(v.number(), v.finite());
const fieldSchema = v.object({ id: v.number(), name: v.string(), type: v.picklist(['bool', 'i32', 'f64']) });
const declaration = v.object({ state: v.object({ shared: v.array(fieldSchema), player: v.array(fieldSchema) }) });
const laneState = v.object({ contract: v.string(), world: v.object({ shared: v.array(finite), players: v.array(v.object({ actorId: v.string(), values: v.array(finite) })) }) });
const composedState = v.object({ contract: v.string(), roles: v.pipe(v.array(v.object({ id: v.string(), state: v.string() })), v.maxLength(128)) });
const roleContract = v.object({ roles: v.pipe(v.array(v.object({ id: v.string(), events: v.picklist(['deliver', 'consume']) })), v.maxLength(128)) });
function numericLaneState(input: unknown): v.InferOutput<typeof laneState> {
  if (input === null || typeof input !== 'object' || !('roles' in input)) return v.parse(laneState, input);
  const saved = v.parse(composedState, input), contract = v.parse(roleContract, JSON.parse(saved.contract));
  if (new Set(saved.roles.map(role => role.id)).size !== saved.roles.length || new Set(contract.roles.map(role => role.id)).size !== contract.roles.length
    || saved.roles.length !== contract.roles.length || saved.roles.some(role => !contract.roles.some(entry => entry.id === role.id))) throw new Error('Invalid logical script roles');
  const numeric = saved.roles.find(role => role.id === 'numeric');
  if (numeric === undefined || contract.roles.find(role => role.id === 'numeric')?.events !== 'deliver') throw new Error('Missing logical numeric role');
  return v.parse(laneState, JSON.parse(numeric.state));
}
/** Extract only stable declared fields from a historical lane; WASM memory, pending effects, entity positions and budgets never migrate. */
export function logicalStateFromLane(version: number, text: string | null): LogicalState {
  if (text === null) return v.parse(LogicalStateSchema, { version, shared: [], players: [] });
  const input: unknown = JSON.parse(text), saved = numericLaneState(input);
  const contract: unknown = JSON.parse(saved.contract), fields = v.parse(declaration, contract).state;
  return v.parse(LogicalStateSchema, { version, shared: logicalValues(fields.shared, saved.world.shared),
    players: saved.world.players.map((player) => ({ actorId: player.actorId, fields: logicalValues(fields.player, player.values) })) });
}
function logicalValues(list: readonly { id: number; name: string; type: 'bool' | 'i32' | 'f64' }[], data: readonly number[]): LogicalState['shared'] {
  if (list.length !== data.length) throw new Error('Logical field count mismatch');
  return list.map((entry, index) => {
    const value = data[index]; if (value === undefined || (entry.type === 'bool' && value !== 0 && value !== 1)) throw new Error('Invalid logical field value');
    return { id: entry.id, name: entry.name, type: entry.type, value: entry.type === 'bool' ? value === 1 : value };
  });
}
/** logicalStateFromLane of a live lane's own snapshot, read from its numeric world (the declaration its contract carries
 * and the values its snapshot writes) instead of parsing the whole snapshot text, guest memory included. */
export function logicalStateFromWorld(version: number, world: Pick<ScriptLanePort['world'], 'declaration' | 'checkpoint'>): LogicalState {
  const state = world.checkpoint();
  return v.parse(LogicalStateSchema, { version, shared: logicalValues(world.declaration.shared, state.shared),
    players: state.players.map((player) => ({ actorId: player.actorId, fields: logicalValues(world.declaration.player, player.values) })) });
}
/** Overlay migrated fields onto a freshly installed lane; new actors and all executable state remain freshly initialized. */
export function restoreLogicalLane(lane: Pick<ScriptLanePort, 'world'> | undefined, state: LogicalState): void {
  if (lane === undefined) {
    if (state.shared.length > 0 || state.players.some((player) => player.fields.length > 0)) throw new Error('Missing logical state lane');
    return;
  }
  const before = lane.world.checkpoint();
  const values = (fields: typeof lane.world.declaration.shared, saved: LogicalState['shared']): number[] => fields.map((field) => {
    const prior = saved.find((entry) => entry.id === field.id); if (prior === undefined) return field.default;
    const value = typeof prior.value === 'boolean' ? Number(prior.value) : prior.value;
    if (typeof value !== 'number') throw new Error('Non-numeric script state'); return value;
  });
  lane.world.restoreState({ ...before, shared: values(lane.world.declaration.shared, state.shared),
    players: before.players.map((player) => ({ actorId: player.actorId,
      values: values(lane.world.declaration.player, state.players.find((entry) => entry.actorId === player.actorId)?.fields ?? []) })) });
}
