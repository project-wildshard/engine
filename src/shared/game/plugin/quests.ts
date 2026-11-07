/** Transitional quest bridge: retire when quest behavior is expressed by authored rows. */
import { MathUtils, Vector3 } from "three";
import * as v from "valibot";
import * as npcs from '@wildshard/format/npcs';
import * as graphContracts from '@wildshard/format/questGraph';

import type { NpcDef } from "@wildshard/engine/quest/core";
import type { SimHost } from "@wildshard/engine/sim";
import { DeclaredQuests } from "../quest/declared";
import { questBooks } from '@wildshard/engine/quest/players';
import { playerInteractionRules, bindHeadlessPrompts, createHeadlessPromptPicker, type HeadlessPrompt, type PromptRegistration, eyeReaches, installInteractionRows, InteractionRules, parseInteractionRows, type InteractionRowsData, type InteractionSpot } from "../quest/interactionRows";
import { autoFlag, type InteractTable } from "@wildshard/engine/world/interact/types";
import { bindInteractionState, type Flags } from "@wildshard/engine/world/interact/flags";
import type { QuestData } from "@wildshard/format/quests";
import { NativeQuestProps } from '../quest/nativeProps';
import { questPhaseSpan, questPhaseAt } from '../quest/storyLaw';

/** Bind physical quest prop declarations to the existing native world. */
export function installNativeQuestProps(host: SimHost, input: unknown, restoring: boolean): NativeQuestProps {
  return new NativeQuestProps(host, input, restoring);
}

/** Mutable pose lent by a reward's player owner; this law creates no player, motor, camera or view. */
export interface QuestRewardPosePlayer { position: Vector3; velocity: Vector3; yaw: number; pitch: number }
/** The pose and clock phase captured once when the reward starts. Its owner persists these values with elapsed time. */
export interface QuestRewardOrigin { position: Vector3; yaw: number; pitch: number; phase: number }
/** An authored destination; absent components retain the captured pose or the running clock. */
export interface QuestRewardPoseTarget { at?: Vector3; yaw?: number; pitch?: number; phase?: number }

/** The shipping reward pose: 2.5 s camera ease, shortest yaw and 3.5 s forward clock ease, without presentation. */
export function applyQuestRewardPose(elapsed: number, from: Readonly<QuestRewardOrigin>, target: Readonly<QuestRewardPoseTarget>,
  player: QuestRewardPosePlayer, dayNight: { phase: number } | null | undefined): void {
  const k = MathUtils.smoothstep(elapsed, 0, 2.5);
  if (target.at !== undefined) player.position.lerpVectors(from.position, target.at, k);
  player.velocity.set(0, 0, 0);
  const turn = (target.yaw ?? from.yaw) - from.yaw;
  player.yaw = from.yaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * k;
  player.pitch = from.pitch + ((target.pitch ?? from.pitch) - from.pitch) * k;
  if (dayNight && target.phase !== undefined) {
    dayNight.phase = questPhaseAt(from.phase, questPhaseSpan(from.phase, target.phase), Math.max(0, elapsed), 3.5);
  }
}

/** A reward borrows the existing player's carry fence; it never installs a player or clock. */
export interface QuestRewardCarryPlayer extends QuestRewardPosePlayer { carried: boolean }
/** Existing start and completion owners; a completion card may retain carry by returning true. */
export interface QuestRewardControllerSpec extends QuestRewardPoseTarget {
  readonly when: () => boolean;
  readonly finish: () => boolean | undefined;
  readonly holdSeconds?: number;
}
/** Page-only effects run at the original capture, pre-finish and release boundaries. */
export interface QuestRewardEffects {
  readonly start?: () => void;
  readonly finish?: () => void;
  readonly release?: () => void;
}
const rewardFinite = v.pipe(v.number(), v.finite());
const RewardSaved: v.GenericSchema<BoundedQuestRewardSavedInput, BoundedQuestRewardSaved> = v.strictObject({
  elapsed: v.union([v.literal(-2), v.literal(-1), v.pipe(rewardFinite, v.minValue(0))]),
  carried: v.boolean(), player: v.strictObject({ pitch: rewardFinite, carried: v.boolean() }),
  from: v.strictObject({ x: rewardFinite, y: rewardFinite, z: rewardFinite, yaw: rewardFinite, pitch: rewardFinite, phase: rewardFinite }),
});
/** One renderer-free reward continuation for native and page quests. Restore validates before mutation and never
 * advances time or invokes effects; the existing host retains position, velocity, yaw, clock and save ownership.
 */
