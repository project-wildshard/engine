import type { ShardContext } from '../plugin/context';
import { installEnteredLevelService } from '../shard/retainedHooks';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { publishEntryOwner, presentEntryOwner, type WorldFrameOwner } from '../../../shared/game/shardfile/entryOwners';
import { DataPanel } from '../ui/dataPanels';
import { enteredAdventurePersistence } from '../../../shared/game/quest/chapterBindings';
import type { HeldClaims } from '../loadout/claims';
import { companionToName } from '../../../shared/game/riding/companions';
import { MountedReins } from './reins';
import { ridingPopulation } from '../../../shared/game/riding/pagePopulation';
import * as THREE from 'three';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { Animal } from '@wildshard/engine/entities/AnimalView';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { InputService } from '@wildshard/engine/input/InputService';
import type { LevelContext } from '@wildshard/engine/level/context';
import type { Player } from '@wildshard/engine/player/Player';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import type { TamingPrograms } from '../../../shared/game/riding/taming';
import { RIDING_ACT, RIDING_ROW, type TamingObservation } from '../../../shared/game/riding/bindingTypes';
import { Mount } from './mount';
import { wirePage } from '../shardfile/wirePage';
import { enteredMount } from '../../../shared/game/riding/entered';
import { RidingControlsSchema, PageTamingBindingSchema, ClientRidingSessionSchema, cleanMountName, type RidingControls, type MountProfile } from '@wildshard/format/riding';
import { playerModes } from '@wildshard/engine/player/modes';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { RideHUD } from './hud';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import type {CellField} from '../../../shared/game/systems/cellField';
import type { Interactable } from '@wildshard/engine/world/interact/types';

/** A herd by its shape: the brain is the population's, and the port lends it. Its members are this page's bodies. */
function nativeHerds(value: readonly HerdBrain<Animal>[]): boolean {
  return value.length <= 8 && value.every((herd: object) => 'stallion' in herd && 'trust' in herd && 'members' in herd && Array.isArray(herd.members) && herd.members.every((actor: unknown) => actor instanceof Animal));
}
/** Exact entered population owners, borrowed without a second service book. */
export interface PageRidingOwners {
  readonly id: string; readonly herds: readonly HerdBrain<Animal>[];
  readonly wind: { x: number; z: number; strength: number };
}
function ridingHerds(owners: PageRidingOwners, id: string): readonly HerdBrain<Animal>[] {
  if (!nativeHerds(owners.herds)) throw new Error('Invalid rendered riding herds');
  if (owners.id !== id) throw new Error('Mismatched rendered riding herds');
  return owners.herds;
}
export interface PageTamingRows {
  herds: string; programs: TamingPrograms; binding: unknown; savedBond: string | null;
  rest: { x: number; z: number; face: { x: number; z: number } };
  adopted: { kind: string; variant: string; upgrade: { scale: number; colour: readonly number[] } };
  thrownLabel: string; breakingContext?: string; stowOnBreaking?: boolean;
}
export type PageTamingEvent = { kind: 'notice'; text: string } | { kind: 'bond'; value: string }
  | { kind: 'bonded'; actor: string } | { kind: 'breaking'; on: boolean };
/** Client presentation observes the common state machine and drains data effects;
 * no author callback is registered on the game host. */
export interface PageTamingOwner {
  readonly phase: 'wild' | 'breaking' | 'bonded'; readonly companion: Animal | null; readonly upgraded: boolean;
  readonly promptHorse: Animal | null; readonly view: TamingObservation;
  readonly interactable: { position: THREE.Vector3; radius: number; label: string; onInteract: () => void };
  update: (dt: number) => void; noteEvent: (name: string, x: number, z: number) => void; noteShot: (x: number, z: number) => void;
  startBreaking: () => void; forceBreak: () => void; setInput: (input: InputService | null) => void; drainEvents: () => PageTamingEvent[];
}
/** Follow authoritative taming observations and send input through the existing wire.
 * The server owns trust, breaking, adoption and the saved bond. */
