import * as v from 'valibot';
import { Vector3 } from 'three';
import { isJsonData } from '@wildshard/format/json';
import { HandleIdSchema } from '@wildshard/format/sceneRefs';
import { Scope } from '../../../shared/engine/app/scope';
import type { SimHost } from '../sim';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { TerrainField } from '../../../shared/engine/level/data';
import type { V2EnvironmentColumns } from '../../../shared/engine/script/observationColumnsV2';
import { StalkerBrain, readPouncerSpec, readHowlerSpec, type PouncerContext, type PouncerLedge } from '../../../shared/engine/ai/stalker';
import type { PackBrain } from './pack';
import { StrikeRunner, type StrikeSpec } from '../../../shared/engine/ai/strikes';
import { canReach } from '../../../shared/engine/ai/reach';
import { nearestOnGround } from '../../../shared/engine/sim/nearPlayer';
import { ELITE_MOMENTS, eliteGroundWord, eliteMomentWord, sayFightView } from '../../../shared/engine/sim/shardRows';

const finite = v.pipe(v.number(), v.finite()), handle = HandleIdSchema;
const rowSchema: v.GenericSchema<NativeEliteKernelPayloadInput, NativeEliteKernelPayload> = v.strictObject({
  id: handle, profile: v.variant('pattern', [
    v.strictObject({ pattern: v.literal('pouncer'), spec: v.unknown() }),
    v.strictObject({ pattern: v.literal('howler'), spec: v.unknown() }),
  ]), lair: v.strictObject({ x: finite, z: finite }), awareRadius: v.pipe(finite, v.minValue(0)),
  contacts: v.pipe(v.array(v.strictObject({ amount: v.pipe(finite, v.minValue(0)), strike: handle })), v.maxLength(8)), fallbackStrike: handle,
  knockdown: v.strictObject({ speed: v.pipe(finite, v.minValue(0)), min: v.pipe(finite, v.minValue(0)), max: v.pipe(finite, v.minValue(0)), seconds: v.pipe(finite, v.minValue(0)) }),
});
/** Data chooses existing kernel profiles and ordered contact selections. */
export type NativeEliteKernelRow = v.InferInput<typeof rowSchema>;
/** The original member's fields; this binder creates no continuation owner. */
export interface NativeEliteKernelState { animal: AnimalSim | null; phase2: boolean; pack: PackBrain<AnimalSim> | null }
export interface NativeEliteKernelLoans {
  readonly scope: Scope; readonly host: SimHost;
  readonly lifecycle: { readonly signature: (id: string) => void };
  readonly contacts: StrikeRunner; readonly strikes: readonly StrikeSpec[];
  readonly terrain: Pick<TerrainField, 'heightAt'>; readonly environment: V2EnvironmentColumns;
  readonly ledges: readonly PouncerLedge[];
  readonly brains: Map<AnimalSim, { readonly think: (body: AnimalSim, context: PouncerContext<AnimalSim>) => void; readonly act: (body: AnimalSim) => void }>;
}
const silent = (): void => undefined;
function method<O extends object>(owner: O, key: keyof O): unknown { return owner[key]; }
function freezeRows<T>(value: T): T {
  if (typeof value === 'object' && value !== null) { for (const child of Object.values(value)) freezeRows(child); Object.freeze(value); }
  return value;
}
/** Renderer-free construction/registration of the original native kernels.
 * Population, lifecycle, physics, RNG, contact and save authorities stay lent;
 * rows supply no factories, property paths or service callbacks. */