export class QuestRewardController {
  private readonly from: QuestRewardOrigin = { position: new Vector3(), yaw: 0, pitch: 0, phase: 0 };
  private elapsed = -1;
  private carried = false;
  private disposed = false;
  private readonly player: QuestRewardCarryPlayer;
  private readonly day: { phase: number } | null | undefined;
  private readonly spec: QuestRewardControllerSpec;
  private readonly effects: QuestRewardEffects;
  constructor(player: QuestRewardCarryPlayer, day: { phase: number } | null | undefined,
    spec: QuestRewardControllerSpec, effects: QuestRewardEffects = {}) {
    this.player = player; this.day = day; this.spec = spec; this.effects = effects;
  }
  get active(): boolean { return this.elapsed >= 0; }
  /** The admitted director may own completion; otherwise the authored hold duration finishes the beat. */
  update(dt: number, authoritativeFinish?: boolean): void {
    if (this.disposed) return;
    if (this.elapsed === -1 && this.spec.when()) {
      this.elapsed = 0; this.carried = this.player.carried; this.player.carried = true;
      this.from.position.copy(this.player.position); this.from.yaw = this.player.yaw; this.from.pitch = this.player.pitch;
      this.from.phase = this.day?.phase ?? 0;
      this.effects.start?.();
    }
    if (!this.active) return;
    this.elapsed += dt;
    applyQuestRewardPose(this.elapsed, this.from, this.spec, this.player, this.day);
    if (authoritativeFinish ?? this.elapsed > (this.spec.holdSeconds ?? 7)) {
      this.elapsed = -2; this.effects.finish?.();
      if (this.spec.finish() !== true) this.release();
    }
  }
  private release(): void { this.player.carried = this.carried; this.effects.release?.(); }
  /** Copy the existing native envelope without sharing mutable origin data. */
  snapshot(): v.InferOutput<typeof RewardSaved> {
    const { position, yaw, pitch, phase } = this.from;
    return { elapsed: this.elapsed, carried: this.carried, player: { pitch: this.player.pitch, carried: this.player.carried },
      from: { x: position.x, y: position.y, z: position.z, yaw, pitch, phase } };
  }
  /** Restore the reward-owned pitch and carry only after the entire saved envelope passes admission. */
  restore(value: unknown): void {
    if (this.disposed) throw new Error('Quest reward is disposed');
    const saved = v.parse(RewardSaved, value);
    if (saved.elapsed >= 0 && !saved.player.carried) throw new Error('Active quest reward must own the player');
    this.elapsed = saved.elapsed; this.carried = saved.carried;
    this.from.position.set(saved.from.x, saved.from.y, saved.from.z);
    this.from.yaw = saved.from.yaw; this.from.pitch = saved.from.pitch; this.from.phase = saved.from.phase;
    this.player.pitch = saved.player.pitch; this.player.carried = saved.player.carried;
  }
  /** Only an active beat releases carry on teardown; a finished card keeps its own ownership. */
  dispose(): void {
    if (this.disposed) return;
    if (this.active) this.release();
    this.disposed = true;
  }
}