export function createPageTaming(ctx: LevelContext, _player: Player, _animals: RowBodiesView, mount: Mount, rows: PageTamingRows, owners: PageRidingOwners): PageTamingOwner {
  const profile = v.parse(PageTamingBindingSchema, rows.binding);
  ridingHerds(owners, rows.herds);
  let input: InputService | null = ctx.app.input, offering = false, breaking = false;
  const read = (key: string): number => wirePage.line(`${RIDING_ROW}${key}`);
  const body = (key: string): Animal | null => {
    for (const [name, value] of wirePage.client?.owned ?? []) if (value > 0 && name.startsWith(`${RIDING_ROW}${key}:`)) return wirePage.namedBody(name.slice(RIDING_ROW.length + key.length + 1));
    return null;
  };
  const ear = new THREE.Vector3(), view: TamingObservation = { trust: null, alert: 0, ear: null, round: null, balance: 0, danger: false, offer: false };
  const start = (): void => { wirePage.client?.act({ kind: 'ride', seq: 0, action: 'mount' }); };
  const interactable = { position: new THREE.Vector3(0, -1e4, 0), radius: 0, label: profile.labels.mount, onInteract: start };
  return {
    get phase() { return read('phase') === 2 ? 'breaking' : read('phase') === 3 ? 'bonded' : 'wild'; },
    get companion() { return body('companion'); }, get promptHorse() { return body('stallion'); }, get upgraded() { return read('upgraded') === 1; },
    view, interactable,
    update: () => {
      const held = input?.held('ride.offer') === true;
      if (offering !== held && wirePage.client !== null) { offering = held; wirePage.send(held ? RIDING_ACT.offer : RIDING_ACT.release); }
      const nextBreaking = read('phase') === 2;
      if (nextBreaking !== breaking) {
        breaking = nextBreaking;
        if (rows.breakingContext !== undefined) { if (breaking) ctx.app.input.push(rows.breakingContext, ctx.scope); else ctx.app.input.pop(rows.breakingContext); }
        if (rows.stowOnBreaking === true && ctx.app.equipment !== null) ctx.app.equipment.stowed = breaking;
      }
      mount.breaking = breaking; mount.breakShake = read('shake'); mount.breakRoll = read('roll');
      view.trust = read('trust') > 0 ? read('trust') - 1 : null; view.alert = read('alert'); view.round = read('round') || null;
      view.balance = read('balance'); view.danger = read('danger') === 1; view.offer = read('offer') === 1;
      view.ear = read('ear.on') === 1 ? ear.set(read('ear.x'), read('ear.y'), read('ear.z')) : null;
      interactable.radius = read('radius'); interactable.position.set(read('prompt.x'), read('prompt.y'), read('prompt.z'));
      interactable.label = read('beaten') === 1 ? profile.labels.breaking : profile.labels.mount;
      const companion = body('companion'); if (companion !== null) companion.mem['whistle'] = 1;
    },
    noteEvent: () => undefined, noteShot: () => undefined, startBreaking: start, forceBreak: start,
    setInput: next => { input = next; }, drainEvents: () => [],
  };
}

/** Labels, the hitch point and the admitted guest are shard data. */
export interface RidingActionRows {
  herds: string; program: unknown; rail: { x: number; z: number }; tagRange: number; tagHeight: number;
  labels: { name: string; panic: string; thrown: string; bolt: string }; squeal: string;
}
export type RidingActionEvent = { kind: 'notice'; text: string } | { kind: 'name'; actor: string; current: string };
/** Prompt arbitration, riding events and HUD projection over concrete owners.
 * The author supplies no handler or selector; naming opens through a data event. */
