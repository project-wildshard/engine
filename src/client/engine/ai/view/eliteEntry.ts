import * as v from 'valibot';
import { parseEliteEntryRows, ELITE_BODY_COLUMNS, ELITE_CONDITION_COLUMNS, type EliteEntryRows } from '@wildshard/format/eliteEntryRows';
import { EliteFeatureSchema, parseEliteOutputActions, parseExternalElite, type EliteFeatureRows, type EliteOutputAction, type ExternalEliteData } from '@wildshard/format/eliteFeature';
import { isJsonData } from '@wildshard/format/json';
import { HandleIdSchema } from '@wildshard/format/sceneRefs';
import { Scope } from '../../../../shared/engine/app/scope';
import { resourceScope } from '../../../../shared/engine/app/resources';
import { readPouncerSpec, readHowlerSpec } from '../../../../shared/engine/ai/stalker';
import { readWindDiverSpec } from '../../../../shared/engine/ai/diver';
import { ObservationColumnsV2, type V2ColumnOwners } from '../../../../shared/engine/script/observationColumnsV2';
import { NativeEliteController, type NativeEliteEffect, type NativeEliteRow, type NativeEliteServices } from './eliteController';
import { EncounterRegistry } from '../../../../shared/engine/ai/encounters';
import type { Animal } from '../../entities/AnimalView';
import type { RowBodiesView } from '../../entities/RowBodies';
import { Color, MeshLambertMaterial, Object3D, Vector3 } from 'three';
import { GroundTell } from '../../fx/groundTell';
import { setEliteDamage } from '../../../../shared/engine/entities/eliteBrain';
import { pinBrain } from '../../../../shared/engine/ai/pinning';
import { EliteReadiness, eliteDamageScale, eliteScriptFrame, type EliteScriptFight } from '../../../../shared/engine/ai/eliteScript';
import type { HerdBrain } from '../../../../server/engine/ai/herd';
import type { Game } from '../../core/Game';
import type { Player } from '../../player/Player';

type Definition = EliteFeatureRows['fights'][number]['def'];
function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const field of Object.values(value)) freezeJson(field); Object.freeze(value); }
  return value;
}
export interface BorrowedEliteController {
  readonly def: Definition; readonly row: { readonly mode: 'script' | 'herd' };
  readonly observe: (dt: number, frame: { readonly available: boolean; readonly kills: number; readonly bonded: boolean; readonly mount: Animal | null }) => void;
  readonly despawn: () => void; readonly prepareEntered: () => void;
}
/** What a borrowed elite leaves its owner: native effects, its fight's page banks, a body request, a retirement, a support
 * count and an adoption record. */
export type BorrowedEliteEffect = NativeEliteEffect | { readonly kind: 'page-bank'; readonly bank: { readonly validate: () => void; readonly operations: readonly (() => void)[] } }
  | { readonly kind: 'request'; readonly row: ExternalEliteData }
  | { readonly kind: 'retire'; readonly actor: Animal } | { readonly kind: 'support'; readonly count: number }
  | { readonly kind: 'record'; readonly species: string; readonly variant: string };
/** The guarded group a herd-mode elite reads and steers: the existing herd brain's leader state and body, and lead-away. */
export type BorrowedEliteHerd = Pick<HerdBrain<Animal>, 'leaderState' | 'leader' | 'leadAway'>;
/** The fight a script-mode elite drives: its owner's admitted spawn program, paged afresh for each adopted body (its
 *  numbers: ai/eliteScript.ts, which the Node simulation drives too). */
export type BorrowedEliteFight = EliteScriptFight<Vector3, Extract<BorrowedEliteEffect, { readonly kind: 'page-bank' }>['bank']>;
/** The admitted decision program a borrowed elite projects (the entry's condition program loan). */
type EliteProjection = EliteEntryLoans<BorrowedEliteController>['programs'][number]['program'];
/** The existing services a borrowed elite works through; none is authored. `fight` pages a script-mode elite's program. */
export interface BorrowedEliteServices {
  readonly game: Game; readonly player: Player;
  readonly elites: { readonly signature: (id: string) => void; readonly won: (id: string) => void };
  readonly fight?: { readonly page: () => BorrowedEliteFight };
}
/**
 * A borrowed elite (format/eliteFeature ExternalEliteSchema rows). Its decisions are the admitted program's projections
 * (`ready`, `step`, `damage`); its body arrives from its owner after a `request`. A script-mode elite drives its paged
 * fight; a herd-mode one reads and steers its adopted group's leader. Its owner lends the lane tell (`tell`) and the
 * values it is drawn from (`viewValue`, format/eliteFeature ELITE_VIEW_FIELDS; absent reads 0) to the entered view programs.
 */
