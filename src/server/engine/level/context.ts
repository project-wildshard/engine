import type { EffectDef } from '../../../client/engine/combat/effects/types';
import type { Action, TouchVerbSpec } from '../../../client/engine/input/InputService';
import type { Group, Vector3 } from 'three';
import type { App } from '../../../client/engine/app/app';
import type { Scope } from '../../../shared/engine/app/scope';
import type { SystemSpec } from '../../../client/engine/app/systems';
import type { StepProgress } from '../../../client/engine/boot/plan';
import type { AskInput, AskMap, AskOutput, EventMap } from '../../../client/engine/events/maps';
import type { ListenerOptions } from '../../../shared/engine/events/events';
import type { DiscOpts, DiscSpot, TouchRelabel, HudBand } from '../../../client/engine/ui/hudSlots';
import type { Piece } from '../../../client/engine/world/registry';
import type { TierKnobs } from '../../../shared/engine/level/spec';
import type { EncounterDefinition, SpawnTableRow } from '../../../shared/engine/ai/encounters';
import type { SpeciesRow } from '../ai/species';
import type { SpeciesLook } from '../../../client/engine/entities/species/look';

export interface ContentRow { id: string }
/** Subsystems refine their registration contracts here as their row implementations land. */
export interface ContentRowMap {
  weapon: ContentRow; tool: ContentRow; ammo: ContentRow; species: SpeciesRow; speciesLook: SpeciesLook;
  effect: EffectDef; encounter: EncounterDefinition; spawnTable: SpawnTableRow;
}
export type RowVerb<T> = (row: T | readonly T[]) => void;
export type EngineRows = { [K in keyof ContentRowMap]: RowVerb<ContentRowMap[K]> };
export interface InputContextDef {
  id: string; priority?: number; enabled?: () => boolean;
  actions: readonly Action[] | Readonly<Record<string, (pressed: boolean) => void>>;
  blocks?: 'below' | readonly Action[];
  keys?: Partial<Record<Action, readonly string[]>>;
  /** Inherit keys for this context's actions from an already registered context; explicit keys win. */
  keysFrom?: string;
  touch?: { mode?: string; lockable?: boolean; relabel: Partial<Record<DiscSpot, TouchRelabel>>; verbs?: Partial<Record<'verb.1' | 'verb.2', TouchVerbSpec>> };
}
export interface VerbSlotOpts { label: string; icon: string; press: () => void; release?: () => void }
export interface HudVerbs {
  widget: (band: HudBand, el: HTMLElement, order: number) => void;
  disc: (opts: DiscOpts) => HTMLButtonElement;
  relabel: (spot: DiscSpot, label: string, icon: string, appearance?: TouchRelabel) => () => void;
  verb: (slot: 'verb.1' | 'verb.2', opts: VerbSlotOpts) => void;
  pin: (at: Vector3 | (() => Vector3 | null), el: HTMLElement) => void;
}
export interface DebugRowSpec {
  /** Developer tools are not temporary comparisons; they are inactive outside Developer mode. */
  purpose?: 'developer';
  id: string; group: 'look' | 'cover' | 'sky' | 'audio' | 'combat' | 'creatures' | 'perf' | 'loading' | 'tools';
  label: string; choices: readonly { value: string; text: string }[]; initial: string;
  change: (value: string) => void; reload?: boolean; note: string;
  ask: `E${number}`; reviewBy: string;
}
export interface PlaygroundSpec { id: string; title: string; blurb: string; icon: string; art?: string; load: () => Promise<object> }
export type StringTable = Readonly<Record<string, string>>;
export interface TierKnobSchema { id: string; defaults: TierKnobs }

export interface LevelContext {
  /** the running app: its services (input, saves, species, events, clock, rng) */
  readonly app: App;
  /** the level's scope: everything registered through this context leaves with it */
  readonly scope: Scope;
  /** the level's scene root: what the level adds to the world hangs here */
  readonly root: Group;
  /** the boot step's progress, for a hook that does long work (it moves the loading bar) */
  readonly progress: StepProgress;
  /** run a system each frame or in the fixed step (`phase`: 'update', 'fixed.pre' / 'fixed.step' / 'fixed.post') */
  system: (spec: SystemSpec) => void;
  /** listen to an engine event for the level's life */
  on: <K extends keyof EventMap>(name: K, fn: (payload: EventMap[K]) => void, opts?: ListenerOptions) => void;
  /** answer an engine ask (`player.crouch`, …) for the level's life; the last answer registered wins */
  answer: <K extends keyof AskMap>(name: K, fn: (value: AskInput<K>) => AskOutput<K>, opts?: ListenerOptions) => void;
  /** register content rows the engine reads (species, looks, models, equipment …) for the level's life */
  readonly rows: EngineRows;
  /** Declare an input context. An explicit descendant owns its adapter inverse for entered-only activation. */
  inputContext: (def: InputContextDef, owner?: Scope) => void;
  /** the level's verbs on the one shared HUD (slots, chips, prompts) */
  readonly hud: HudVerbs;
  /** register a static or moving thing with its colliders, surface and Explore model (the one world registry) */
  piece: (piece: Piece) => void;
  /** a Debug row of the level's own, shown only on it (pause ▸ Settings ▸ Debug) */
  debugRow: (row: DebugRowSpec) => void;
  /** a practice room for the level's verbs (Explore ▸ Practice) */
  playground: (spec: PlaygroundSpec) => void;
  /** the level's player-facing strings (`ctx.strings` keys the engine asks for, e.g. death verbs) */
  strings: (table: StringTable) => void;
  /** the level's per-tier tuning knobs (scatter counts, detail levels) */
  readonly tiers: { knobs: (schema: TierKnobSchema) => void };
  /** handles for tests and captures (`window.__wildshard.shard[name]`) */
  readonly debug: { expose: (name: string, value: unknown) => void };
}
export interface LevelHooks {
  world?: (ctx: LevelContext) => Promise<void> | void;
  kit?: (ctx: LevelContext) => Promise<void> | void;
  play?: (ctx: LevelContext) => Promise<void> | void;
}

/** A UI/input service returns the inverse of each mutation, owned by the caller's scope. */
export interface LevelAdapters {
  inputContext?: (def: InputContextDef) => () => void;
  hud?: {
    widget: (band: HudBand, el: HTMLElement, order: number) => () => void;
    disc: (opts: DiscOpts) => { button: HTMLButtonElement; dispose: () => void };
    relabel: (spot: DiscSpot, label: string, icon: string, appearance?: TouchRelabel) => () => void;
    verb: (slot: 'verb.1' | 'verb.2', opts: VerbSlotOpts) => () => void;
    pin: (at: Vector3 | (() => Vector3 | null), el: HTMLElement) => () => void;
  };
  debugRow?: (row: DebugRowSpec) => () => void;
  playground?: (spec: PlaygroundSpec) => () => void;
  /** the resident levels and their texture estimate, for the Debug memory readout (E405: the host fills it) */
  residentMemory?: () => ResidentMemory;
}

/** Levels held in memory, oldest first: at most `cap` stay resident. */
export interface ResidentMemory { cap: number; levels: { id: string; running: boolean; textureMB: number }[] }