export class RidingActions {
  readonly hud: RideHUD;
  readonly interactable: Interactable;
  private readonly nameIt: Interactable;
  private naming: Animal | null = null;
  private selected: Interactable | null = null;
  private decisionClock = 0;
  private events: RidingActionEvent[] = [];
  private readonly rules: ReturnProgram;
  private readonly herds: readonly HerdBrain<Animal>[];
  constructor(private readonly ctx: LevelContext, private readonly mount: Mount, private readonly taming: PageTamingOwner,
    private readonly player: Player, private readonly camera: THREE.PerspectiveCamera, private readonly animals: RowBodiesView, private readonly rows: RidingActionRows, owners: PageRidingOwners) {
    this.herds = ridingHerds(owners, rows.herds);
    this.rules = ReturnProgram.page(rows.program, ctx.scope);
    this.hud = new RideHUD(ctx, camera, { tagRange: rows.tagRange, tagHeight: rows.tagHeight });
    this.nameIt = { position: new THREE.Vector3(rows.rail.x, 0, rows.rail.z), radius: 0, label: rows.labels.name,
      onInteract: () => { const actor = this.naming; if (actor !== null) this.events.push({ kind: 'name', actor: actor.entityId, current: mount.nameOf(actor.entityId) ?? actor.label }); } };
    this.interactable = { position: new THREE.Vector3(0, -1e4, 0), radius: 0, label: '', onInteract: () => { this.selected?.onInteract(); } };
    ctx.on('creature.signal', ({ name, x, z }) => {
      taming.noteEvent(name, x, z);
      const actor = mount.horse; if (actor === null || (name !== 'rider-bitten' && name !== 'scare' && name !== 'lightning')) return;
      const result = this.rules.project('panic', { x, z, px: actor.position.x, pz: actor.position.z, bite: Number(name === 'rider-bitten'), practice: Number(practiceRoom.open) });
      const duration = result['duration'] ?? 0;
      if (duration > 0 && mount.panic(x, z, duration) && name !== 'rider-bitten') this.events.push({ kind: 'notice', text: actor.label + rows.labels.panic });
    });
  }
  /** Native mounted physics runs every frame; decisions keep their original guest. */
  advanceMount(dt: number, wet: boolean, blocked: boolean): void {
    const mount = this.mount, ahead = 2+mount.speed*.4; mount.wet = wet;
    mount.blockedAhead = blocked || arenaBoundaryBlocked(this.ctx.scope,mount.feet.x+Math.sin(mount.heading)*ahead,mount.feet.z+Math.cos(mount.heading)*ahead);
    mount.stampedes = new Set(this.herds.flatMap(herd => herd.stampeding ? herd.members.map(actor => actor.entityId) : herd.stallionState === 'charge' && herd.stallion !== null ? [herd.stallion.entityId] : []));
    mount.update(dt);
    for (const event of mount.drainEvents()) {
      if (event.kind === 'mount') {
        for (const herd of this.herds) { const actor = event.horse === null ? null : herd.members.find(member => member.entityId === event.horse) ?? null; if (actor !== null || herd.ridden !== null) herd.setRidden(actor); }
      } else if (event.kind === 'thrown') this.events.push({ kind: 'notice', text: this.rows.labels.thrown });
      else if (event.kind === 'bolt') this.events.push({ kind: 'notice', text: event.name + this.rows.labels.bolt });
      else { const actor = mount.horse ?? mount.mountables.find(row => row.a.entityId === event.horse)?.a; if (actor !== undefined) this.animals.onSound?.(this.rows.squeal, actor.position); }
    }
  }
  private nameUpdate(open: boolean): void {
    this.naming = null; this.nameIt.radius = 0;
    const mount = this.mount; if (mount.mounted || open) return;
    const pick = companionToName(mount.mountables, (signal, observations) => this.rules.project(signal, observations), this.rows.rail, this.player.position);
    if (pick === null) return;
    const actor = pick.actor, nearest = pick.row; this.naming = actor;
    const x = nearest['x'] ?? actor.position.x, z = nearest['z'] ?? actor.position.z;
    this.nameIt.position.set(x, terrainHeight(x, z) + 1.5, z); this.nameIt.radius = nearest['radius'] ?? 0;
    this.nameIt.label = `${this.rows.labels.name} ${mount.nameOf(actor.entityId) ?? actor.label}`;
  }
  /** Observe after the taming owner advances. Selection is presentation; the
   * guest's rail eligibility remains sampled no faster than ten times a second. */
  observe(dt: number, namingOpen: boolean): void {
    const m = this.mount;
    this.hud.update(this.taming.view, { mounted: m.mounted, breaking: m.breaking, steed: m.steed, winded: m.winded, gait: m.gait, leanLow: m.leanLow,
      beat: m.beat, spurFlash: m.spurFlash, spur: { latched: m.spur.latched, streak: m.spur.streak }, horse: m.horse?.entityId ?? null,
      mountables: m.mountables.map(row => ({ id: row.a.entityId, name: row.name, whistle: row.a.mem['whistle'] === 1, hidden: row.a.hidden, position: [row.a.position.x, row.a.position.y, row.a.position.z], scale: row.a.scale })) });
    this.decisionClock += dt; if (this.decisionClock + 1e-9 >= .1) { this.decisionClock = 0; this.nameUpdate(namingOpen); }
    let best: Interactable | null = null, distance = Infinity;
    const count = m.interactables.length;
    for (let i = 0; i <= count + 1; i++) {
      const it = i < count ? m.interactables[i] : i === count ? this.taming.interactable : this.nameIt;
      if (it === undefined || it.radius <= 0) continue;
      const d = it.position.distanceTo(this.camera.position); if (d < it.radius && d < distance) { distance = d; best = it; }
    }
    this.selected = best;
    if (best === null) { this.interactable.radius = 0; this.interactable.position.set(0, -1e4, 0); return; }
    this.interactable.position.copy(best.position); this.interactable.radius = best.radius; this.interactable.label = best.label;
    this.interactable.weak = m.mounted && best !== this.taming.interactable;
  }
  drainEvents(): RidingActionEvent[] { const events = this.events; this.events = []; return events; }
}

