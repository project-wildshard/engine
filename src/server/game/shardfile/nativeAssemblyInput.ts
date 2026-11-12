import type { GrappleTickContext } from '../grapple/native';
import type { HeldTick } from '../weapons/nativeHeld';
import type { OpenArenaPresentation } from '../boss/openArenaNative';
import type { bakedSamplers } from '@wildshard/engine/world/BakedTerrain';
import type { readNavmesh } from '@wildshard/engine/physics/navmesh';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import type { SimHost } from '@wildshard/engine/sim';
import type { NativeEliteBindings } from '@wildshard/engine/ai/eliteRoster';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';
import type { Wind } from '@wildshard/engine/world/steppeWind';
import type { BakedGrid } from '@wildshard/format/bakedTerrainBytes';
import type { NativeAssemblyPlan, NativeAssemblyRead } from '@wildshard/format/nativeAssembly';
import type { NativeCombatFrame } from '../plugin/nativeItems';
import type { NativePopulationField } from '../population/environment';
import type { PastureCues } from '../../../shared/game/riding/pastureCues';
import type { WeatherReactions } from '../weather/reactions';
import type { NativeCollisionBake } from '../population/nativeBake';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

/** What a server host hands one install. The tick protocol belongs to the SDK: `ports` adapts it. */
export interface NativeAssemblyContext { readonly combat?: NativeCombatFrame; readonly restoring: boolean; readonly snapshot?: Readonly<Omit<SimSnapshot, 'physics'>>;
  /** A net room's world: it also runs the fights a page or a tape keeps to itself. */
  readonly room?: boolean;
  /** GC15: a grid cell that opens onto its worker's road (`WORLD_CROSSING=worker`): the edge is the platform's, so the shard's
   *  own page walls in its baked collision don't stand there, as for a cell held near its player. */
  readonly road?: boolean }
/** The SDK's tick-protocol loans. No module URL or shard code crosses this boundary. */
export interface NativeAssemblyPorts<C extends NativeAssemblyContext> {
  readonly rapier: Rapier;
  readonly bindCommands: (context: C, host: SimHost) => { readonly ledger: { readonly fact: (name: string, actorId: string) => void } };
  /** The tick's commands as the taming owner reads them. */
  /** File an item for one player in the tick's ledger effects (J105). */
  readonly grantItem: (context: C) => (player: string, item: string, count: number) => void;
  /** A grapple's view of the tick tape. */
  readonly grappleTick: (context: C) => GrappleTickContext;
  /** The held arms' view of the tick tape. */
  readonly heldTick: (context: C) => HeldTick;
  /** File a fact in the tick's ledger effects. */
  readonly ledger: (context: C) => { readonly fact: (name: string, actorId: string) => void };
  /** What an open arena's owner borrows from the drawing side. */
  readonly arena?: OpenArenaPresentation;
  /** This plan builds a net room's world, whose encounters lend their species to its rosters. */
  readonly room?: boolean;
  readonly tamingCommands: (context: C) => () => readonly ({ kind: 'player'; steer?: { keyX: number } } | { kind: 'script'; actorId: string; value: number } | { kind: 'action' })[];
  /** A trusted wrapper's loans over the same world (proofs that drive a raid, the storm or an elite). The server sets none. */
  readonly pastureCues?: PastureCues;
  readonly observeWeather?: (host: SimHost, weather: { readonly wind: Wind; readonly storm: WeatherReactions }) => void;
  readonly observeBindings?: (host: SimHost, bindings: NativeEliteBindings) => void;
}
export function need<T>(value: T, message: string): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
/** One plan input. A file is parsed unchanged: its build admitted it, and its owning host admits its rows. */
export async function readAssemblyInput<T>(product: ShardProduct, read: NativeAssemblyRead): Promise<T> {
  if ('value' in read) return read.value as T;
  let at: unknown = 'file' in read ? JSON.parse(new TextDecoder('utf-8').decode(await product.file(read.file))) : product.section(read.section as Parameters<ShardProduct['section']>[0]);
  for (const part of read.path ?? []) at = need(typeof at === 'object' && at !== null ? Reflect.get(at, part) : undefined, `Missing native assembly input ${part}`);
  return at as T;
}
/** The terrain the plan's hosts sample: a grid, or only heights when the bake owns the ground. */
export interface AssemblyGround { readonly grid: BakedGrid | null; readonly samplers: ReturnType<typeof bakedSamplers> | null; readonly heightAt: (x: number, z: number) => number }
/** Everything the plan's hosts share: read once, before any host is touched. */
export interface AssemblyPrepared<C extends NativeAssemblyContext> extends AssemblyGround {
  readonly product: ShardProduct; readonly assets: ReadonlyMap<string, Uint8Array>; readonly ports: NativeAssemblyPorts<C>; readonly plan: NativeAssemblyPlan;
  readonly bake: NativeCollisionBake & Readonly<Record<string, unknown>>; readonly nav: ReturnType<typeof readNavmesh>;
  readonly boot: unknown; readonly field: NativePopulationField | null; readonly world: unknown; readonly pond: { readonly file: string; readonly bytes: Uint8Array } | null; readonly wet: { readonly file: string; readonly bytes: Uint8Array } | undefined;
}