/** The defining format dialogue schema, shared by the page and native owners by identity. */
export const NpcDialogueRowSchema: typeof npcs.NpcDialogueRowSchema = npcs.NpcDialogueRowSchema;
/** Ordered authored dialogue independent of the runtime figure. */
export type NpcDialogueRow = npcs.NpcDialogueRow;
/** The defining format motion schema; runtime easing and pose laws stay unchanged. */
export const NpcMotionSchema: typeof npcs.NpcMotionSchema = npcs.NpcMotionSchema;
/** A validated pivot NPC motion row. */
export type NpcMotion = npcs.NpcMotion;
/** The defining format NPC schema, preserving identity for every existing runtime consumer. */
export const NpcRowSchema: typeof npcs.NpcRowSchema = npcs.NpcRowSchema;
/** A validated quest-giver NPC row. */
export type NpcRow = npcs.NpcRow;

/** The engine's NpcDef for the row's talk: its dialogue entries in order (the first whose condition holds is said). */
export function npcDef(row: NpcRow): NpcDef {
  return { id: row.id, name: row.name, dialogue: row.dialogue.map(entry => ({
    ...(entry.when === undefined ? {} : { when: { ...entry.when } }), lines: [...entry.lines], ...(entry.sets === undefined ? {} : { sets: [...entry.sets] }) })) };
}
/** The row's talk spot over the ground: its head's height and its prompt's reach (the interaction rows' spot). */
export function npcSpot(row: NpcRow, groundAt: (x: number, z: number) => number): { x: number; y: number; z: number; radius: number } {
  return { x: row.at.x, y: groundAt(row.at.x, row.at.z) + row.talkHeight, z: row.at.z, radius: row.talkRadius };
}

/** The defining pure quest graph contract, shared by author and native consumers. */
export const QuestGraphSchema: typeof graphContracts.QuestGraphSchema = graphContracts.QuestGraphSchema;
/** A validated quest graph runtime row. */
export type QuestGraphRow = graphContracts.QuestGraphRow;
/** Admit the identical quest graph without installing a native owner. */
export function parseQuestGraph(input: unknown): QuestGraphRow { return graphContracts.parseQuestGraph(input); }

/** One baked spot: where the built world placed a prompt or a crack target (a crack target answers as `crack.<id>`). */
export interface QuestGraphSpot extends InteractionSpot { readonly id: string }
/** The rows a quest graph runs: the admitted quests, the interaction rows, the quest-givers and the runtime row. */
export interface QuestGraphRows {
  readonly quests: QuestData;
  readonly interactions: InteractionRowsData;
  readonly npcs: readonly NpcRow[];
  readonly graph: QuestGraphRow;
}
/** What a quest graph is lent: the baked spots, the cracking item, the tick's commands and the platform's effect ports. */
export interface QuestGraphPorts {
  readonly spots: { readonly interact: readonly QuestGraphSpot[]; readonly crack: readonly QuestGraphSpot[] };
  /** the item that cracks: its light / heavy reach and the act its lash reached this tick */
  readonly crack?: { readonly reach: { readonly light: number; readonly heavy: number }; readonly cracked: (player: string) => number | null };
  readonly commands: () => readonly { readonly actorId: string; readonly value: number; readonly playerId?: string | undefined }[];
  /** Optional actual page roster; commands can answer only its selected visible nearest prompt. */
  readonly promptRegistrations?: readonly PromptRegistration[];
  /** Already-bound live rows, including unhosted competitors; external routes use their actual sight and order. */
  readonly prompts?: readonly HeadlessPrompt[];
  /** A player's own rows, when what it may reach depends on its book. */
  readonly rosterOf?: (player: string) => readonly HeadlessPrompt[];
  /** An existing modal/ride owner delivers actions itself. With no marks, no extra step or snapshot is installed. */
  readonly drive?: 'commands' | 'external';
  readonly fact: (name: string, entity: string) => void;
  readonly coins: (amount: number, entity: string) => void;
  /** a `summon` action ran: arm the named boss encounter */
  readonly summon?: (boss: string) => void;
}

/**
 * Runs a shard's declared quest graph in the renderer-free host (SF27): the quest rows through the game's declared quest
 * path (`DeclaredQuests` on `host.flags`, its facts and coins through the effect ports) and the interaction rows through
 * the platform's interaction step, at the baked spots and each quest-giver's talk spot over the ground; a row's run starts
 * its declared actions. A `summon` action with no summon port refuses at install.
 */