export interface PageRidingRows {
  profile: MountProfile; taming: PageTamingRows; actions: RidingActionRows;
  mountables: readonly { id: string; name: string }[]; mode: { id: 'ride'; hud: 'ride' }; controls?: RidingControls;
}
export type PageRidingEvent = PageTamingEvent | RidingActionEvent;
/** One client owner for mount, taming, HUD and prompts. Shard presentation drains
 * data events; gameplay services never receive a shard effect callback. */
export interface PageRidingSession {
  readonly mount: Mount; readonly taming: PageTamingOwner; readonly hud: RideHUD; readonly interactable: Interactable;
  readonly names: Record<string, string>; update: (dt: number, wet: boolean, blocked: boolean, namingOpen: boolean) => void;
  drainEvents: () => PageRidingEvent[];
}
const mountedOwners = new WeakMap<Scope, { readonly player: Player; readonly taming: PageTamingOwner }>();
/** Native practice rooms borrow the entered mount owner without author callbacks. */
export function pageRidingMount(ctx: LevelContext): Mount {
  const mount = enteredMount(ctx.scope);
  if (mount === undefined || ctx.scope.disposed) throw new Error('Missing entered riding session');
  return mount;
}
/** Restore the actual player and a native eligible companion at an arena exit. */
export function respawnPageMounted(ctx: LevelContext, position: THREE.Vector3, yaw: number, row: { readonly yaw: number; readonly steed: number }): void {
  const mount = pageRidingMount(ctx), owner = mountedOwners.get(ctx.scope);
  if (owner===undefined) throw new Error('Missing entered riding owner');
  const player = owner.player;
  if (mount.mounted) mount.dismount();
  player.position.copy(position); player.velocity.set(0,0,0); player.yaw = yaw; player.pitch = 0;
  const companion = owner.taming.companion;
  const candidates = [...(companion===null ? [] : [companion]),...mount.mountables.map(entry => entry.a)];
  for (const actor of candidates) {
    if (!mount.canRide(actor)) continue;
    actor.place(position.x,position.z,yaw+row.yaw);
    if (mount.mount(actor)) { mount.teleport(position.x,position.z,yaw+row.yaw); mount.steed = row.steed; mount.winded = false; return; }
  }
}
export function createPageRiding(ctx: LevelContext, player: Player, animals: RowBodiesView, camera: THREE.PerspectiveCamera, rows: PageRidingRows, owners: PageRidingOwners): PageRidingSession {
  ridingHerds(owners, rows.taming.herds); ridingHerds(owners, rows.actions.herds);
  const controls=rows.controls===undefined?undefined:v.parse(RidingControlsSchema,rows.controls);
  if(controls!==undefined && rows.taming.breakingContext!==undefined && controls.breaking!==rows.taming.breakingContext)throw new Error('Riding breaking context mismatch');
  const mount = new Mount(ctx, player, animals, rows.profile);
  for (const entry of rows.mountables) mount.addMountable(entry.id, entry.name);
  playerModes(player).register(rows.mode, ctx.scope);
  const taming = createPageTaming(ctx, player, animals, mount, controls===undefined?rows.taming:{...rows.taming,breakingContext:controls.breaking}, owners);
  const owner = { player,taming }; mountedOwners.set(ctx.scope,owner);
  ctx.scope.onDispose(() => { if (mountedOwners.get(ctx.scope)===owner) mountedOwners.delete(ctx.scope); });
  const actions = new RidingActions(ctx, mount, taming, player, camera, animals, rows.actions, owners);
  if (controls !== undefined) bindRidingControls(ctx,mount,taming,actions.hud,controls);
  return { mount, taming, hud: actions.hud, interactable: actions.interactable, names: rows.profile.names,
    update: (dt, wet, blocked, namingOpen) => { actions.advanceMount(dt, wet, blocked); taming.update(dt); actions.observe(dt, namingOpen); },
    drainEvents: () => [...taming.drainEvents(), ...actions.drainEvents()] };
}

