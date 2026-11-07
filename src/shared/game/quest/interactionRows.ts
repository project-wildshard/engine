import * as v from "valibot";
import * as interactionContracts from '@wildshard/format/questInteractions';
import { Vector3 } from 'three';
import type { SimHost } from '@wildshard/engine/sim';
import { test, type Flags } from '@wildshard/engine/world/interact/flags';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { pickPrompt, setPromptSight, type PromptTarget } from '@wildshard/engine/world/interact/prompts';
import { questBooks } from '@wildshard/engine/quest/players';


/** The defining pure interaction contract, shared by author admission and native rules. */
export const InteractionRowsSchema: v.GenericSchema<interactionContracts.InteractionRowsData, interactionContracts.InteractionRowsData> = interactionContracts.InteractionRowsSchema;
/** Validated interaction rows. */
export type InteractionRowsData = interactionContracts.InteractionRowsData;
/** One declared prompt or crack row. */
export type InteractionRow = interactionContracts.InteractionRow;
/** Admit the identical bounded interaction contract before installing native rules. */
export function parseInteractionRows(input: unknown): InteractionRowsData { return interactionContracts.parseInteractionRows(input); }
/** A row's answer: it ran, or the `else` reason of its first unmet need (`'refused'` when the need names none). */
export type InteractionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The rules of declared interaction rows over a shard's durable flags, free of meshes and prompts: the browser's
 * interactables call `run(row)` and present the answer, the renderer-free host's `installInteractionRows` runs the same
 * rows from tick commands. Marks are exact continuation (`snapshot` / `restore`); flags stay the flags' own.
 */
export class InteractionRules {
  /** Create page rules only from the required admitted quest composition. */
  static fromDeclared(source:{readonly questHost?:{readonly interactions:InteractionRowsData}|null},flags:Pick<Flags,'has'|'set'>):InteractionRules {
    if(source.questHost===undefined||source.questHost===null)throw new Error('Missing admitted interaction host');
    return new InteractionRules(flags,source.questHost.interactions);
  }
  readonly data: InteractionRowsData;
  private readonly flags: Pick<Flags, 'has' | 'set'>;
  private readonly marks = new Map<string, boolean>();
  private readonly rows = new Map<string, InteractionRow>();
  private readonly view = { has: (flag: string): boolean => this.has(flag) };
  constructor(flags: Pick<Flags, 'has' | 'set'>, data: InteractionRowsData) {
    this.flags = flags; this.data = data;
    for (const mark of data.marks) this.marks.set(mark.id, mark.initial !== undefined && test(flags, mark.initial));
    for (const entry of data.rows) this.rows.set(entry.id, entry);
  }
  /** A mark's state, else the durable flag's. */
  has(flag: string): boolean { return this.marks.get(flag) ?? this.flags.has(flag); }
  /** Set or clear a declared mark (a load restoring the world from its flags); an undeclared one throws. */
  mark(id: string, on = true): void {
    if (!this.marks.has(id)) throw new Error(`Unknown interaction mark ${id}`);
    this.marks.set(id, on);
  }
  /** The declared row, or throws. */
  row(id: string): InteractionRow {
    const found = this.rows.get(id); if (found === undefined) throw new Error(`Unknown interaction row ${id}`); return found;
  }
  /** Whether the row would run now, without running it. */
  check(id: string): InteractionResult {
    for (const want of this.row(id).needs ?? []) if (!test(this.view, want)) return { ok: false, reason: want.else ?? 'refused' };
    return { ok: true };
  }
  /** Run the row: on its needs, raise its marks, call `changed` (the view's beat), then raise its durable flags in order. */
  run(id: string, changed?: () => void): InteractionResult {
    const answer = this.check(id);
    if (!answer.ok) return answer;
    const sets = this.row(id).sets;
    for (const flag of sets) if (this.marks.has(flag)) this.marks.set(flag, true);
    changed?.();
    for (const flag of sets) if (!this.marks.has(flag)) this.flags.set(flag);
    return answer;
  }
  /** The marks as exact continuation, in declared order. */
  snapshot(): string { return JSON.stringify({ version: 1, marks: Object.fromEntries(this.marks) }); }
  /** Restore the marks; an unknown, missing or non-boolean mark, or a `never` combination, refuses and keeps the current state. */
  restore(input: string): void {
    const raw: unknown = JSON.parse(input), state = v.parse(v.strictObject({ version: v.literal(1), marks: v.record(v.string(), v.boolean()) }), raw);
    const keys = Object.keys(state.marks);
    if (keys.length !== this.marks.size || keys.some(key => !this.marks.has(key))) throw new Error('Incompatible interaction marks');
    const next = { has: (flag: string): boolean => state.marks[flag] ?? this.flags.has(flag) };
    if ((this.data.never ?? []).some(c => test(next, c))) throw new Error('Incompatible interaction marks');
    for (const key of keys) this.marks.set(key, state.marks[key] === true);
  }
}

