// Test-only adapter for pre-row callers; production constructs NativeEliteRoster directly.
import { isJsonData } from '@wildshard/format/json';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { NativeElitePopulation } from '@wildshard/engine/ai/eliteLifecycle';
import { NativeEliteRoster, nativeEliteBindings, type NativeEliteRosterRows, type NativeEliteRosterLoans, type NativeEliteBond } from '@wildshard/engine/ai/eliteRoster';
import { EliteCore, type EliteCoreScript } from '../../src/shared/game/eliteSystem';

/** Manager-owned elite pins and decision bindings; the manager retains its single body-step installer. */
export type EliteBindings = NativeEliteRosterLoans['bindings'] & { readonly absent: Set<AnimalSim> };
/** Allocate per simulation, never at module import. */
export function eliteBindings(): EliteBindings { return nativeEliteBindings(); }

/** A member's identity, adoption and save key are author data. Pack ordering is checked against the owner's actor IDs. */
export interface EliteEncounterRow extends Pick<NativeEliteRosterRows['rows'][number], 'def' | 'snapshot' | 'continuation'> {
  readonly keeper: 'kernel' | 'herd';
  readonly member: { readonly kind: string; readonly variant: string; readonly source: 'boot' | 'spawn' | 'herd'; readonly yaw: number; readonly memory?: Readonly<Record<string, number>> };
  readonly pack?: { readonly offset: readonly [number, number]; readonly variants: readonly string[]; readonly kind: string; readonly idPrefix: string };
}
/** The manager and group owner retain all allocation, RNG, environment and taming authority. */
export interface EliteEncounterPorts extends Pick<NativeEliteRosterLoans, 'groups'> {
  readonly bindings: EliteBindings;
  readonly program?: unknown;
  /** Original concrete kernel owners; spawn/pack/save authorities stay here. */
  readonly kernels?: NonNullable<NativeEliteRosterLoans['kernel']> & { readonly rows: unknown };
}
/** Both wire layouts retain their existing adapter IDs, versions and field names. Upgrades explicitly name retired fields. */
export interface EliteEncounterSpec extends Readonly<Pick<NativeEliteRosterRows, 'step' | 'version' | 'wire'>> {
  readonly core: EliteCore<EliteCoreScript<AnimalSim>>;
  readonly rows?: readonly EliteEncounterRow[];
  readonly ports?: EliteEncounterPorts;
  readonly projections?: NativeEliteRosterRows['projections'];
}

/** Install ordered named encounters on EliteCore. Shared ownership covers spawn/adoption, script/keeper continuation,
 * pack rebind, root effects and declared permanent detachment. Controllers retain fight decisions and clocks.
 * Restore validates the complete roster, all controller payloads and identity bindings before it commits any state. */
export function installEliteEncounters(host: SimHost, spec: EliteEncounterSpec): {
  readonly core: EliteCore<EliteCoreScript<AnimalSim>>; readonly scripts: readonly EliteCoreScript<AnimalSim>[];
  readonly initialize: () => void; readonly bindPopulation: (population: NativeElitePopulation) => void; readonly bindBond: (owner: NativeEliteBond) => void;
} {
  const core = spec.core;
  if (!(core instanceof EliteCore) || Object.getPrototypeOf(core) !== EliteCore.prototype || core.players !== host.players || core.entries.length > 0) throw new Error('Foreign or populated native elite core');
  const ports = spec.ports, rows = spec.rows ?? [];
  if (ports === undefined) throw new Error('Encounter rows need native body authority');
  if (!isJsonData(rows)) throw new Error('Encounter rows require plain JSON');
  const roster = new NativeEliteRoster({ step: spec.step, version: spec.version, wire: spec.wire, rows,
    roles: rows.map(row => row.keeper === 'kernel' ? 'native' : 'borrowed'), kernels: ports.kernels?.rows ?? [], ...(spec.projections === undefined ? {} : { projections: spec.projections }) },
    { host, core, bindings: ports.bindings, ...(ports.kernels === undefined ? {} : { kernel: ports.kernels }), ...(ports.groups === undefined ? {} : { groups: ports.groups }) });
  for (let index = roster.borrowedIndex; index !== null; index = roster.borrowedIndex) {
    roster.bindProjected(index, ReturnProgram.native(host, ports.program), core);
  }
  roster.install();
  return { core, scripts: roster.scripts, initialize: () => { roster.initialize(); }, bindPopulation: population => { roster.bindPopulation(population); }, bindBond: owner => { roster.bindBond(owner); } };
}