/** Client-only native action routing over the entered mount and HUD. */
function bindRidingControls(ctx: LevelContext, mount: Mount, taming: PageTamingOwner, hud: RideHUD, rows: RidingControls): void {
  const input=ctx.app.input, keys=rows.keys;
  // the page's input contexts are one per id: a retained (grid) runtime defines and pushes its own only while entered
  installEnteredLevelService(ctx,scope=>{
  ctx.inputContext({id:rows.foot,actions:['ride.whistle','ride.offer'],keys:{'ride.whistle':keys['ride.whistle'],'ride.offer':keys['ride.offer']},touch:{relabel:{},verbs:hud.inputVerbs()}});
  ctx.inputContext({id:rows.mounted,actions:['move.forward','move.back','move.left','move.right','ride.gallop','ride.horseTab','use'],
    keys:{'move.forward':keys['move.forward'],'move.back':keys['move.back'],'move.left':keys['move.left'],'move.right':keys['move.right'],'ride.gallop':keys['ride.gallop']},
    touch:{relabel:{'edge-l':{label:rows.dismount,tone:'ready'}},verbs:hud.inputVerbs(true)}});
  ctx.inputContext({id:rows.breaking,actions:['lean.left','lean.right'],blocks:['attack','aim','swap','ride.whistle','ride.offer','ride.horseTab'],keys:{'lean.left':keys['lean.left'],'lean.right':keys['lean.right']}});
  for(const [lean,move] of [['lean.left','move.left'],['lean.right','move.right']] as const){
    const saved=input.bindings.keys(rows.movement)[move];
    if(saved!==undefined && saved.join('\0')!==input.bindings.keys(rows.breaking)[lean]?.join('\0'))input.bindings.assign(rows.breaking,lean,saved);
  }
  input.bindings.describe({rows:rows.describe??[]},scope);input.push(rows.foot,scope);
  });
  mount.input=input;taming.setInput(input);
  let mounted=mount.mounted;
  ctx.system({id:'game.riding.input',phase:'input',before:['engine.player.input'],run:()=>{
    if(mounted!==mount.mounted){mounted=mount.mounted;if(mounted)input.push(rows.mounted,ctx.scope);else{input.pop(rows.breaking);input.pop(rows.mounted);if(ctx.app.equipment!==null)ctx.app.equipment.stowed=false;}}
    if(input.consume('ride.whistle'))wirePage.send(RIDING_ACT.whistle);
    if(input.consume('ride.gallop'))mount.gallopTap();
    if(input.consume('ride.horseTab')&&!mount.breaking)mount.dismount();
  }});
  ctx.scope.onDispose(()=>{mount.dismount();mount.input=null;taming.setInput(null);});
}

