import { ScriptLane, type ScriptBinding, type ScriptLaneOptions } from '@wildshard/engine/script/lane';
import { DeclaredScriptWorld, type ScriptStateDeclaration, type ScriptStateField } from '@wildshard/engine/script/state';
import type { EffectRules, ScriptEntity } from '@wildshard/engine/script/effects';
import type { ScriptHostOptions } from '@wildshard/engine/script/host';

import { scriptBindingRules, type ShardScriptField } from '@wildshard/format/scripts';

/** Translate only numeric fields; string values never become forged numeric ids. Stable ids determine input order. */
export function numericScriptState(state: { shared: readonly ShardScriptField[]; player: readonly ShardScriptField[] }): ScriptStateDeclaration {
  const fields = (list: readonly ShardScriptField[]): ScriptStateField[] => list.flatMap((f) => {
    if (f.type === 'string') return [];
    const value = f.type === 'bool' && typeof f.default === 'boolean' ? Number(f.default) : f.default;
    if (typeof value !== 'number') throw new Error('Invalid numeric field default');
    const min = f.type === 'bool' ? 0 : f.type === 'i32' ? -2147483648 : -Number.MAX_VALUE;
    const max = f.type === 'bool' ? 1 : f.type === 'i32' ? 2147483647 : Number.MAX_VALUE;
    if ((f.min ?? min) < min || (f.max ?? max) > max) throw new Error('Field bounds may only lower');
    return [{ id: f.id, name: f.name, type: f.type, privacy: f.privacy, default: value, min: f.min ?? min, max: f.max ?? max }];
  });
  return { shared: fields(state.shared), player: fields(state.player) };
}
/** Content slice consumed by the full loader; assets are already hash-verified and schema-validated. */
export interface ShardScriptContent {
  identity: { seed: number }; sim: { scripts: readonly string[]; bindings: readonly ScriptBinding[]; scriptTickDivisor: number };
  state: { shared: readonly ShardScriptField[]; player: readonly ShardScriptField[] };
}
/** Loader-provided identities and query ports: the actor mapping comes from the session, not the shardfile. */
export interface ShardScriptPorts extends Omit<ScriptHostOptions, 'world'> { rules: EffectRules; entities: readonly ScriptEntity[]; actors: ReadonlyMap<number, string>; seatsFor?: string | undefined }
/** Prepare declared state and admitted modules without allocating a host or executing author initialization. */
export function prepareShardfileScriptOptions(content: ShardScriptContent, assets: ReadonlyMap<string, Uint8Array>, ports: ShardScriptPorts): ScriptLaneOptions {
  const errors = scriptBindingRules(content.sim.bindings, content.sim.scripts); if (errors.length > 0) throw new Error(errors.join('; '));
  const modules = content.sim.scripts.map((name) => {
    const bytes = assets.get(name); if (!bytes) throw new Error(`Missing script bytes ${name}`);
    return { name, bytes, seedLo: content.identity.seed | 0, seedHi: Math.floor(content.identity.seed / 4294967296) | 0 };
  });
  const world = new DeclaredScriptWorld(ports.rules, ports.entities, numericScriptState(content.state), ports.actors);
  return { ...ports, world, modules, bindings: content.sim.bindings, divisor: content.sim.scriptTickDivisor };
}
/** Create the local authoritative lane explicitly; its constructor admits every module before execution. */
export function createShardfileScriptLane(content: ShardScriptContent, assets: ReadonlyMap<string, Uint8Array>, ports: ShardScriptPorts): ScriptLane {
  return new ScriptLane(prepareShardfileScriptOptions(content, assets, ports));
}

/** Read only admitted asset handles; verification detaches bytes before any host can install them. */
export type ScriptModuleAssets = ReadonlyMap<string, Uint8Array> | ((hash: string) => Promise<Uint8Array>);
/** Shared content-hash admission for mover and item roles; ABI, memory and fuel checks remain with their existing host. */
export async function verifiedScriptModules(assets: ScriptModuleAssets, refs: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
  const names = [...new Set(refs)];
  if (names.length > 512 || names.some(hash => !/^(?:commons:)?[a-f0-9]{64}$/u.test(hash))) throw new Error('Invalid declared script modules');
  return new Map(await Promise.all(names.map(async hash => {
    const source = typeof assets === 'function' ? await assets(hash) : assets.get(hash);
    if (source === undefined) throw new Error('Script module was not admitted');
    const bytes = Uint8Array.from(source), digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if ([...digest].map(byte => byte.toString(16).padStart(2, '0')).join('') !== hash.replace(/^commons:/u, '')) throw new Error('Script module hash mismatch');
    return [hash, bytes] as const;
  })));
}