export function installQuestGraph(host: SimHost, rows: QuestGraphRows, ports: QuestGraphPorts): { quests: DeclaredQuests; rules: InteractionRules; run: (id: string, changed?: () => void, player?: string) => ReturnType<InteractionRules['run']>;
  /** Whether a player's eye stands within the named spot's prompt radius (an externally driven graph's prompts). */
  near: (spot: string, player?: string) => boolean } {
  const actions = new Map(rows.graph.actions.map(action => [action.row, action] as const)), summon = ports.summon;
  if (actions.size > 0 && summon === undefined) throw new Error('A quest graph summons a boss but has no summon port');
  if (ports.drive === 'external' && rows.interactions.marks.length > 0) throw new Error('Externally driven quest marks need an explicit continuation owner');
  if (ports.prompts !== undefined && ports.prompts.length > 1024) throw new Error('Quest prompt roster exceeds its finite bound');
  const quests = new DeclaredQuests(host, rows.quests, { fact: ports.fact, coins: ports.coins });
  const rules = new InteractionRules(host.flags, rows.interactions), books = questBooks(host), rulesOf = playerInteractionRules(host, rules);
  const groundAt = (x: number, z: number): number => host.groundHeightAt(x, z);
  const spots = Object.fromEntries([...rows.npcs.map(npc => [npc.spot, npcSpot(npc, groundAt)] as const),
    ...ports.spots.interact.map(s => [s.id, s] as const), ...ports.spots.crack.map(s => [`crack.${s.id}`, s] as const)]);
  const done = (row: string): void => { const action = actions.get(row); if (action !== undefined) summon?.(action.summon); };
  const picker = createHeadlessPromptPicker(host), prompts = ports.prompts ?? (ports.promptRegistrations === undefined ? undefined : bindHeadlessPrompts(ports.promptRegistrations, id => {
    const entry = rows.interactions.rows.find(row => row.at === id && row.crack === undefined), spot = spots[id];
    if (entry === undefined || spot === undefined) return undefined;
    const prompt: HeadlessPrompt = { act: entry.act, position: spot, radius: spot.radius };
    return prompt;
  }));
  if (ports.drive !== 'external') installInteractionRows(host, rules, { actorId: rows.graph.actor, stepId: rows.graph.step, spots, commands: ports.commands,
    ...(prompts === undefined ? {} : { prompts }),
    ...(ports.rosterOf === undefined ? {} : { rosterOf: ports.rosterOf }),
    ...(ports.crack === undefined ? {} : { crack: ports.crack }),
    done });
  return { quests, rules, run: (id, changed, player = books.lead.player) => { const result = rulesOf(player).run(id, changed); if (result.ok) done(id); return result; },
    near: (id, player = books.lead.player) => {
      const feet = host.players.get(player)?.position;
      if (feet === undefined) return false;
      const roster = ports.rosterOf?.(player) ?? ports.prompts;
      if (roster !== undefined) {
        const prompt = roster.reduce<HeadlessPrompt | undefined>((last, row) => row.id === id ? row : last, undefined);
        if (prompt === undefined) throw new Error(`Undeclared quest prompt ${id}`);
        return prompt.act !== null && picker.pick(roster, feet)?.act === prompt.act && eyeReaches(feet, { ...prompt.position, radius: prompt.radius });
      }
      const spot = spots[id]; if (spot === undefined) throw new Error(`Undeclared quest spot ${id}`); return eyeReaches(feet, spot);
    } };
}

/** Compile the flag effects of latched levers, pickups and benches from the engine's authored table. Geometry, inventory,
 * sitting, prompt ordering and LOS remain with their existing owners; unsupported kinds refuse instead of losing effects. */
