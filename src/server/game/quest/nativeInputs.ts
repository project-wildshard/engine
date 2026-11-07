import type { SimHost } from '@wildshard/engine/sim';

/** Platform command adapter installed by the native worker, never by shard
 * composition. Scripts and ledger methods retain their existing tape owner. */
export interface NativeQuestInputs {
  readonly scripts: () => readonly { readonly actorId: string; readonly value: number; readonly playerId?: string | undefined }[];
  readonly walk: (speed: number) => { readonly x: number; readonly z: number };
  readonly ledger: { readonly fact: (name: string, entity: string) => void; readonly coins: (amount: number, entity: string) => void };
}
const inputs = new WeakMap<SimHost, NativeQuestInputs>();
/** Trusted worker bootstrap: publish the actual command adapter once. */
export function registerNativeQuestInputs(host: SimHost, input: NativeQuestInputs): void {
  if (inputs.has(host)) throw new Error('Duplicate native quest input');
  inputs.set(host, input); host.scope.onDispose(() => { inputs.delete(host); });
}
export function nativeQuestInputs(host: SimHost): NativeQuestInputs {
  const input = inputs.get(host); if (input === undefined) throw new Error('Missing native quest input'); return input;
}
const channels = new WeakMap<SimHost, Map<string, Record<string, number | boolean>>>();
/** Mutable declared numeric/boolean channels, shared by native stage and quest
 * owners. No owner method, callback or reflection path is accepted. */
export function installNativeQuestChannels(host: SimHost, id: string, initial: Readonly<Record<string, number | boolean>>): Record<string, number | boolean> {
  const book = channels.get(host) ?? new Map<string, Record<string, number | boolean>>();
  if (book.has(id) || Object.values(initial).some(value => typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid native quest channel');
  const state = { ...initial }; book.set(id, state); channels.set(host, book); host.scope.onDispose(() => { book.delete(id); }); return state;
}
export function nativeQuestChannels(host: SimHost, id: string): Readonly<Record<string, number | boolean>> {
  const state = channels.get(host)?.get(id); if (state === undefined) throw new Error('Missing native quest channels'); return state;
}