/** The existing mount, taming and pasture authorities with their client views. */
export interface PageRidingView {
  readonly mount: Mount; readonly taming: PageTamingOwner; readonly hud: RideHUD; readonly interactable: Interactable;
  readonly mounted: boolean; readonly reins: MountedReins;
  update: (dt: number) => void; late: (dt: number) => void; noteShot: (x: number, z: number) => void;
}
interface ClientRidingOwner extends WorldFrameOwner { readonly id: string | undefined; readonly rows: v.InferOutput<typeof ClientRidingSessionSchema>; view: PageRidingView | null }
const clientSessions = new WeakMap<Scope, ClientRidingOwner>();
/** Admit the client session before world wiring; body and equipment authorities
 * arrive through their native stages, never through authored callbacks. */
export async function installClientRiding(ctx: ShardContext, feature: ClientFeatureRow): Promise<void> {
  const scope = ctx.scope, product = ctx.product;
  if (feature.kind !== 'riding.session' || scope.disposed || scope.disposing || clientSessions.has(scope)) throw new Error('Invalid riding feature owner');
  const active = (): void => { if (scope.disposed || scope.disposing || ctx.scope !== scope || ctx.product !== product) throw new Error('Riding owner left during admission'); };
  const read = product.json;
  const available = (): void => { active(); if (product.json !== read || clientSessions.has(scope) || (feature.owner !== undefined && presentEntryOwner(scope, 'world-frame', feature.owner) !== null)) throw new Error('Riding admission owner changed or already published'); };
  available();
  const rows = v.parse(ClientRidingSessionSchema, await read.call(product, feature.file));
  available();
  ReturnProgram.prepareMemory(rows.programs.approach, scope);
  available();
  const owner: ClientRidingOwner = { id: feature.owner, rows, view: null,
    update(dt) { active(); if (clientSessions.get(scope) !== owner) throw new Error('Riding frame owner changed'); owner.view?.update(dt); },
    late(dt) { active(); if (clientSessions.get(scope) !== owner) throw new Error('Riding frame owner changed'); owner.view?.late(dt); },
  };
  clientSessions.set(scope, owner);
  if (feature.owner !== undefined) publishEntryOwner(scope, 'world-frame', feature.owner, owner);
  scope.onDispose(() => { clientSessions.delete(scope); });
}
/** Enter after native animals and equipment exist. The plan supplies all labels,
 * guest rows and resource ids; the page resolves its own concrete authorities. */