export function compileQuestTable(table: InteractTable, bindings: readonly { readonly id: string; readonly act: number }[]): InteractionRowsData {
  return parseInteractionRows({ marks: [], rows: bindings.map(binding => {
    const matches = table.rows.filter(row => row.id === binding.id), row = matches[0];
    if (matches.length !== 1 || row === undefined || !(row.kind === 'pickup' || row.kind === 'bench' || row.kind === 'lever' && row.latch === true)) {
      throw new Error(`Unsupported quest table action ${binding.id}`);
    }
    const flag = autoFlag(row);
    if (flag === null) throw new Error(`Missing quest table flag ${binding.id}`);
    const needs = [...(row.showWhen === undefined ? [] : [row.showWhen]), ...(row.requires === undefined ? [] : [row.requires]),
      ...(row.kind === 'bench' ? [] : [{ none: [flag] }])];
    return { id: row.id, act: binding.act, at: row.id, needs, sets: [flag, ...(row.kind === 'lever' ? [] : row.sets ?? [])] };
  }) });
}

/** Preflight table/spot identity before borrowing the native interaction states.
 * Each value retains its actual captured spot. Iteration follows the table's
 * order; ordered profiles also refuse a differently ordered capture. This
 * adapter commits no flags and owns no command, reach, grant or continuation.
 */
export function bindQuestTableSpots<Spot extends { readonly id: string; readonly kind: string }>(table: InteractTable,
  spots: readonly Spot[], flags: Pick<Flags, 'has'>, bounds: { readonly rows?: number; readonly items?: number; readonly ordered?: boolean } = {}):
  ReadonlyMap<string, ReturnType<typeof bindInteractionState> & { readonly spot: Spot }> {
  const limit = bounds.rows ?? 4096, items = bounds.items ?? 4096;
  if (![limit, items].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 4096)) throw new RangeError('Invalid quest table bounds');
  if (table.rows.length > limit || spots.length !== table.rows.length) throw new Error('Quest spots do not match the table');
  const index = new Map<string, Spot>();
  for (const spot of spots) {
    if (spot.id.length === 0 || spot.id.length > 256 || index.has(spot.id)) throw new Error('Invalid or duplicate quest spot');
    index.set(spot.id, spot);
  }
  const ids = new Set<string>();
  const matched = table.rows.map((d, i) => {
    const spot = index.get(d.id);
    if (ids.has(d.id) || spot === undefined || spot.kind !== d.kind || (bounds.ordered === true && spots[i]?.id !== d.id)) throw new Error(`Quest spot does not match row ${d.id}`);
    if (d.kind === 'chest' && d.contents.length > items) throw new RangeError('Quest chest exceeds its item bound');
    ids.add(d.id); return { d, spot };
  });
  return new Map(matched.map(({ d, spot }) => [d.id, Object.assign(bindInteractionState(d, flags), { spot })]));
}


const deathName = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9.:-]{0,127}$/u));
const deathValue = v.pipe(v.string(), v.minLength(1), v.maxLength(256));
const DeathMatch = v.pipe(v.strictObject({ kind: v.exactOptional(deathValue), variant: v.exactOptional(deathValue), label: v.exactOptional(deathValue) }),
  v.check(row => row.kind !== undefined || row.variant !== undefined || row.label !== undefined));
const DeathRows = v.pipe(v.array(v.strictObject({
  when: v.exactOptional(v.pipe(v.array(DeathMatch), v.minLength(1), v.maxLength(16))),
  effects: v.pipe(v.array(v.variant('kind', [
    v.strictObject({ kind: v.literal('flag'), flag: deathName }),
    v.strictObject({ kind: v.literal('kill') }),
    v.strictObject({ kind: v.literal('event'), event: deathName }),
    v.strictObject({ kind: v.literal('call'), name: deathName }),
    v.strictObject({ kind: v.literal('toast'), text: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)) }),
  ])), v.minLength(1), v.maxLength(32)),
})), v.maxLength(128));