export class BorrowedElite implements BorrowedEliteController {
  readonly def: Definition;
  readonly row: ExternalEliteData;
  animal: Animal | null = null;
  private herd: BorrowedEliteHerd | null = null;
  private line: readonly Animal[] = [];
  private program: BorrowedEliteFight | null = null;
  private readonly events: BorrowedEliteEffect[] = [];
  private tellValue: GroundTell | null = null;
  private readonly presentationOwner = resourceScope();
  private scope: Scope | null = null;
  private phase2 = false; private pending = false; private elapsed = 0;
  /** the readiness check (ai/eliteScript.ts) */
  private readonly readiness = new EliteReadiness();
  private laneT = 0; private runT = 0; private previousState = 0; private fraction = 0; private isBroken = false;
  private readonly from = new Vector3(); private readonly to = new Vector3();
  private observations: { available: boolean; kills: number; bonded: boolean; mount: Animal | null } = { available: false, kills: 0, bonded: false, mount: null };
  private readonly view = new Map<string, number>();
  readonly viewValue = (field: string): number => this.view.get(field) ?? 0;
  private readonly services: BorrowedEliteServices;
  private readonly decisions: EliteProjection;
  private readonly drop: Object3D;
  constructor(row: ExternalEliteData, services: BorrowedEliteServices, decisions: EliteProjection, drop: Object3D, deferPresentation = false) {
    this.services = services; this.decisions = decisions; this.drop = drop;
    this.row = parseExternalElite(row); this.def = row.def;
    if (!deferPresentation) this.tellValue = new GroundTell(services.game.scene, 'lane', new Color(...row.tell));
  }
  get tell(): GroundTell { if (this.tellValue === null) throw new Error('Unprepared external elite presentation'); return this.tellValue; }
  /** Compiled entry construction calls this once, at the borrowed row's original position. No clock, RNG or body work. */
  prepareEntered(): void {
    const owner = this.presentationOwner;
    if (this.tellValue !== null || owner.disposed || owner.disposing || !resourceScope().belongsTo(owner)) throw new Error('Invalid external elite presentation phase');
    this.tellValue = new GroundTell(this.services.game.scene, 'lane', new Color(...this.row.tell));
  }
  observe(dt: number, observations: typeof this.observations): void {
    this.observations = observations; this.readiness.observe(this.row, this.decisions, dt, observations.kills);
  }
  canSpawn(): boolean { return this.observations.available && this.readiness.eligible; }
  spawn(): void { if (this.animal?.alive === true || this.pending) return; this.pending = true; this.events.push({ kind: 'request', row: this.row }); }
  adopt(animal: Animal, herd: BorrowedEliteHerd | null = null): void {
    if (!this.pending) throw new Error('Unrequested encounter body');
    const program = this.row.mode === 'script' ? this.services.fight?.page() ?? null : null;
    program?.adopt('main', animal.entityId);
    this.pending = false; this.animal = animal; this.herd = herd;
    if (program !== null) {
      this.program = program;
      setEliteDamage(animal, (_body, point) => eliteDamageScale(this.row, this.decisions, Number(this.program?.state('main')['mode'] ?? 0), point.distanceTo(this.services.player.position)));
    } else if (this.row.mode === 'herd') {
      this.tint(animal);
    }
  }
  /** A herd lair's leader wears its row's colour. */
  tint(animal: Animal): void {
    if (this.row.mode !== 'herd') return;
    const color = this.row.spawn.color;
    for (const material of Array.isArray(animal.mesh.material) ? animal.mesh.material : [animal.mesh.material]) if (material instanceof MeshLambertMaterial) material.color.setRGB(...color);
  }
  support(actors: readonly Animal[]): void { this.line = actors; }
  despawn(): void {
    this.scope?.dispose(); this.scope = null; this.view.clear(); this.program?.interrupt(); this.pending = false;
    if (this.row.mode === 'herd') return;
    for (const actor of this.line) if (actor.alive) this.events.push({ kind: 'retire', actor }); this.line = [];
    if (this.animal !== null) this.events.push({ kind: 'retire', actor: this.animal }); this.animal = null; this.program = null;
  }
  reset(): void { this.phase2 = false; this.program?.interrupt(); this.program?.signal('main', 0); this.view.clear(); }
  enterPhase2(): void { this.phase2 = true; }
  broken(): boolean { return this.isBroken; }
  barFrac(): number { return this.row.mode === 'script' && this.animal !== null ? this.animal.hp / this.animal.maxHp : this.fraction; }
  trophy(): void { /* The encounter host owns rewards. */ }
  dropModel(): Object3D { return this.drop.clone(true); }
  tick(dt: number, time: number, engaged: boolean, leashing: boolean): void {
    const animal = this.animal; if (animal === null) { this.view.clear(); return; }
    if (engaged && this.scope === null) { this.scope = this.services.game.levelScope.child(`elite.${this.def.id}`); pinBrain(animal, this.scope); }
    else if (!engaged) { this.scope?.dispose(); this.scope = null; }
    this.elapsed += dt;
    if (this.row.mode === 'script') {
      const program = this.program; if (program === null) return;
      const frame = eliteScriptFrame(this.row, this.decisions, program, this.elapsed, dt, this.services.player.position,
        { kills: this.observations.kills, engaged, leashing, phase2: this.phase2, time, line: this.line.filter(actor => actor.alive).length, yaw: () => animal.yaw });
      this.elapsed = frame.elapsed;
      for (const effect of frame.effects) {
        if (effect.kind === 'support' || effect.kind === 'page-bank') this.events.push(effect);
        else if (effect.kind === 'hit') this.events.push({ kind: 'hit', animal, amount: effect.amount }, { kind: 'knock', x: effect.knockX, z: effect.knockZ });
        else {
          if (effect.signature) this.services.elites.signature(this.def.id);
          if (effect.voice !== undefined) this.events.push({ kind: 'sound', id: effect.voice, at: animal.position.clone() });
          if (effect.feed !== undefined) this.events.push({ kind: 'feed', id: effect.feed, at: animal.position.clone() });
        }
      }
      this.tell.setTime(time);
      const tell = frame.tell, view = this.view; view.set('strike', tell?.strike ?? 0);
      if (tell !== null) { view.set('sx0', tell.x0); view.set('sz0', tell.z0); view.set('sx1', tell.x1); view.set('sz1', tell.z1); view.set('sw', tell.width); }
      return;
    }
    const herd = this.herd; if (herd === null) return;
    if (this.elapsed + 1e-9 >= .1) {
      const state = this.row.states[herd.leaderState] ?? 0;
      const result = this.decisions.project(this.row.step, { dt: this.elapsed, state, previousState: this.previousState, laneT: this.laneT, runT: this.runT,
        phase2: Number(this.phase2), engaged: Number(engaged), bonded: Number(this.observations.bonded), same: Number(herd.leader === animal), health: animal.hp / animal.maxHp });
      this.elapsed = 0; this.previousState = state; this.laneT = result['laneT'] ?? this.laneT; this.runT = result['runT'] ?? this.runT; this.fraction = result['fraction'] ?? 0;
      this.isBroken = herd.leaderState === this.row.broken;
      if (result['capture'] === 1) { this.from.copy(animal.position); this.to.copy(this.services.player.position); }
      if (result['signature'] === 1) this.services.elites.signature(this.def.id);
      if (result['lead'] === 1) herd.leadAway(this.services.player.position.x, this.services.player.position.z);
      const mount = this.observations.mount;
      if (result['adopt'] === 1 && mount !== null) {
        mount.scale = this.row.adopted.scale; mount.mesh.scale.setScalar(mount.scale); this.services.elites.won(this.def.id); this.herd = null;
        this.events.push({ kind: 'record', species: this.row.adopted.kind, variant: this.row.adopted.variant }, { kind: 'feed', id: this.row.adopted.feed, at: mount.position.clone() });
      }
    }
    this.tell.setTime(time);
    const view = this.view; view.set('laneT', this.laneT); view.set('fx', this.from.x); view.set('fz', this.from.z); view.set('tx', this.to.x); view.set('tz', this.to.z);
  }
  drainEffects(): BorrowedEliteEffect[] { return this.events.splice(0); }
}
export interface EliteEntryFrame {
  readonly patrolAvailable: boolean; readonly herdAvailable: boolean; readonly kills: number;
  readonly bonded: boolean; readonly mount: Animal | null;
}
/** The existing concrete lifecycle is lent by the compiled resolver. These are
 * never authored callbacks or factories; rewards/save/display stay on it. */