export function enterClientRiding(ctx: ShardContext, arsenal: HeldClaims): PageRidingView {
  const owner = clientSessions.get(ctx.scope), runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (owner === undefined || ctx.scope.disposed || runtime === undefined || world === undefined || world === null || play === undefined || play === null) throw new Error('Riding feature is not ready');
  if (owner.view !== null || owner.id !== undefined && (presentEntryOwner(ctx.scope, 'riding-view', owner.id) !== null || presentEntryOwner(ctx.scope, 'riding-play', owner.id) !== null)) throw new Error('Riding feature is already entered');
  const population = ridingPopulation(ctx.scope); if (population === null) throw new Error('Riding requires built wildlife');
  const { rows } = owner, persistence = enteredAdventurePersistence(ctx.scope), kit = arsenal.pageKit(ctx);
  if (kit === null) throw new Error('Riding requires its built equipment owner');
  const names = persistence.names.read(), preset = rows.preset;
  const owners = { id: preset.taming.herds, herds: population.herds, wind: population.wind };
  const session = createPageRiding(ctx, world.player, play.animals, world.game.camera, {
    profile: { ...rows.profile, names, roads: rows.roads, restAt: rows.rest }, mode: preset.mode, ...(preset.controls === undefined ? {} : { controls: preset.controls }),
    taming: { ...preset.taming, programs: rows.programs, binding: rows.taming.binding, savedBond: persistence.bond.read(), rest: rows.rest },
    actions: { ...preset.actions, program: rows.programs.riding, rail: rows.taming.rail },
    mountables: population.mountables.map(actor => ({ id: actor.entityId, name: preset.mountableLabel })),
  }, owners);
  const { mount, taming, hud, interactable } = session, reins = new MountedReins(world.game.camera, rows.programs.reins, ctx.scope);
  const namer = new DataPanel(rows.naming.panel), nameValues = { current: '' };
  let namingActor: string | null = null;
  const actions = new Map<string, (value: unknown) => void>([[rows.naming.action, value => {
    if (typeof value !== 'string') throw new Error('Mount name input requires text');
    const name = cleanMountName(value, rows.naming.maximum);
    if (name.length > 0 && namingActor !== null) { mount.rename(namingActor, name); persistence.names.write(names); play.hud.toast(rows.naming.notice + name); }
  }]]);
  ctx.scope.onDispose(() => { namer.close(); });
  const weaponMount = { speed: 0, yaw: 0 };
  const view: PageRidingView = {
    mount, taming, hud, interactable, reins, get mounted() { return mount.mounted; },
    noteShot: (x, z) => { taming.noteShot(x, z); },
    update: dt => {
      session.update(dt, population.wetAt(mount.feet.x, mount.feet.z), false, namer.isOpen); population.rider(mount.mounted);
      for (const event of session.drainEvents()) {
        if (event.kind === 'notice') play.hud.toast(event.text);
        else if (event.kind === 'bond') persistence.bond.write(event.value);
        else if (event.kind === 'bonded') persistence.feat(rows.naming.bondedFeat);
        else if (event.kind === 'name') { namingActor = event.actor; nameValues.current = event.current; namer.open(nameValues, actions); }
      }
    },
    late: dt => {
      weaponMount.speed = mount.speed; weaponMount.yaw = mount.heading - Math.PI; kit.setMount(mount.mounted ? weaponMount : null);
      if (mount.gallopFloat) kit.bow('bow').extraSpreadDeg *= .5;
      const bow = kit.bow('bow'), drawing = ctx.app.equipment?.current === bow && (bow.adsHeld || bow.drawing);
      reins.update(dt, mount.horse, mount.mounted, mount.breaking || drawing);
    },
  };
  ctx.on('player.died', () => { if (mount.mounted) mount.dismount(); });
  ctx.on('player.respawned', () => { kit.refill(); });
  owner.view = view;
  if (owner.id !== undefined) {
    publishEntryOwner(ctx.scope, 'riding-view', owner.id, view);
    publishEntryOwner(ctx.scope, 'riding-play', owner.id, view);
  }
  return view;
}

/** Native arena/riding refusal; storage and its numeric law live in CellField. */

/** Pure spatial refusal against a declared ring and an admitted field. Rule
 * enablement comes from the encounter's last bounded decision. */
export function arenaBlockedAt(field: CellField, point: { readonly x: number; readonly z: number },
  boundary: { readonly x: number; readonly z: number; readonly radius: number }, mask: number): boolean {
  return ((mask & 1) !== 0 && Math.hypot(point.x - boundary.x, point.z - boundary.z) > boundary.radius)
    || ((mask & 2) !== 0 && field.activeAt(point.x, point.z));
}

/** A real entered field and the latest AS refusal mask, lent as numeric data. */
export interface ArenaBoundary { readonly field: CellField; readonly boundary: { readonly x: number; readonly z: number; readonly radius: number }; mask: number }
const boundaries = new WeakMap<Scope, Set<ArenaBoundary>>();
/** Riding borrows fields directly; no author refusal callback is installed. */
export function installArenaBoundary(scope: Scope, boundary: ArenaBoundary): void {
  if (scope.disposed || typeof boundary.field.activeAt !== 'function' || !Object.values(boundary.boundary).every(Number.isFinite)) throw new Error('Invalid native arena boundary');
  const rows = boundaries.get(scope) ?? new Set<ArenaBoundary>();
  if (rows.has(boundary) || rows.size>=8) throw new Error('Duplicate or excessive arena boundary');
  rows.add(boundary); boundaries.set(scope,rows); scope.onDispose(() => { rows.delete(boundary); });
}
/** Sample each entered field at the riding owner's actual look-ahead point. */
export function arenaBoundaryBlocked(scope: Scope, x: number, z: number): boolean {
  for (const row of boundaries.get(scope) ?? []) if (arenaBlockedAt(row.field,{ x,z },row.boundary,row.mask)) return true;
  return false;
}