/** The actual dead creature lent by the caller, without a copied body or save owner. */
export interface QuestDeathSubject { readonly kind: string; readonly variant?: string; readonly label?: string }
/** Existing flag, achievement and consequence owners; subscriptions and listener priority remain caller-owned. */
export interface QuestDeathPorts<Subject extends QuestDeathSubject> {
  readonly flags?: { readonly set: (flag: string) => void };
  readonly kill?: (kind: string, variant?: string) => void;
  readonly event?: (event: string) => void;
  readonly calls?: ReadonlyMap<string, (subject: Subject) => void>;
  readonly toast?: (text: string) => void;
}
/** Preflight bounded death consequences before any effect. All matching rows run in order; each row runs once even if
 * several of its alternative conditions match. Owners keep their counters, key placement, contracts and continuation.
 */
export function bindQuestDeathEffects<Subject extends QuestDeathSubject>(input: unknown, ports: QuestDeathPorts<Subject>): (subject: Subject) => void {
  const rows = v.parse(DeathRows, input);
  if ((ports.calls?.size ?? 0) > 128) throw new RangeError('Unbounded quest death callbacks');
  const compiled = rows.map(row => ({ when: row.when, effects: row.effects.map(effect => {
    if (effect.kind === 'call') {
      const call = ports.calls?.get(effect.name);
      if (call === undefined) throw new Error(`Unbound quest death callback ${effect.name}`);
      return call;
    }
    if (effect.kind === 'flag') {
      const flags = ports.flags; if (flags === undefined) throw new Error('Quest death flag needs its owner');
      return (_subject: Subject): void => { flags.set(effect.flag); };
    }
    if (effect.kind === 'kill') {
      const kill = ports.kill; if (kill === undefined) throw new Error('Quest death kill needs its achievement owner');
      return (subject: Subject): void => { kill(subject.kind, subject.variant); };
    }
    if (effect.kind === 'event') {
      const event = ports.event; if (event === undefined) throw new Error('Quest death event needs its achievement owner');
      return (_subject: Subject): void => { event(effect.event); };
    }
    const toast = ports.toast; if (toast === undefined) throw new Error('Quest death toast needs its view owner');
    return (_subject: Subject): void => { toast(effect.text); };
  }) }));
  return subject => {
    for (const row of compiled) {
      if (row.when !== undefined && !row.when.some(match => (match.kind === undefined || match.kind === subject.kind)
        && (match.variant === undefined || match.variant === subject.variant) && (match.label === undefined || match.label === subject.label))) continue;
      for (const effect of row.effects) effect(subject);
    }
  };
}

/** A borrowed reading owns its own text, clock and completion flags. Page ports may omit native continuation. */
export interface QuestReading<Saved> {
  readonly active: boolean;
  use: () => void;
  dismiss: () => void;
  step: (dt: number, feet: Readonly<{ x: number; y: number; z: number }>) => void;
  snapshot?: () => Saved;
  prepareRestore?: (value: unknown) => () => void;
}
/** Captured speaker heads and prompt positions need not coincide. */
export interface QuestReadingSpot {
  readonly kind: string;
  readonly at: Readonly<{ x: number; y: number; z: number }>;
  readonly prompt: Readonly<{ x: number; y: number; z: number; radius: number }>;
}
/** Ordered speaker definitions and an optional existing native save envelope. */
export interface QuestReadingRows<Source> {
  readonly speakers: Readonly<Record<string, Source>>;
  readonly continuation?: { readonly bare: string; readonly wrapped: readonly string[] };
}
/** A roster routes one modal and lends continuation to the existing save owner. */
export interface QuestReadingRoster<Saved> {
  readonly active: boolean;
  press: (id: string) => void;
  dismiss: () => void;
  advanceReading: (dt: number, feet: QuestReadingSpot['at']) => void;
  snapshot: () => Saved | { kind: string; reading: Saved } | null;
  prepareRestore: (value: unknown) => () => void;
}
/** One active speaker routes USE even when another prompt was selected. Completion belongs only to USE;
 * range cancellation and silent, preflighted restore never run completion effects. No clock or UI is installed.
 */