/** Where a player stands. */
interface Feet { x: number; y: number; z: number }
/** A placed point a row answers at: a prompt reaches `radius` from the player's eye, a crack `radius` plus its reach. */
export interface InteractionSpot { readonly x: number; readonly y: number; readonly z: number; readonly radius: number }
/** What `installInteractionRows` is lent. */
export interface InteractionRowPorts {
  /** the `script` command actor that carries the rows (`{ kind: 'script', actorId, value: row.act }`) */
  readonly actorId: string;
  /** the fixed-step adapter id (the marks' continuation) */
  readonly stepId: string;
  /** every row's spot by its `at` name (the built world's placements, baked) */
  readonly spots: Readonly<Record<string, InteractionSpot>>;
  readonly commands: () => readonly { readonly actorId: string; readonly value: number; readonly playerId?: string | undefined }[];
  /** Actual page registration order, including live reach/position and native sight identity. */
  readonly prompts?: readonly HeadlessPrompt[];
  /** A player's own roster, when what it may reach depends on its book. */
  readonly rosterOf?: (player: string) => readonly HeadlessPrompt[];
  /** the item that cracks: its light / heavy reach, and the act its lash reached this tick (null: none); its step runs before this one */
  readonly crack?: { readonly reach: { readonly light: number; readonly heavy: number }; readonly cracked: (player: string) => number | null };
  /** a row ran (the shard's beat on it: a summons, a cue) */
  readonly done?: (row: string) => void;
}

/** The browser player's eye above the feet (engine Player EYE): prompts pick by eye distance (Interactables.pickInteractable). */
const EYE = 1.68;
const eye = new Vector3(), at = new Vector3();
/** Whether the player's eye stands within the spot's radius plus `reach` (a prompt's pick, a crack's lash). */
export function eyeReaches(feet: Readonly<Feet>, spot: InteractionSpot, reach = 0): boolean {
  eye.set(feet.x, feet.y + EYE, feet.z);
  return at.set(spot.x, spot.y, spot.z).distanceTo(eye) < spot.radius + reach;
}
/** The tick protocol's command allowance (sdk/tickProtocol.ts). */
const MAX_COMMANDS = 1024;

const playerRules = new WeakMap<InteractionRules, (player: string) => InteractionRules>();
/** Each player's rules over the same rows: a player's marks and flags are its own, and the book saves their marks. */
export function playerInteractionRules(host: Pick<SimHost, 'flags' | 'quests' | 'players' | 'level' | 'questStore'>, rules: InteractionRules): (player: string) => InteractionRules {
  // a graph and its interaction step share one set of rules, so a player has one set too
  const known = playerRules.get(rules);
  if (known !== undefined) return known;
  const books = questBooks(host), held = new Map<string, InteractionRules>([[books.lead.player, rules]]);
  books.claim(rules.data.rows.flatMap(row => row.sets));
  books.install(book => {
    const own = new InteractionRules(book.flags, rules.data); held.set(book.player, own);
    if (rules.data.marks.length > 0) book.part(`marks:${rules.data.rows[0]?.id ?? ''}`, { read: () => own.snapshot(), write: saved => { own.restore(saved); } });
  });
  if (rules.data.marks.length > 0) books.lead.part(`marks:${rules.data.rows[0]?.id ?? ''}`, { read: () => rules.snapshot(), write: saved => { rules.restore(saved); } });
  const read = (player: string): InteractionRules => {
    books.of(player);
    const own = held.get(player); if (own === undefined) throw new Error(`Unknown interaction player ${player}`); return own;
  };
  playerRules.set(rules, read);
  return read;
}

/**
 * The renderer-free host's interaction step (SF72): each tick's `script` commands on `actorId` run the prompt row whose
 * `act` they name, when the player's eye stands within the row's spot radius; a crack row runs on the tick the item's
 * lash reaches its act (the command started the crack; the lash lands later, as the browser's does), within the spot's
 * radius plus the crack's reach. Both go through the same `InteractionRules` the browser's interactables use. When
 * the host supplies its page prompt roster, only the selected visible nearest prompt may answer a command.
 * The marks are the step's exact continuation; crack selection stays with the item's own lash.
 */