export class NativeEliteKernels {
  private readonly rows;
  private readonly host; private readonly scope; private readonly lifecycle;
  private readonly contacts; private readonly strikeOwner; private readonly strikes; private readonly terrain; private readonly environment;
  private readonly ledges; private readonly brains;
  private readonly players; private readonly combat; private readonly rng;
  private readonly methods: readonly unknown[];
  private readonly loans: NativeEliteKernelLoans;
  private readonly head = new Vector3(); private readonly direction = new Vector3(); private readonly knocked = { x: 0, z: 0 };
  private readonly created = new WeakMap<StalkerBrain<AnimalSim>, { readonly id: string; readonly state: NativeEliteKernelState }>();
  constructor(input: unknown, loans: NativeEliteKernelLoans) {
    this.loans = loans;
    if (!isJsonData(input)) throw new Error('Elite kernels require plain JSON rows');
    const rows = v.parse(v.pipe(v.array(rowSchema), v.minLength(1), v.maxLength(64)), input);
    this.rows = freezeRows(rows.map(row => ({ ...row, profile: row.profile.pattern === 'pouncer'
      ? { pattern: row.profile.pattern, spec: readPouncerSpec(row.profile.spec) }
      : { pattern: row.profile.pattern, spec: readHowlerSpec(row.profile.spec) } })));
    const { host, scope, lifecycle, contacts, strikes, terrain, environment, ledges, brains } = loans;
    if (rows.some(row => row.profile.pattern === 'pouncer') && ledges.length > 6) throw new RangeError('Pouncer ledge bound exceeded');
    this.host = host; this.scope = scope; this.lifecycle = lifecycle; this.contacts = contacts; this.strikeOwner = strikes; this.strikes = [...strikes];
    this.terrain = terrain; this.environment = environment; this.ledges = ledges; this.brains = brains;
    this.players = host.players; this.combat = host.combat; this.rng = host.rng;
    if (!(scope instanceof Scope) || !(contacts instanceof StrikeRunner) || !(brains instanceof Map) || scope !== host.scope
      || new Set(rows.map(row => row.id)).size !== rows.length || new Set(strikes.map(row => row.id)).size !== strikes.length
      || rows.some(row => row.knockdown.min > row.knockdown.max || new Set(row.contacts.map(contact => contact.amount)).size !== row.contacts.length
        || [...row.contacts.map(contact => contact.strike), row.fallbackStrike].some(name => !strikes.some(strike => strike.id === name)))) throw new Error('Invalid elite kernel owners or rows');
    this.methods = [method(contacts, 'contact'), method(terrain, 'heightAt'), method(environment, 'grassHeightAt'), method(lifecycle, 'signature'), method(this.combat, 'hit'), method(this.rng, 'stream'), method(brains, 'set')];
    if (this.methods.some(callable => typeof callable !== 'function')) throw new Error('Missing elite kernel operation');
    this.validate();
  }
  /** Same admitted immutable rows; reading them performs no owner query. */
  get declaredRows(): readonly NativeEliteKernelRow[] { return this.rows; }
  /** Check the complete construction/entered transaction before allocation. */
  validate(): void {
    const loans = this.loans, host = this.host;
    if (this.scope.disposed || this.scope.disposing || loans.scope !== this.scope || loans.host !== host || host.scope !== this.scope
      || loans.lifecycle !== this.lifecycle || loans.contacts !== this.contacts || loans.terrain !== this.terrain || loans.environment !== this.environment
      || loans.ledges !== this.ledges || loans.brains !== this.brains || loans.strikes !== this.strikeOwner || loans.strikes.length !== this.strikes.length || loans.strikes.some((row, i) => row !== this.strikes[i])
      || host.players !== this.players || host.combat !== this.combat || host.rng !== this.rng
      || [method(this.contacts, 'contact'), method(this.terrain, 'heightAt'), method(this.environment, 'grassHeightAt'), method(this.lifecycle, 'signature'), method(this.combat, 'hit'), method(this.rng, 'stream'), method(this.brains, 'set')]
        .some((callable, i) => callable !== this.methods[i])) throw new Error('Retired or replaced elite kernel owner');
  }
  create(id: string, state: NativeEliteKernelState): StalkerBrain<AnimalSim> {
    this.validate();
    const row = this.rows.find(candidate => candidate.id === id); if (row === undefined) throw new Error('Missing elite kernel row');
    // Native restore replaces physics after installing controllers; each contact
    // pins the current owner through both reach checks and damage delivery.
    // Each elite deals with the player nearest it, read as it acts: a stored player would pin one member of the room.
    const foe = () => { const at = state.animal?.position ?? row.lair; return nearestOnGround(this.players, at.x, at.z); };
    let striking: AnimalSim | null = null, physics = this.host.physics, struck = foe();
    const hit = { source: 'env' as const, sourceTags: [`elite.${id}`, 'feel.blow', 'cover.checked'] as `${string}.${string}`[], target: struck.health,
      amount: 0, point: this.head, dir: this.direction, cause: { kind: '', label: '' } };
    const reach = (): boolean => {
      this.validate();
      if (this.host.physics !== physics) throw new Error('Replaced elite contact physics owner');
      const allowed = striking !== null && canReach(striking, struck.position, physics);
      if (this.host.physics !== physics) throw new Error('Replaced elite contact physics owner');
      return allowed;
    };
    const deliver = (): void => { this.validate(); if (reach()) this.combat.hit(hit); };
    const contactPorts = { canReach: reach, hit: deliver };
    const hurt = (actor: AnimalSim, amount: number): void => {
      this.validate(); physics = this.host.physics; striking = actor; struck = nearestOnGround(this.players, actor.position.x, actor.position.z); hit.target = struck.health; hit.amount = amount; hit.point = actor.position; hit.cause.kind = actor.kind; hit.cause.label = actor.label;
      const name = row.contacts.find(contact => contact.amount === amount)?.strike ?? row.fallbackStrike;
      const strike = this.strikes.find(candidate => candidate.id === name); if (strike === undefined) throw new Error('Missing elite contact row');
      this.contacts.contact(strike, { ...contactPorts, actor, target: struck.position });
    };
    const common = { player: { get position() { return foe().position; } }, lair: row.lair, phase2: () => state.phase2, signature: () => { this.validate(); this.lifecycle.signature(id); } };
    // A page on a server steps no kernel: what it would paint and play is said, and nothing here reads it.
    const ground = eliteGroundWord(id), word = eliteMomentWord(id);
    let tellTime = 0, telling = false;
    const tells = { setTime: (t: number): void => { tellTime = t; }, lane: silent, ring: (x: number, z: number, radius: number, strength: number): void => { telling = true; sayFightView(this.host, ground, [x, z, radius, strength, tellTime]); },
      hide: (): void => { if (telling) sayFightView(this.host, ground, []); telling = false; } };
    const moment = (name: typeof ELITE_MOMENTS[number], at?: { readonly x: number; readonly y: number; readonly z: number }): void => { sayFightView(this.host, word, [ELITE_MOMENTS.indexOf(name), at?.x ?? 0, at?.y ?? 0, at?.z ?? 0]); };
    const profile = row.profile;
    const controller = profile.pattern === 'pouncer' ? new StalkerBrain<AnimalSim>({ pattern: profile.pattern, spec: profile.spec, ports: {
      ...common, ledges: this.ledges, heightAt: (x, z) => { this.validate(); return this.terrain.heightAt(x, z); }, awareRadius: row.awareRadius, ring: tells,
      isHead: (actor, point) => actor.headWorld(this.head).distanceTo(point) < actor.dims.headRadius * actor.scale + .12,
      hurt, knock: (dx, dz) => {
        this.validate(); const d = Math.hypot(dx, dz) || 1, x = dx / d, z = dz / d, length = Math.hypot(x, z) || 1;
        const speed = row.knockdown.speed * Math.max(row.knockdown.min, Math.min(row.knockdown.max, 1));
        this.knocked.x = x / length * speed; this.knocked.z = z / length * speed;
        foe().dashAt(this.knocked.x, this.knocked.z, row.knockdown.seconds);
      }, opened: () => { moment('opened'); }, growl: at => { moment('growl', at); },
    } }) : new StalkerBrain<AnimalSim>({ pattern: profile.pattern, spec: profile.spec, ports: {
      ...common, pack: () => state.pack, environment: () => this.environment, random: () => this.rng.stream('ai').next(), rings: tells,
      hurt, regrouped: () => { moment('regrouped'); }, interrupted: () => { moment('interrupted'); }, closed: () => { moment('closed'); }, howl: at => { moment('howl', at); },
    } });
    this.created.set(controller, { id, state }); return controller;
  }
  /** Preserve the selected kernel's original phase transition at the core slot. */
  enterPhase2(id: string, controller: StalkerBrain<AnimalSim>, state: NativeEliteKernelState): void {
    this.validate(); const entry = this.created.get(controller), row = this.rows.find(candidate => candidate.id === id);
    if (entry?.id !== id || entry.state !== state || row === undefined) throw new Error('Foreign elite phase binding');
    if (row.profile.pattern === 'howler') controller.enterPhase2(state.animal);
  }
  /** Pure original-controller admission for a surrounding whole-bank restore. */
  validateController(id: string, controller: StalkerBrain<AnimalSim>, state: NativeEliteKernelState): void {
    this.validate(); const entry = this.created.get(controller);
    if (entry?.id !== id || entry.state !== state) throw new Error('Foreign elite kernel binding');
  }
  bind(id: string, controller: StalkerBrain<AnimalSim>, state: NativeEliteKernelState, actor: AnimalSim): void {
    this.validateController(id, controller, state); const row = this.rows.find(candidate => candidate.id === id);
    if (row === undefined || state.animal !== actor || this.host.entities.get(actor.entityId) !== actor) throw new Error('Foreign elite kernel binding');
    this.brains.set(actor, {
      think: (body, context) => { if (this.scope.disposed || this.scope.disposing) return; this.validate(); if (body !== actor) throw new Error('Foreign elite body'); if (row.profile.pattern === 'pouncer') controller.decidePouncer(body, context); else controller.decideHowler(body, context); },
      act: body => { if (this.scope.disposed || this.scope.disposing) return; this.validate(); if (body !== actor) throw new Error('Foreign elite body'); controller.act(body); },
    });
    actor.combatActor().damageMul = request => { if (this.scope.disposed || this.scope.disposing) return 1; this.validate(); return controller.damage(actor, request.point); };
  }
}

/** Complete admitted continuation, independent of validator implementation metadata. */
type NativeEliteKernelPayloadInput = NativeEliteKernelPayload;
interface NativeEliteKernelPayloadFields {
    id: string;
    profile: {
        pattern: "pouncer";
        spec: unknown;
    } | {
        pattern: "howler";
        spec: unknown;
    };
    lair: {
        x: number;
        z: number;
    };
    awareRadius: number;
    contacts: {
        amount: number;
        strike: string;
    }[];
    fallbackStrike: string;
    knockdown: {
        speed: number;
        min: number;
        max: number;
        seconds: number;
    };
}
type NativeEliteKernelPayload = { [Key in keyof NativeEliteKernelPayloadFields]: NativeEliteKernelPayloadFields[Key] };