export function createReadingRoster<Source, Saved>(rows: QuestReadingRows<Source>, spots: readonly QuestReadingSpot[],
  create: (source: Source, at: QuestReadingSpot['at'], radius: number) => QuestReading<Saved>, completed: (id: string) => void): QuestReadingRoster<Saved> {
  const sources = Object.entries(rows.speakers), readings = new Map<string, QuestReading<Saved>>();
  if (sources.length === 0 || sources.length > 256 || spots.length !== sources.length) throw new RangeError('Reading roster needs one spot per speaker');
  const captured = sources.map(([id, source]) => {
    const matches = spots.filter(spot => spot.kind === id), spot = matches[0];
    if (matches.length !== 1 || spot === undefined || spot.prompt.radius <= 0
      || ![spot.at.x, spot.at.y, spot.at.z, spot.prompt.x, spot.prompt.y, spot.prompt.z, spot.prompt.radius].every(Number.isFinite)) throw new RangeError(`Missing captured speaker ${id}`);
    return { id, source, spot };
  });
  const continuation = rows.continuation;
  if (continuation !== undefined && (!sources.some(([id]) => id === continuation.bare)
    || continuation.wrapped.length !== sources.length - 1 || new Set(continuation.wrapped).size !== continuation.wrapped.length
    || continuation.wrapped.some(id => id === continuation.bare || !sources.some(([key]) => key === id)))) throw new RangeError('Invalid reading continuation speakers');
  const Wrapped = continuation === undefined ? null : v.strictObject({ kind: v.picklist(continuation.wrapped), reading: v.unknown() });
  for (const { id, source, spot } of captured) readings.set(id, create(source, spot.at, spot.prompt.radius));
  const required = (id: string): QuestReading<Saved> => {
    const reading = readings.get(id);
    if (reading === undefined) throw new RangeError(`Unknown reading speaker ${id}`);
    return reading;
  };
  let current: string | null = null;
  const active = (): boolean => current !== null && required(current).active;
  const dismiss = (): void => { if (current !== null) required(current).dismiss(); current = null; };
  return {
    get active(): boolean { return active(); },
    press(id: string): void {
      const selected = active() ? current : id;
      if (selected === null) throw new Error('Missing active speaker');
      const reading = required(selected); current = selected; reading.use();
      if (!reading.active) { current = null; completed(selected); }
    },
    dismiss,
    advanceReading(dt: number, feet: QuestReadingSpot['at']): void {
      if (current === null) return;
      const reading = required(current); reading.step(dt, feet);
      if (!reading.active) current = null;
    },
    snapshot(): Saved | { kind: string; reading: Saved } | null {
      if (current === null) return null;
      const port = required(current);
      if (continuation === undefined || port.snapshot === undefined) throw new Error('Reading has no native continuation');
      const reading = port.snapshot();
      return current === continuation.bare ? reading : { kind: current, reading };
    },
    prepareRestore(value: unknown): () => void {
      if (value === null) return dismiss;
      if (continuation === undefined || Wrapped === null) throw new Error('Reading has no native continuation');
      const wrapped = v.safeParse(Wrapped, value), id = wrapped.success ? wrapped.output.kind : continuation.bare;
      const reading = wrapped.success ? wrapped.output.reading : value;
      if (reading === null) throw new RangeError('A saved speaker must still be reading');
      const port = required(id);
      if (port.prepareRestore === undefined) throw new Error('Reading has no native continuation');
      const commit = port.prepareRestore(reading);
      return () => { dismiss(); commit(); current = id; };
    },
  };
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedQuestRewardSavedInput = BoundedQuestRewardSaved;
interface BoundedQuestRewardSavedFields {
    elapsed: number;
    carried: boolean;
    player: {
        pitch: number;
        carried: boolean;
    };
    from: {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pitch: number;
        phase: number;
    };
}
type BoundedQuestRewardSaved = { [Key in keyof BoundedQuestRewardSavedFields]: BoundedQuestRewardSavedFields[Key] };