export interface EliteEntryLifecycle<S extends BorrowedEliteController> {
  readonly entries: readonly { readonly script: { readonly def: Definition } }[];
  readonly signature: (id: string) => void; readonly owned: (id: string) => boolean;
  readonly add: (controller: NativeEliteController | S) => void;
  readonly initialize: () => void; readonly update: (dt: number, t: number) => void;
  readonly drainEnteredOutputs: () => void;
}
type Entry = EliteEntryRows['entries'][number];
const finite = v.pipe(v.number(), v.finite()), pair = v.strictTuple([finite, finite]), colour = v.strictTuple([finite, finite, finite]);
const profile = v.strictObject({
  def: EliteFeatureSchema.entries.fights.pipe[0].item.entries.def,
  pattern: v.picklist(['pouncer', 'howler', 'wind']), spec: v.unknown(),
  kind: HandleIdSchema, yaw: finite, offset: pair, memory: v.record(HandleIdSchema, finite), tell: colour, beam: colour,
  messages: v.record(HandleIdSchema, v.pipe(v.string(), v.maxLength(4096))),
  voices: v.record(HandleIdSchema, v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
  pack: v.exactOptional(v.strictObject({ offset: pair, variants: v.pipe(v.array(HandleIdSchema), v.minLength(1), v.maxLength(64)) })),
});
/** These are original compiled owners, never authored factories or callbacks.
 * Separate typed banks avoid an opaque service map or a reflected property path. */
export interface EliteEntryLoans<S extends BorrowedEliteController> {
  readonly construction: Scope; readonly entered: Scope;
  readonly ui: { readonly id: string; readonly services: Omit<NativeEliteServices, 'animals'> };
  readonly profiles: readonly { readonly id: string; readonly value: unknown }[];
  readonly bodies: readonly { readonly id: string; readonly manager: RowBodiesView }[];
  readonly models: readonly { readonly id: string; readonly object: Object3D }[];
  readonly observations: readonly { readonly id: string; readonly columns: ObservationColumnsV2; readonly owners: V2ColumnOwners }[];
  readonly programs: readonly { readonly id: string; readonly owner: Scope; readonly program: {
    project: (signal: string, observations: Readonly<Record<string, number>>) => Readonly<Record<string, number>>;
  } }[];
  readonly controllers: readonly { readonly id: string; readonly controller: S }[];
  readonly actions: unknown;
}
function requireIds(ids: readonly string[], values: readonly { readonly id: string }[]): void {
  const wanted = new Set(ids);
  if (values.length !== wanted.size || new Set(values.map(value => value.id)).size !== values.length
    || values.some(value => !wanted.has(value.id))) throw new Error('Elite owner cardinality mismatch');
}
function method<O extends object>(owner: O, key: keyof O): unknown { return owner[key]; }
function need<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing elite owner'); return value; }
function nativeRow(input: unknown): NativeEliteRow {
  if (!isJsonData(input)) throw new Error('Elite profile requires plain JSON');
  const row = v.parse(profile, input), variant = row.def.id;
  if (Object.keys(row.memory).length > 16 || !Number.isFinite(row.def.lair.x + row.offset[0]) || !Number.isFinite(row.def.lair.z + row.offset[1])
    || row.pack !== undefined && (!Number.isFinite(row.def.lair.x + row.pack.offset[0]) || !Number.isFinite(row.def.lair.z + row.pack.offset[1]))) throw new Error('Invalid elite spawn pose');
  if (row.pattern === 'pouncer') return { ...row, variant, pattern: row.pattern, spec: readPouncerSpec(row.spec) };
  if (row.pattern === 'howler') return { ...row, variant, pattern: row.pattern, spec: readHowlerSpec(row.spec) };
  return { ...row, variant, pattern: row.pattern, spec: readWindDiverSpec(row.spec) };
}
function admitColumns(columns: ObservationColumnsV2, expected: typeof ELITE_BODY_COLUMNS | typeof ELITE_CONDITION_COLUMNS): void {
  const rows = columns.declaredColumns;
  if (rows.length !== expected.length || rows.some((row, index) => {
    const wanted = expected[index];
    return wanted === undefined || row.name !== wanted.name || row.id !== wanted.id
      || Object.keys(row.source).length !== Object.keys(wanted.source).length
      || Object.entries(wanted.source).some(([key, value]) => !Object.entries(row.source).some(([name, actual]) => name === key && actual === value));
  })) throw new Error('Invalid elite observation declarations');
}
function actionFor(actions: readonly EliteOutputAction[], id: number, controller: number, kind: EliteOutputAction['kind']): EliteOutputAction {
  const action = actions.find(row => row.id === id);
  if (action === undefined || action.controller !== controller || action.kind !== kind) throw new Error('Invalid elite entry action');
  return action;
}
function admitActions(entry: Entry, row: NativeEliteRow, index: number, actions: readonly EliteOutputAction[]): void {
  const controller = entry.controller;
  if (controller.kind === 'borrowed') throw new Error('Native controller required');
  const damages = new Set(row.pattern === 'pouncer' ? [row.spec.swipe.damage, row.spec.pounce.damage] : [row.pattern === 'howler' ? row.spec.bite.damage : row.spec.stoop.damage]);
  if (damages.size !== controller.contacts.length || controller.contacts.some(contact => !damages.has(contact.amount))) throw new Error('Incomplete elite native contacts');
  for (const contact of controller.contacts) {
    const action = actionFor(actions, contact.action, index, 'contact');
    if (action.kind !== 'contact' || !Object.is(action.amount, contact.amount) || actions.filter(value => value.controller === index && value.kind === 'contact' && Object.is(value.amount, contact.amount)).length !== 1) throw new Error('Changed elite contact amount');
  }
  const named = (id: number, kind: 'feed' | 'sound', name: string): void => {
    const action = actionFor(actions, id, index, kind), expected = (kind === 'feed' ? row.messages : row.voices)[name];
    if (expected === undefined || actions.filter(value => value.controller === index && (kind === 'feed' ? value.kind === 'feed' && value.text === expected : value.kind === 'sound' && value.cue === expected)).length !== 1 || (action.kind === 'feed' ? action.text : action.kind === 'sound' ? action.cue : undefined) !== expected) throw new Error('Changed elite native event');
  };
  if (controller.kind === 'pouncer') { actionFor(actions, controller.knock, index, 'knockdown'); named(controller.opened, 'feed', 'opened'); named(controller.growl, 'sound', 'growl'); }
  else if (controller.kind === 'howler') { named(controller.regrouped, 'feed', 'regrouped'); named(controller.interrupted, 'feed', 'interrupted'); named(controller.closed, 'feed', 'closed'); named(controller.howl, 'sound', 'howl'); }
  else { actionFor(actions, controller.knock, index, 'knockdown'); named(controller.grounded, 'feed', 'grounded'); named(controller.cry, 'sound', 'cry'); }
  if (row.pack !== undefined) {
    const matching = actions.filter(action => action.controller === index && action.kind === 'wildlife-pack' && action.variants.length === row.pack?.variants.length
      && action.variants.every((variant, at) => variant === row.pack?.variants[at]));
    if (matching.length !== 1) throw new Error('Invalid elite pack action');
  }
}
/** Admit the WHOLE construction before allocating a tell, bar, kernel or body.
 * A prepared plan has no scheduler, registry, save state or random stream. */
export function prepareEliteEntry<S extends BorrowedEliteController = BorrowedElite>(input: unknown, source: EliteEntryLoans<S>): {
  readonly rows: EliteEntryRows; readonly validate: () => void;
  readonly construct: () => readonly (NativeEliteController | S)[];
  readonly observeNative: () => void; readonly updateConditions: (dt: number) => void; readonly holds: (id: string) => boolean;
  readonly bind: (lifecycle: EliteEntryLifecycle<S>, registry: EncounterRegistry, skins: Set<string>) => {
    readonly scripts: readonly (NativeEliteController | S)[];
    readonly initialize: (frame: EliteEntryFrame) => void;
    readonly update: (dt: number, t: number, frame: EliteEntryFrame) => void;
  };
} {
  const rows = freezeJson(parseEliteEntryRows(input)), { construction, entered, ui, profiles, bodies, models, observations, programs, controllers, actions } = source;
  const live = (): void => {
    if (!(construction instanceof Scope) || !(entered instanceof Scope) || construction.disposed || construction.disposing || entered.disposed || entered.disposing
      || source.construction !== construction || source.entered !== entered || source.ui !== ui || source.profiles !== profiles || source.bodies !== bodies || source.models !== models
      || source.observations !== observations || source.programs !== programs || source.controllers !== controllers || source.actions !== actions) throw new Error('Retired or replaced elite entry owner');
  };
  live();
  const banks = [profiles, bodies, models, observations, programs, controllers], pinned = banks.map(bank => [...bank]), names = banks.map(bank => bank.map(loan => loan.id));
  if (ui.id !== rows.ui) throw new Error('Missing elite UI loan');
  const native = rows.entries.flatMap(row => row.controller.kind === 'borrowed' ? [] : [row.controller]);
  requireIds(native.map(row => row.profile), profiles); requireIds(native.map(row => row.body), bodies); requireIds(native.map(row => row.model), models);
  if (native.some(row => row.observations === rows.conditionObservations)) throw new Error('Ambiguous elite observation owner');
  requireIds([rows.conditionObservations, ...native.map(row => row.observations)], observations);
  requireIds(rows.conditions.map(row => row.program), programs);
  requireIds(rows.entries.flatMap(row => row.controller.kind === 'borrowed' ? [row.controller.controller] : []), controllers);
  const ledges = ui.services.ledges, rock = ui.services.rock;
  if (native.some(row => row.kind === 'pouncer') && (ledges.length > 6 || ledges.some(row => ![row.x, row.y, row.z, row.r].every(Number.isFinite) || row.r < 0))
    || native.some(row => row.kind === 'wind') && ![rock.x, rock.z, rock.top].every(Number.isFinite)) throw new Error('Invalid elite native terrain loan');
  const outputActions = parseEliteOutputActions(actions, rows.entries.length);
  for (const loan of observations) {
    if (!(loan.columns instanceof ObservationColumnsV2) || loan.owners.scope !== entered) throw new Error('Foreign elite observation loan');
    const condition = loan.id === rows.conditionObservations;
    admitColumns(loan.columns, condition ? ELITE_CONDITION_COLUMNS : ELITE_BODY_COLUMNS);
    if (condition ? loan.owners.clock === undefined || loan.owners.weather === undefined : loan.owners.environment === undefined) throw new Error('Missing elite observation authority');
  }
  for (const loan of programs) if (loan.owner.disposed || loan.owner.disposing) throw new Error('Retired elite condition program');
  const plans = rows.entries.map((entry, index) => {
    const controller = entry.controller;
    if (controller.kind === 'borrowed') {
      const loan = need(controllers.find(row => row.id === controller.controller));
      if (typeof method(loan.controller, 'prepareEntered') !== 'function' || loan.controller.def.id !== entry.id || loan.controller.def.rule !== entry.condition) throw new Error('Foreign borrowed elite controller');
      return { kind: 'borrowed' as const, loan, controller: loan.controller, definition: loan.controller.def, row: loan.controller.row, mode: loan.controller.row.mode, prepare: method(loan.controller, 'prepareEntered'), observe: method(loan.controller, 'observe'), despawn: method(loan.controller, 'despawn'), id: entry.id, rule: entry.condition };
    }
    const loan = need(profiles.find(row => row.id === controller.profile)), row = nativeRow(loan.value), body = need(bodies.find(value => value.id === controller.body)), model = need(models.find(value => value.id === controller.model));
    if (row.pattern !== controller.kind || row.def.id !== entry.id || row.def.rule !== entry.condition || !(model.object instanceof Object3D)
      || row.kind !== controller.spawn.kind || !Object.is(row.yaw, controller.spawn.yaw) || row.offset.some((value, at) => !Object.is(value, controller.spawn.offset[at]))
      || Object.keys(row.memory).length !== Object.keys(controller.spawn.memory).length || Object.entries(row.memory).some(([name, value]) => !Object.is(value, controller.spawn.memory[name]))) throw new Error('Changed elite native profile');
    admitActions(entry, row, index, outputActions);
    return { kind: 'native' as const, row: freezeJson({ ...row, kind: controller.spawn.kind, variant: controller.spawn.variant, yaw: controller.spawn.yaw, offset: controller.spawn.offset, memory: controller.spawn.memory }), body, manager: body.manager, model, object: model.object, profile: loan, original: loan.value };
  });
  const methods = plans.map(plan => plan.kind === 'borrowed' ? null : { manager: plan.manager, spawn: method(plan.manager, 'spawn'), retire: method(plan.manager, 'retire'), model: plan.object, clone: method(plan.object, 'clone') });
  if (ui.services.game.levelScope !== construction) throw new Error('Foreign elite construction owner');
  const services = ui.services, scene = services.game.scene, camera = services.game.camera, level = services.game.levelScope, game = ui.services.game, player = ui.services.player, lifecycle = ui.services.lifecycle, signature = lifecycle.signature, bar = ui.services.bar;
  const columns = observations.map(loan => ({ loan, columns: loan.columns, declarations: loan.columns.declaredColumns, owners: loan.owners, capture: method(loan.columns, 'capture'), environment: loan.owners.environment, clock: loan.owners.clock, weather: loan.owners.weather, player: loan.owners.player, self: loan.owners.self, group: loan.owners.self.group, slot: loan.owners.self.slot, observed: loan.owners.observed, grass: loan.owners.environment?.grassHeightAt }));
  const projections = programs.map(loan => ({ loan, program: loan.program, project: loan.program.project, owner: loan.owner }));
  const replacedLoans=banks.map((_,index)=>(loan:{readonly id:string},at:number):boolean=>loan!==pinned[index]?.[at]||loan.id!==names[index]?.[at]);
  const replacedBank=(bank:(typeof banks)[number],index:number):boolean=>bank.length!==pinned[index]?.length||bank.some(need(replacedLoans[index]));
  const replacedMethod = (row:(typeof methods)[number]):boolean => row !== null && (row.manager.spawn !== row.spawn || row.manager.retire !== row.retire || row.model.clone !== row.clone);
  const replacedPlan = (plan:(typeof plans)[number]):boolean => plan.kind === 'borrowed' ? plan.loan.controller !== plan.controller || plan.controller.def !== plan.definition || plan.controller.row !== plan.row || plan.row.mode !== plan.mode || method(plan.controller, 'prepareEntered') !== plan.prepare || plan.controller.observe !== plan.observe || plan.controller.despawn !== plan.despawn || plan.definition.id !== plan.id || plan.definition.rule !== plan.rule : plan.body.manager !== plan.manager || plan.model.object !== plan.object || plan.profile.value !== plan.original;
  const replacedColumns = (row:(typeof columns)[number]):boolean => row.loan.columns !== row.columns || row.loan.owners !== row.owners || row.columns.capture !== row.capture || row.columns.declaredColumns !== row.declarations || row.owners.scope !== entered || row.owners.environment !== row.environment || row.owners.clock !== row.clock || row.owners.weather !== row.weather || row.owners.player !== row.player || row.owners.self !== row.self || row.self.group !== row.group || row.self.slot !== row.slot || row.owners.observed !== row.observed || row.environment?.grassHeightAt !== row.grass;
  const replacedProjection = (row:(typeof projections)[number]):boolean => row.loan.program !== row.program || row.program.project !== row.project || row.loan.owner !== row.owner || row.owner.disposed || row.owner.disposing;
  const validate = (): void => {
    live();
    if (ui.services !== services || banks.some(replacedBank)
      || level.disposed || level.disposing || game.scene !== scene || game.camera !== camera || services.ledges !== ledges || services.rock !== rock
      || methods.some(replacedMethod) || ui.services.game !== game || game.levelScope !== level || ui.services.player !== player || ui.services.lifecycle !== lifecycle || lifecycle.signature !== signature || ui.services.bar !== bar
      || plans.some(replacedPlan)
      || columns.some(replacedColumns)
      || projections.some(replacedProjection)) throw new Error('Replaced elite native loan');
  };
  validate(); let constructed = false, allocated: Scope | null = null;
  let built: readonly (NativeEliteController | S)[] | null = null, elapsed = 0, initialized = false;
  const accepted = new Map<string, boolean>();
  const observeNative = (): void => {
    validate();
    if (built === null) throw new Error('Elite controllers have not been constructed');
    for (let index = 0; index < plans.length; index++) {
      validate();
      const plan = plans[index], controller = built[index], entry = rows.entries[index];
      if (plan?.kind !== 'native') continue;
      if (!(controller instanceof NativeEliteController) || entry === undefined || entry.controller.kind === 'borrowed') throw new Error('Changed elite native construction');
      const observationId = entry.controller.observations, loan = need(observations.find(row => row.id === observationId)), actor = controller.animal;
      if (actor !== null && plan.manager.retired(actor)) continue; // a server's rows stand in for this page's bodies
      if (actor !== null && !plan.manager.animals.includes(actor)) throw new Error('Foreign elite observation actor');
      const frame = loan.columns.capture({ ...loan.owners, self: { ...loan.owners.self, actor, identity: actor?.entityId ?? '' } });
      const value = (name: string): number => need(frame.find(row => row.name === name)).value;
      validate();
      controller.observe({ playerCrouched: value('playerCrouched') === 1, playerFwdX: value('playerFwdX'), playerFwdZ: value('playerFwdZ'), grassHeight: value('grassHeight'), wind: { x: value('windX'), z: value('windZ') } });
    }
  };
  const updateConditions = (dt: number): void => {
    validate();
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid elite condition step');
    const loan = need(observations.find(row => row.id === rows.conditionObservations));
    const frame = Object.fromEntries(loan.columns.capture(loan.owners).map(row => [row.name, row.value]));
    elapsed += dt;
    if (initialized && elapsed + 1e-9 < .1) return;
    initialized = true; elapsed = 0;
    for (const condition of rows.conditions) {
      validate();
      const program = need(programs.find(row => row.id === condition.program));
      const result = program.program.project(condition.signal, { ...frame, ...Object.fromEntries(condition.observations.map(row => [row.field, row.value])) });
      validate(); accepted.set(condition.id, result['accept'] === 1);
    }
  };
  const frameValid = (frame: EliteEntryFrame): void => { if (typeof frame.patrolAvailable !== 'boolean' || typeof frame.herdAvailable !== 'boolean' || typeof frame.bonded !== 'boolean' || !Number.isFinite(frame.kills)) throw new Error('Invalid elite entered frame'); };
  const result = { rows, validate, observeNative, updateConditions, bind: (owner: EliteEntryLifecycle<S>, registry: EncounterRegistry, skins: Set<string>) => {
    validate();
    if (constructed || owner !== services.lifecycle || !(registry instanceof EncounterRegistry) || !(skins instanceof Set) || owner.entries.length > 0) throw new Error('Foreign elite owner loan');
    const entries = owner.entries, registryMethods = [method(registry, 'preflightElite'), method(registry, 'prepareElites')];
    const keys = ['signature', 'owned', 'add', 'initialize', 'update', 'drainEnteredOutputs'] as const, calls = keys.map(key => method(owner, key));
    let bound: readonly (NativeEliteController | S)[] = [];
    const liveLifecycle = (): void => {
      validate();
      if (owner.entries !== entries || entries.length !== bound.length || entries.some((entry, index) => entry.script !== bound[index])
        || keys.some((key, index) => method(owner, key) !== calls[index]) || method(registry, 'preflightElite') !== registryMethods[0] || method(registry, 'prepareElites') !== registryMethods[1]) throw new Error('Replaced elite owner loan');
    };
    liveLifecycle(); registry.preflightElite(rows.entries.map(row => row.id), construction);
    updateConditions(0); liveLifecycle();
    const scripts = entered.run(result.construct);
    let prepared: ReturnType<EncounterRegistry['prepareElites']> | undefined;
    try {
      prepared = registry.prepareElites(scripts.map(script => ({ id: script.def.id, brain: script })), construction);
      const lease = prepared;
      for (const script of scripts) {
        liveLifecycle(); lease.commitNext(); owner.add(script); bound = scripts.slice(0, bound.length + 1);
        liveLifecycle();
        if (script.def.drop.skin !== null && owner.owned(script.def.id)) skins.add(script.def.drop.skin);
      }
    } catch (error) {
      const failures: unknown[] = [error];
      try { prepared?.release(); } catch (cleanup) { failures.push(cleanup); }
      try { allocated?.dispose(); } catch (cleanup) { failures.push(cleanup); }
      if (failures.length > 1) throw new AggregateError(failures, 'Elite lifecycle binding failed', { cause: error });
      throw error;
    }
    const lease = need(prepared);
    entered.onDispose(lease.release);
    const observeExternal = (dt: number, frame: EliteEntryFrame): void => {
      liveLifecycle(); lease.validate();
      frameValid(frame);
      for (const script of scripts) if (!(script instanceof NativeEliteController)) {
        liveLifecycle(); script.observe(dt, { available: script.row.mode === 'script' ? frame.patrolAvailable : frame.herdAvailable, kills: frame.kills, bonded: frame.bonded, mount: frame.mount });
      }
    };
    return { scripts, initialize: (frame: EliteEntryFrame) => {
      liveLifecycle(); frameValid(frame); observeNative(); observeExternal(0, frame); liveLifecycle(); owner.initialize(); liveLifecycle(); owner.drainEnteredOutputs();
    }, update: (dt: number, t: number, frame: EliteEntryFrame) => {
      liveLifecycle(); frameValid(frame); observeNative(); updateConditions(dt); observeExternal(dt, frame); liveLifecycle(); owner.update(dt, t); liveLifecycle(); owner.drainEnteredOutputs();
    } };
  }, holds: (id: string) => { validate(); return accepted.get(id) ?? false; }, construct: () => {
    validate();
    if (constructed || resourceScope() !== entered) throw new Error('Invalid elite construction phase');
    constructed = true;
    const allocation = entered.child(`elite-entry.${rows.id}`); allocated = allocation;
    try { built = Object.freeze(allocation.run(() => plans.map(plan => { validate(); if (plan.kind === 'borrowed') { plan.controller.prepareEntered(); validate(); return plan.controller; } const controller = new NativeEliteController(plan.row, { ...ui.services, animals: plan.manager }, plan.object); validate(); return controller; }))); return built; }
    catch (error) {
      try { allocation.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Elite construction and release failed', { cause: cleanup }); }
      throw error;
    }
  } };
  return result;
}


/** The declared feature is prepared during construction and borrows entered
 * authorities only at its original binding slot. It creates no save or clock
 * beyond the original bounded condition owner; kernels retain native cadence. */
export class DeclaredEliteEntry<S extends BorrowedEliteController = BorrowedElite> {
  readonly rows: EliteEntryRows;
  readonly skins: Set<string> = new Set<string>();
  get scripts(): readonly (NativeEliteController | S)[] { return this.live() ? this.binding?.scripts ?? [] : []; }
  get bar(): NativeEliteServices['bar'] | null { return this.live() ? this.servicesBar : null; }
  private servicesBar: NativeEliteServices['bar'] | null = null;
  private entered: Scope | null = null;
  private plan: ReturnType<typeof prepareEliteEntry<S>> | null = null;
  private binding: ReturnType<ReturnType<typeof prepareEliteEntry<S>>['bind']> | null = null;
  private readonly construction: Scope;
  constructor(input: unknown, construction: Scope) {
    this.construction = construction;
    if (construction.disposed || construction.disposing) throw new Error('Retired elite feature construction');
    this.rows = freezeJson(parseEliteEntryRows(input));
  }
  holds(id: string): boolean { return this.live() ? this.plan?.holds(id) ?? false : false; }
  private live(): boolean { return !this.construction.disposed && !this.construction.disposing && this.entered !== null && !this.entered.disposed && !this.entered.disposing; }
  bind(source: EliteEntryLoans<S>, lifecycle: EliteEntryLifecycle<S>, registry: EncounterRegistry): void {
    if (this.construction.disposed || this.construction.disposing || source.construction !== this.construction
      || this.entered !== null && (!this.entered.disposed || this.entered.disposing)) throw new Error('Retired or occupied elite feature');
    const plan = prepareEliteEntry(this.rows, source);
    this.entered = source.entered; this.plan = plan;
    try {
      this.binding = plan.bind(lifecycle, registry, this.skins); this.servicesBar = source.ui.services.bar;
      const entered = source.entered;
      entered.onDispose(() => { if (this.entered === entered) { this.binding = null; this.plan = null; this.servicesBar = null; } });
    } catch (error) { this.plan = null; this.binding = null; throw error; }
  }
  initialize(frame: EliteEntryFrame): void { if (this.live()) this.binding?.initialize(frame); }
  update(dt: number, t: number, frame: EliteEntryFrame): void { if (this.live()) this.binding?.update(dt, t, frame); }
}