export function installInteractionRows(host: SimHost, rules: InteractionRules, ports: InteractionRowPorts): void {
  const byAct = new Map(rules.data.rows.map(entry => {
    const spot = ports.spots[entry.at];
    if (spot === undefined) throw new Error(`Interaction row ${entry.id} has no spot ${entry.at}`);
    if (entry.crack !== undefined && ports.crack === undefined) throw new Error(`Interaction row ${entry.id} needs a cracking item`);
    return [entry.act, { entry, spot }] as const;
  }));
  for (const { entry } of byAct.values()) if (entry.crack === undefined) actRoutes(host).interactions.set(entry.id, { actorId: ports.actorId, value: entry.act });
  const picker = createHeadlessPromptPicker(host), books = questBooks(host), rulesOf = playerInteractionRules(host, rules);
  const act = (value: number, lashed: boolean, player: string): void => {
    const feet = host.players.get(player)?.position;
    if (feet === undefined) return;
    const roster = ports.rosterOf?.(player) ?? ports.prompts;
    if (!lashed && roster !== undefined && picker.pick(roster, feet)?.act !== value) return;
    const found = byAct.get(value); if (found === undefined) return;
    const { entry, spot } = found, crack = ports.crack;
    if ((entry.crack !== undefined) !== lashed) return;
    const reach = entry.crack !== undefined && crack !== undefined ? crack.reach[entry.crack] : 0;
    if (!eyeReaches(feet, spot, reach)) return;
    if (rulesOf(player).run(entry.id).ok) ports.done?.(entry.id);
  };
  host.onStep(ports.stepId, () => {
    const list = ports.commands();
    for (let i = 0; i < MAX_COMMANDS; i++) {
      const command = list[i]; if (command === undefined) break;
      if (command.actorId === ports.actorId) act(command.value, false, command.playerId ?? books.lead.player);
    }
    // each player's own lash reaches its own act
    if (ports.crack !== undefined) for (const book of books.each()) {
      const reached = ports.crack.cracked(book.player);
      if (reached !== null) act(reached, true, book.player);
    }
  }, { snapshot: () => rules.snapshot(), restore: value => { rules.restore(v.parse(v.string(), value)); } });
}


const headlessPromptsFinite = v.pipe(v.number(), v.finite());
const headlessPromptsPoint = v.strictObject({ x: headlessPromptsFinite, y: headlessPromptsFinite, z: headlessPromptsFinite });
const nonnegative = v.pipe(headlessPromptsFinite, v.minValue(0));
const registration: v.StrictObjectSchema<{ readonly id: v.NullableSchema<v.SchemaWithPipe<readonly [v.StringSchema<undefined>, v.MinLengthAction<string, 1, undefined>, v.MaxLengthAction<string, 128, undefined>]>, undefined>; readonly position: v.StrictObjectSchema<{ readonly x: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>; readonly y: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>; readonly z: v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>; }, undefined>; readonly radius: v.SchemaWithPipe<readonly [v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>, v.MinValueAction<number, 0, undefined>]>; readonly weak: v.ExactOptionalSchema<v.BooleanSchema<undefined>, undefined>; readonly sight: v.StrictObjectSchema<{ readonly slack: v.SchemaWithPipe<readonly [v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>, v.MinValueAction<number, 0, undefined>]>; readonly body: v.ExactOptionalSchema<v.SchemaWithPipe<readonly [v.StringSchema<undefined>, v.MinLengthAction<string, 1, undefined>, v.MaxLengthAction<string, 256, undefined>]>, undefined>; }, undefined>; }, undefined> = v.strictObject({ id: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(128))), position: headlessPromptsPoint,
  radius: nonnegative, weak: v.exactOptional(v.boolean()), sight: v.strictObject({ slack: nonnegative, body: v.exactOptional(v.pipe(v.string(), v.minLength(1), v.maxLength(256))) }) });
/** Ordered native page captures; owner strings come from actual registered sight identities. */
export type PromptRegistration = v.InferOutput<typeof registration>;
/** Refuse unbounded rosters or malformed capture metadata before binding live host prompts. */
export function parsePromptRegistrations(input: unknown): PromptRegistration[] { return v.parse(v.pipe(v.array(registration), v.maxLength(1024)), input); }

/** A live prompt in actual page registration order; null acts still compete but have no hosted command. */
export interface HeadlessPrompt extends PromptTarget { readonly act: number | null; readonly id?: string | null }
/** A host borrows the authoritative eye and world; selection never performs the prompt's action. */
export interface HeadlessPromptPicker { pick: <T extends HeadlessPrompt>(candidates: readonly T[], feet: Readonly<Feet>) => T | undefined }

/** Bind the captured registration order to live native positions/reach; unhosted prompts still compete. */
export function bindHeadlessPrompts(registrations: readonly PromptRegistration[], resolve: (id: string) => HeadlessPrompt | undefined): HeadlessPrompt[] {
  return registrations.map(registrationRow => {
    const live = registrationRow.id === null ? undefined : resolve(registrationRow.id);
    if (registrationRow.id !== null && live === undefined) throw new Error(`Native prompt ${registrationRow.id} has no live host binding`);
    return { id: registrationRow.id, act: live?.act ?? null, get position() { return live?.position ?? registrationRow.position; }, get radius() { return live?.radius ?? registrationRow.radius; },
      ...(registrationRow.weak === undefined ? {} : { weak: registrationRow.weak }), sight: registrationRow.sight };
  });
}

/** Use the client prompt law against native host collision, from the player's eye 1.68 m above their feet. */
export function createHeadlessPromptPicker(host: Pick<SimHost, 'physics'>): HeadlessPromptPicker {
  const promptEye = { x: 0, y: 0, z: 0 };
  return { pick: (candidates, feet) => {
    promptEye.x = feet.x; promptEye.y = feet.y + 1.68; promptEye.z = feet.z;
    for (const candidate of candidates) if (candidate.sight !== undefined) setPromptSight(candidate, candidate.sight);
    return pickPrompt(candidates, promptEye, host.physics);
  } };
}
