import { NativeEliteController } from '@wildshard/engine/ai/view/eliteController';
import { BorrowedElite, type DeclaredEliteEntry, type EliteEntryLoans } from '@wildshard/engine/ai/view/eliteEntry';
import { ObservationColumnsV2, type V2EnvironmentColumns } from '@wildshard/engine/script/observationColumnsV2';
import { parseEliteEntryPageRows } from '@wildshard/format/eliteEntryRows';
import type { ReturnProgram } from '../../shared/game/population/returnProgram';
import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import type { PouncerLedge } from '@wildshard/engine/ai/stalker';
import type { PatrolEncounterView } from './boss/encounterView';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { PackBrain } from '@wildshard/engine/ai/pack';
import type { AdventurePersistence } from '../../shared/game/quest/persistence';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Game } from '@wildshard/engine/core/Game';
import type { Player } from '@wildshard/engine/player/Player';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import { canReach } from '@wildshard/engine/ai/reach';
import { strikeFromData, type StrikeData } from '@wildshard/engine/ai/strikeRows';
import { app } from '@wildshard/engine/app/runtime';
import { eliteViewSource, eliteViewTell, parseEliteOutputActions, parseEliteOutputBank, type EliteEnteredPresentation, type EliteOutputAction, type EliteOutput } from '@wildshard/format/eliteFeature';
import { wirePage } from './shardfile/wirePage';
import { ELITE_MOMENTS, eliteCueWord, eliteGroundWord, eliteLaneWord, eliteMomentWord, eliteWindWord } from '@wildshard/engine/sim/shardRows';
import { EliteRowBar, type BossRowDrop } from './boss/barFeed';
import { lendViewTell, lendViewValues } from './shardfile/clientViewProgram';
import { Scope } from '@wildshard/engine/app/scope';
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { HUD } from '@wildshard/engine/ui/HUD';
import { elitesSave } from '../../shared/game/saves';
import * as THREE from 'three';
import { resourceScope } from '@wildshard/engine/app/resources';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { EliteBar } from '@wildshard/engine/ui/EliteBar';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { EliteCore, type EliteCoreEntry, type EliteCoreRule, type EliteCoreScript } from '../../shared/game/eliteSystem';
import { EliteView, GroundTell, type EliteEnteredOwners, type EliteViewEntered } from './eliteView';

/**
 * Elite — the engine's NAMED ELITE system (docs/design/nalati/elites-and-bosses.md §1; plan NALATI.md row B12). "Elites
 * live in the world, bosses own the screen." This is the generic half every shard reuses — each elite's own AI is an
 * `EliteScript` (Nalati's five: src/shards/nalati-grasslands/combat/elites.ts).
 *
 *   const elites = new Elites(host, bar);            // bar = new EliteBar() (src/client/engine/ui/EliteBar.ts)
 *   elites.add(script);                              // one per elite: its EliteDef + its brain
 *   game.onUpdate((dt, t) => elites.update(dt, t));
 *
 * What the system does for every elite:
 *   · PLACEMENT + SPAWN RULE — placed at its lair, only while its rule holds ('always' | 'dusk' | 'night' | 'storm',
 *     `host.condition(rule)`), one alive at a time; a dusk / night / storm elite leaves when its rule ends (unengaged).
 *   · AWARE → ENGAGED → LEASH — aware inside `awareR` (the named bar shows OVER ITS HEAD), engaged inside `engageR` or
 *     on a hit (the bar PINS top-centre — the user's rule), and past `leashR` from the lair it disengages, walks home
 *     (`script.leash`) and regenerates to full.
 *   · PHASE 2 AT 50 % — a 1 s invulnerable beat, "ENRAGED" (or the def's caption) under the bar, `script.enterPhase2()`.
 *   · THE BANNER — "NAMED ELITE NEARBY · name · epithet", once per approach (first aware inside 80 m, or entering the
 *     lair); re-armed after 60 s beyond the leash.
 *   · DEATH → DROP + TIMER — the first kill drops the cosmetic skin in the purple orb (`WeaponPickup` tier 'rare') + the
 *     trophy; later kills the trophy only. The kill itself goes through the AnimalManager (kill feed, Progress →
 *     the achievement + joke title). The lair then sleeps `respawnMin` minutes of PLAY time (persisted, 'ws.elites.v1');
 *     a dusk / night elite comes back at the next dusk after that. A `once` elite (Argymaq) never comes back.
 *   · THE SKULL — a gold skull on the minimap at a discovered lair (you came within 60 m, or it saw you): pulsing while
 *     engaged, grey with a countdown ring while dead (`EliteBar.skulls`).
 *   · TELLS — `GroundTell`: a pooled, terrain-draped ring / lane decal (one FX program) for the signature move's tell.
 */

export type EliteRule = EliteCoreRule;

export interface EliteDef {
  id: string;
  /** "Aqbars the Pale" / "Irbis of the Crags" */
  name: string;
  epithet: string;
  lair: { x: number; z: number; r: number };
  awareR: number; engageR: number; leashR: number;
  rule: EliteRule;
  /** minutes of play before the lair wakes again */
  respawnMin: number;
  /** a one-time elite (Argymaq: once tamed, the lair retires) */
  once?: boolean;
  /** the signature move's name — flashes under the bar the first time you see it */
  signature: string;
  /** the phase-2 caption ("ENRAGED") */
  phase2: string;
  /** the first-kill drop (cosmetic) and the trophy every kill leaves. `skin: null` — no skin, the prize is something
   *  else (Argymaq: the horse himself, E314 C); no `trophyName` — no trophy (Nalati: no pack, E314 C) */
  drop: { skin: string | null; skinName: string; weapon: string; blurb: string; trophyName?: string };
}

/** One elite's brain on the page: the rules' script (eliteSystem.ts `EliteCoreScript`) over an Animal, plus its bar and drop. */
export interface EliteScript extends EliteCoreScript<Animal> {
  readonly def: EliteDef;
  /** the bar's fill 0..1 (default hp / maxHp) — Argymaq's reads 0 at BROKEN */
  barFrac?: () => number;
  /** the drop orb's display model */
  dropModel: () => THREE.Object3D;
}

export interface EliteHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer?: Renderer;
  player: { position: THREE.Vector3 };
  condition: (rule: EliteRule) => boolean;
  addInteractable: (it: Interactable) => void;
  removeInteractable: (it: Interactable) => void;
  toast: (text: string) => void;
  /** the "named elite nearby" sting / the phase roar / the kill (music + audio) */
  sting?: (event: 'banner' | 'phase2' | 'kill') => void;
  pickupHum?: (inside: boolean) => void;
  /** a first-kill skin was taken: own it (B15 wears it) */
  ownSkin?: (skin: string) => void;
  /** does the eye see the elite's head (no wall / rock / ground between)? The name over its head hides while it does not
   *  (a cabin wall between you and it); absent = always seen */
  canSee?: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
}

/** A lair a page draws off its row: its card, its orb and its trophy line. Its body and clock are the server's, so nothing else of it moves. */
export function rowEliteScript(def: EliteDef, trophy: () => void, dropModel: () => THREE.Object3D): EliteScript {
  const still = (): void => undefined;
  return { def, animal: null, trophy, dropModel, spawn: still, despawn: still, tick: still, enterPhase2: still, reset: still };
}

/** A tell for the page session that binds elites, which reaches the view half through this file alone. */
export function eliteGroundTell(scene: THREE.Scene, kind: 'ring' | 'lane', color: THREE.ColorRepresentation): GroundTell { return new GroundTell(scene, kind, color); }
type PresentationCallbacks = 'addInteractable' | 'removeInteractable' | 'toast' | 'sting' | 'pickupHum';
type PageEliteHost = Omit<EliteHost, PresentationCallbacks> & Partial<Pick<EliteHost, PresentationCallbacks>>;
type Entry = EliteCoreEntry<EliteScript>;
interface PreparedEliteOutputs { readonly validate: () => void; readonly operations: readonly (() => void)[] }
type EliteOutputPrepare = (bank: readonly EliteOutput[], actors: readonly (Animal | null)[]) => PreparedEliteOutputs;

/** Optional typed persistence for runtime-bound lairs; the default remains the legacy shard slot. */
interface ElitePersistence {
  read: (slug: string) => ReturnType<typeof elitesSave.read>;
  write: (value: ReturnType<typeof elitesSave.read>, slug: string) => void;
}

/** The named elite system on the page: the renderer-free rules (eliteSystem.ts `EliteCore`) plus the bar, banner, orb and skulls. */
export class Elites {
  private readonly scope = resourceScope().child('Elites');
  private readonly core: EliteCore<EliteScript>;
  private entered: (EliteViewEntered & { readonly outputs?: EliteOutputPrepare; readonly actions?: readonly EliteOutputAction[]; readonly validateOutputs?: () => void; readonly drainOutputs?: () => void }) | null = null;
  private readonly view: EliteView;
  private rowBar: EliteRowBar | null = null;
  /** the elite whose bar is up (nearest aware / engaged) */
  get focus(): Entry | null { return this.view.focus; }

  constructor(private readonly host: PageEliteHost, private readonly bar: EliteBar, slug: string, private readonly persistence: ElitePersistence = elitesSave) {
    this.view = new EliteView(host, bar, this.scope, () => this.entered, id => this.core.record(id), () => { this.core.save(); });
    this.core = new EliteCore<EliteScript>(host, this.view.hooks, slug, persistence);
  }

  get entries(): readonly Entry[] { return this.core.entries; }
  add(script: EliteScript): void {
    if (this.entered !== null) throw new Error('Elite presentation identities are already bound');
    this.core.add(script);
  }
  /** Resolve only original typed authorities for an admitted engine entry.
   * Controller selection, condition cadence and lifecycle ordering live in the
   * engine; this owner retains presentation, native effects and persistence. */
  bindDeclaredEntry(entry: DeclaredEliteEntry, input: unknown,
    owners: EliteDeclaredEntryOwners): void {
    const rows = parseEliteEntryPageRows(input), { construction, entered, game, player, animals, models, program } = owners;
    if (this.entered !== null || entered.scope.disposed || entered.scope.disposing || construction.disposed || construction.disposing
      || game.levelScope !== construction || this.host.player !== player || this.host.scene !== game.scene || this.host.camera !== game.camera
      || this.persistence !== owners.persistence.elites || JSON.stringify(rows.entry) !== JSON.stringify(entry.rows) || !this.scope.belongsTo(entered.scope)
      || Object.keys(rows.presentation).length !== rows.entry.entries.length || rows.entry.entries.some(row => !Object.hasOwn(rows.presentation, row.id))) throw new Error('Foreign declared elite entry owner');
    const contacts=owners.contacts??new StrikeRunner();
    preflightEliteEffectServices(rows.actions, { game, player, animals, environment: owners.environment, hud: entered.hud, audio: entered.audio,
      persistence: owners.persistence, contacts, patrol: owners.patrol, wildlife: owners.wildlife });
    const selected = owners.controllers === undefined ? rows.borrowed.map(row => {
      const model = models.get(row.def.id);
      if (model === undefined) throw new Error('Missing declared borrowed elite model');
      return { row, model };
    }) : [];
    const controllers = owners.controllers ?? selected.map(({ row, model }) => new BorrowedElite(row,
      { game, player, elites: this }, program.value, model, true));
    if (controllers.length !== rows.borrowed.length || controllers.some((controller, index) => !(controller instanceof BorrowedElite)
      || controller.def.id !== rows.borrowed[index]?.def.id) || new Set(controllers).size !== controllers.length) throw new Error('Foreign declared borrowed elite controller');
    const emptyActors = new Map<number, Animal>();
    const observations = rows.observations.map(row => ({ id: row.id, columns: new ObservationColumnsV2(row.rows, entered.scope), owners: {
      scope: entered.scope, self: { group: rows.entry.id, slot: 0, identity: '', actor: null }, player, observed: emptyActors, t: 0, dt: 0,
      environment: owners.environment, clock: owners.clock, weather: owners.weather } }));
    const loans: EliteEntryLoans<BorrowedElite> = { construction, entered: entered.scope, ui: { id: rows.entry.ui,
      services: { game, player, lifecycle: this, bar: this.bar, ledges: owners.ledges, rock: owners.rock } },
      profiles: rows.profiles, bodies: rows.entry.entries.some(row => row.controller.kind !== 'borrowed') ? [{ id: owners.body, manager: animals }] : [], models: [...new Set(rows.entry.entries.flatMap(row => row.controller.kind === 'borrowed' ? [] : [row.controller.model]))].map(id => { const object = models.get(id); if (object === undefined) throw new Error('Missing elite model loan'); return { id, object }; }), observations,
      programs: [{ id: program.id, owner: program.scope, program: program.value }], controllers: controllers.map(controller => ({ id: controller.def.id, controller })), actions: rows.actions };
    if (this.host.renderer !== undefined && this.host.renderer !== game.renderer) throw new Error('Foreign elite presentation renderer');
    this.host.renderer = game.renderer;
    entry.bind(loans, this, app.encounters);
    // the lane tells, and the values they are drawn from, for the entered view programs (format/eliteFeature ELITE_VIEW_FIELDS)
    for (const controller of controllers) {
      lendViewTell(entered.scope, eliteViewTell(controller.def.id), controller.tell); lendViewValues(entered.scope, eliteViewSource(controller.def.id), controller.viewValue);
    }
    const outputs: ElitePageOutputLoans = { construction, entered: entered.scope, game,
      controllers: entry.scripts.map(owner => owner instanceof NativeEliteController ? { kind: 'keeper', owner } : { kind: 'external', owner }),
      patrol: owners.patrol, wildlife: owners.wildlife, animals, environment: owners.environment, player,
      hud: entered.hud, audio: entered.audio, persistence: owners.persistence, contacts,
      strikes: rows.strikes, fallbackStrike: rows.fallbackStrike };
    this.bindEnteredPresentation(entered, rows.presentation, { actions: rows.actions, loans: outputs });
    this.followKernels(entered.scope, entered, player);
    if (rows.debug !== undefined) construction.onDispose(app.debug.scopedExpose(rows.debug, { scripts: entry.scripts, elites: this, bar: this.bar }));
    for (const row of rows.prewarm) { try { animals.factory.model(row.kind, row.variant); } catch (cause) { console.warn('[elites] prewarm failed', row.kind, cause); } }
  }
  /** Bind after registering every lair and before initialization. The entered scope owns this exact Elites instance. */
  bindEnteredPresentation(owners: EliteEnteredOwners, rows: EliteEnteredPresentation,
    outputs?: { readonly actions: readonly EliteOutputAction[]; readonly loans: ElitePageOutputLoans }): void {
    if (this.entered !== null || owners.scope.disposed || !this.scope.belongsTo(owners.scope)) throw new Error('Invalid entered elite presentation owner');
    const ids = this.entries.map(entry => entry.script.def.id), keys = Object.keys(rows);
    if (keys.length !== ids.length || ids.some(id => !Object.hasOwn(rows, id))) throw new Error('Invalid entered elite presentation identities');
    if (outputs === undefined) { this.entered = { owners, rows }; return; }
    const loans = outputs.loans, actions = parseEliteOutputActions(outputs.actions, loans.controllers.length);
    const identity = (): void => {
      if (loans.entered !== owners.scope || loans.player !== this.host.player || loans.game.scene !== this.host.scene || loans.game.camera !== this.host.camera
        || loans.hud !== owners.hud || loans.audio !== owners.audio || loans.persistence.elites !== this.persistence
        || loans.controllers.length !== this.entries.length || loans.controllers.some((controller, index) => this.entries[index]?.script !== controller.owner)) throw new Error('Foreign elite output binding');
    };
    identity();
    for (const action of actions) {
      if (action.kind === 'wildlife-pack') Object.freeze(action.variants);
      else if (action.kind === 'wildlife-herd') Object.freeze(action.offset);
      Object.freeze(action);
    }
    Object.freeze(actions);
    const initial = prepareElitePageOutputs(actions, [], loans, []);
    const validate = (): void => { if (this.entered?.actions !== actions) throw new Error('Replaced elite output binding'); identity(); initial.validateOwners(); };
    const prepare: EliteOutputPrepare = (bank, actors) => {
      validate();
      const prepared = prepareElitePageOutputs(actions, bank.map(row => ({ action: row.id, values: row.values })), loans, actors);
      return { validate: () => { validate(); prepared.validate(); }, operations: prepared.operations.map(apply => () => { validate(); apply(); }) };
    };
    this.entered = { owners, rows, outputs: prepare, actions, validateOutputs: validate, drainOutputs: () => { validate(); drainElitePageOutputs(this, actions, loans); } };
  }
  /** Page-only output preparation borrows the SAME entered controllers and
   * persistence. Actor slots are transient original emitted pointers, never a
   * controller lookup, an additional body book or a serialized outbox. */
  get v2OutputActions(): readonly EliteOutputAction[] {
    const entered = this.entered;
    if (entered?.actions === undefined || entered.validateOutputs === undefined) throw new Error('Missing live elite output binding');
    entered.validateOutputs();
    return entered.actions;
  }
  prepareV2Outputs(bank: readonly EliteOutput[], actors: readonly (Animal | null)[]): PreparedEliteOutputs {
    const entered = this.entered;
    if (entered?.outputs === undefined || entered.owners.scope.disposed || entered.owners.scope.disposing) throw new Error('Missing live elite output binding');
    return entered.outputs(bank, actors);
  }
  /** Drain at the original page post-update slot, never at native stage commit.
   * Every native/page transaction validates before the first operation applies. */
  drainEnteredOutputs(): void {
    const entered = this.entered;
    if (entered?.drainOutputs === undefined) throw new Error('Missing live elite output binding');
    entered.drainOutputs();
  }
  /** A page on a server steps no lair. A native kernel says its ground ring and its moments, and they land here as a page's own do. */
  private followKernels(scope: Scope, { hud, audio }: Pick<EliteEnteredOwners, 'hud' | 'audio'>, player: Pick<Player, 'position' | 'yaw'>): void {
    const point = new THREE.Vector3(), target = new THREE.Vector3(), grounds = new Map<string, NativeEliteController>(), moments = new Map<string, NativeEliteController>(), winds = new Map<string, NativeEliteController>();
    const lanes = new Map<string, BorrowedElite>(), cues = new Map<string, BorrowedElite>();
    for (const { script } of this.entries) {
      if (script instanceof NativeEliteController) { grounds.set(eliteGroundWord(script.def.id), script); moments.set(eliteMomentWord(script.def.id), script); winds.set(eliteWindWord(script.def.id), script); }
      else if (script instanceof BorrowedElite) { lanes.set(eliteLaneWord(script.def.id), script); cues.set(eliteCueWord(script.def.id), script); }
    }
    wirePage.whenLive(scope, client => client.onView(({ name, args }) => {
      const aim = winds.get(name)?.aim;
      if (aim !== undefined) {
        const [x, y, z, toX = 0, toY = 0, toZ = 0, alpha = 0, t = 0] = args;
        if (x === undefined || y === undefined || z === undefined) { aim.hide(); return; }
        aim.show(point.set(x, y, z), target.set(toX, toY, toZ), alpha, t); wirePage.drew('elite wind'); return;
      }
      const lane = lanes.get(name)?.tell, cueRow = cues.get(name)?.row;
      if (lane !== undefined) {
        const [x0, z0, x1 = 0, z1 = 0, width = 0, alpha = 0, t = 0] = args;
        if (x0 === undefined || z0 === undefined) { lane.hide(); return; }
        lane.setTime(t); lane.lane(x0, z0, x1, z1, width, alpha); wirePage.drew('elite lane'); return;
      }
      if (cueRow !== undefined) {
        const [index = -1, x = 0, y = 0, z = 0] = args, cue = cueRow.cues[Object.keys(cueRow.cues)[index] ?? ''];
        if (cue?.feed !== undefined) hud.killFeed(cue.feed);
        if (cue?.voice !== undefined) audio.animal(cue.voice, point.set(x, y, z), player.position, player.yaw);
        wirePage.drew('elite cue'); return;
      }
      const tell = grounds.get(name)?.tell, row = moments.get(name)?.row;
      if (tell !== undefined) {
        const [x, z, radius = 0, alpha = 0, t = 0] = args;
        if (x === undefined || z === undefined) { tell.hide(); return; }
        tell.setTime(t); tell.ring(x, z, radius, alpha); wirePage.drew('elite ground');
      } else if (row !== undefined) {
        const [index = -1, x = 0, y = 0, z = 0] = args, moment = ELITE_MOMENTS[index]; if (moment === undefined) return;
        const line = row.messages[moment], voice = row.voices[moment];
        if (line !== undefined) hud.killFeed(line);
        if (voice !== undefined) audio.animal(voice, point.set(x, y, z), player.position, player.yaw);
        wirePage.drew('elite moment');
      }
    }));
  }
  /** A lair's body is its row's: a page never wakes one, and the server materializes what's eligible. */
  initialize(): void { /* no lair of a page's own */ }
  entry(id: string): Entry | undefined { return this.core.entry(id); }
  owned(id: string): boolean { return this.core.owned(id); }
  /** the script says this elite moved its signature move now: flash its name the first time */
  signature(id: string): void { this.core.signature(id); }
  /** a once elite won for good (Argymaq tamed): the trophy + the "skin" (the horse is the reward), the lair retires */
  won(id: string): void { this.core.won(id); }

  /** A herd lair's leader wears its colour on the row's body as on the page's. */
  private readonly tinted = new WeakSet<Animal>();
  private tintRows(): void {
    for (const row of wirePage.encounters()) {
      const script = this.core.entry(row.id)?.script, body = wirePage.rowBody(row.body);
      if (script instanceof BorrowedElite && body !== null && !this.tinted.has(body)) { this.tinted.add(body); script.tint(body); }
    }
  }
  /** A first kill's orb, as a lair's row lays it out. */
  private rowDrop(id: string, pressed: () => void): BossRowDrop {
    const entry = this.core.entry(id);
    if (entry === undefined) throw new Error('Missing elite entry for its row');
    return { show: at => { this.view.showRowDrop(entry, at, () => { pressed(); wirePage.send(`${id}.reward`); }); }, hide: taken => { this.view.hideRowDrop(entry, taken); } };
  }

  update(dt: number, t: number): void {
    // J130: a bar has one driver. On the wire the rows draw it and this page's lairs never wake.
    this.rowBar ??= new EliteRowBar(this.bar, this.core.entries.map(entry => entry.script.def), { player: this.host.player, camera: this.host.camera, head: wirePage.head, drop: (id, pressed) => this.rowDrop(id, pressed),
      sting: (id, event) => { const entry = this.core.entry(id); if (entry !== undefined) this.view.sting(entry, event); }, trophy: id => { this.core.entry(id)?.script.trophy(); } }); this.rowBar.draw(wirePage.encounters(), dt); this.view.tendDrops(dt, t); this.tintRows();
  }
}

/** Compiled native admission produces these tags beside the real controller;
 * authored action rows cannot construct or reclassify a controller loan. */
export type EliteOutputController = { readonly kind: 'keeper'; readonly owner: NativeEliteController }
  | { readonly kind: 'external'; readonly owner: BorrowedElite };
/** Compiled loans for the existing page owner; no authored factory, callback
 * map or opaque shard object is admitted. Construction and entered may be siblings. */
/** The population an elite's outputs ask for bodies. */
export interface EliteWildlife {
  spawnPack: (x: number, z: number, variants: readonly string[]) => PackBrain<Animal>;
  spawnHerd: (x: number, z: number, mares: number, foals: number, stallion: boolean) => HerdBrain<Animal>;
}
export interface EliteDeclaredEntryOwners {
  readonly construction: Scope; readonly entered: EliteEnteredOwners;
  readonly game: Game; readonly player: Player; readonly body: string; readonly animals: RowBodiesView;
  readonly models: ReadonlyMap<string, THREE.Object3D>;
  readonly program: { readonly id: string; readonly scope: Scope; readonly value: ReturnProgram };
  readonly controllers?: readonly BorrowedElite[];
  readonly environment: EliteAir;
  readonly clock: DayCycleClock; readonly weather: { readonly stormActive: boolean };
  readonly ledges: readonly PouncerLedge[]; readonly rock: { readonly x: number; readonly z: number; readonly top: number };
  readonly patrol: PatrolEncounterView | null; readonly wildlife: EliteWildlife | null;
  readonly persistence: AdventurePersistence; readonly contacts?: StrikeRunner;
}
/** Existing entered owners lent to the effect application. None is authored
 * content, an additional body registry, clock, continuation or installer. */
/** What an elite reads of the air, and the knockdown it deals through it. */
type EliteAir = V2EnvironmentColumns & { readonly onKnockdown: (x: number, z: number, strength: number) => void };
export interface ElitePageOutputLoans {
  readonly construction: Scope; readonly entered: Scope; readonly game: Game;
  readonly controllers: readonly EliteOutputController[];
  readonly patrol: PatrolEncounterView | null; readonly wildlife: EliteWildlife | null;
  readonly animals: RowBodiesView; readonly environment: EliteAir;
  readonly player: Player; readonly hud: HUD; readonly audio: Audio;
  readonly persistence: AdventurePersistence; readonly contacts: StrikeRunner;
  readonly strikes: readonly { readonly amount: number; readonly strike: StrikeData }[];
  readonly fallbackStrike: StrikeData;
}
/** Admit every effect sink before engine construction; optional absent native
 * services retain the original no-result semantics. No body/UI allocation. */
function preflightEliteEffectServices(actions: readonly EliteOutputAction[],
  loans: Pick<ElitePageOutputLoans, 'game' | 'player' | 'animals' | 'environment' | 'hud' | 'audio' | 'persistence' | 'contacts' | 'patrol' | 'wildlife'>): void {
  if (loans.game.app !== app) throw new Error('Foreign elite effect service owner');
  const need = <O extends object>(owner: O | null, key: keyof O): void => {
    if (owner !== null && typeof owner[key] !== 'function') throw new Error('Missing elite effect sink');
  };
  for (const action of actions) switch (action.kind) {
    case 'contact': need(loans.contacts, 'contact'); need(app.combat, 'hit'); break;
    case 'knockdown': need(loans.environment, 'onKnockdown'); break;
    case 'feed': need(loans.hud, 'killFeed'); break;
    case 'sound': need(loans.audio, 'animal'); break;
    case 'record': need(loans.persistence, 'kill'); need(loans.persistence, 'feat'); break;
    case 'patrol-rider': need(loans.patrol, 'spawnRider'); break;
    case 'patrol-line': need(loans.patrol, 'spawnLine'); break;
    case 'patrol-dissolve': need(loans.patrol, 'dissolve'); break;
    case 'wildlife-pack': need(loans.wildlife, 'spawnPack'); break;
    case 'wildlife-herd': need(loans.wildlife, 'spawnHerd'); need(loans.animals, 'spawn'); break;
    default: throw new Error('Invalid elite effect sink');
  }
}
/** Prepare the COMPLETE native suffix without effects. The existing combined
 * command authority interleaves these synchronous operations only after every
 * actor/world/elite branch has passed validation. Actor pointers are captured
 * once here, so an earlier adoption cannot retarget a later emitted contact. */
function prepareElitePageOutputs(actions: readonly EliteOutputAction[], input: unknown,
  loans: ElitePageOutputLoans, actors: readonly (Animal | null)[]): { readonly validate: () => void; readonly validateOwners: () => void; readonly operations: readonly (() => void)[] } {
  const { construction, entered, game, controllers, patrol, wildlife, animals, environment, player, hud, audio, persistence, contacts, strikes, fallbackStrike } = loans;
  const bank = parseEliteOutputBank(parseEliteOutputActions(actions, controllers.length), input, actors.length);
  preflightEliteEffectServices(actions, loans);
  const controls = [...controllers], tags = controls.map(loan => loan.kind), controllerOwners = controls.map(loan => loan.owner), bodies = [...actors], level = game.levelScope, health = app.player, physics = app.physics, combat = app.combat;
  // Identities are compared only; all calls retain the concrete native receiver.
  const method = <O extends object>(owner: O | null, key: keyof O): unknown => owner === null ? undefined : owner[key];
  const nativeMethods = (): readonly unknown[] => {
    const values = [method(loans.patrol, 'spawnRider'), method(loans.patrol, 'spawnLine'), method(loans.patrol, 'dissolve'),
      method(loans.wildlife, 'spawnPack'), method(loans.wildlife, 'spawnHerd'), method(loans.animals, 'spawn'), method(loans.environment, 'onKnockdown'),
      method(loans.hud, 'killFeed'), method(loans.audio, 'animal'), method(loans.persistence, 'kill'), method(loans.persistence, 'feat'), method(loans.contacts, 'contact'), method(combat, 'hit')];
    controllers.forEach(loan => { values.push(method(loan.owner, 'row'), method(loan.owner, 'def'),
      loan.kind === 'external' ? method(loan.owner, 'adopt') : undefined, loan.kind === 'external' ? method(loan.owner, 'support') : undefined); });
    return values;
  };
  const methods = nativeMethods();
  const liveOwners = (): void => {
    if (!(construction instanceof Scope) || !(entered instanceof Scope) || construction.disposed || construction.disposing || entered.disposed || entered.disposing
      || game.levelScope !== level || game.app !== app || app.combat !== combat
      || loans.construction !== construction || loans.entered !== entered || loans.game !== game || loans.controllers !== controllers
      || loans.patrol !== patrol || loans.wildlife !== wildlife || loans.animals !== animals || loans.environment !== environment || loans.player !== player
      || loans.hud !== hud || loans.audio !== audio || loans.persistence !== persistence || loans.contacts !== contacts || loans.strikes !== strikes || loans.fallbackStrike !== fallbackStrike
      || controls.length !== controllers.length || controls.some((loan, index) => controllers[index] !== loan || loan.kind !== tags[index] || loan.owner !== controllerOwners[index])
      || bodies.length !== actors.length || bodies.some((actor, index) => actors[index] !== actor) || nativeMethods().some((value, index) => value !== methods[index])) throw new Error('Retired or replaced elite output owner');
  };
  // A retained entry may bind during build-ahead, before the page switches
  // its active physics/player frame. Pin that ambient pair per actual bank;
  // concrete loans, methods and scope ownership remain pinned for its lifetime.
  const live = (): void => {
    liveOwners();
    if (app.player !== health || app.physics !== physics) throw new Error('Retired or replaced elite output owner');
  };
  live();
  if (new Set(controllerOwners).size !== controllerOwners.length || new Set(bodies.filter(actor => actor !== null)).size !== bodies.filter(actor => actor !== null).length
    || controls.some(loan => { const row: object = loan.owner.row; return loan.kind === 'keeper' ? !('pattern' in row) || 'mode' in row : !('mode' in row) || 'pattern' in row; })
) throw new Error('Invalid elite output loan');
  for (const action of actions) {
    const loan = controls[action.controller];
    if (loan === undefined || action.kind === 'wildlife-pack' && loan.kind !== 'keeper'
      || (action.kind === 'patrol-rider' || action.kind === 'patrol-line') && (loan.kind !== 'external' || loan.owner.row.mode !== 'script')
      || action.kind === 'wildlife-herd' && (loan.kind !== 'external' || loan.owner.row.mode !== 'herd')) throw new Error('Invalid elite action controller');
  }
  const prepared: (() => void)[] = [];
  for (const row of bank) {
    const controllerLoan = controls[row.controller]; if (controllerLoan === undefined) throw new Error('Missing elite output controller');
    let apply: () => void;
    switch (row.kind) {
      case 'contact': case 'patrol-dissolve': {
        const actor = bodies[row.values[0]]; if (actor === undefined || actor === null) throw new Error('Missing emitted elite output actor');
        if (row.kind === 'patrol-dissolve') { apply = () => { patrol?.dissolve(actor); }; break; }
        const strike = strikeFromData(strikes.find(value => value.amount === row.amount)?.strike ?? fallbackStrike);
        apply = () => {
          if (health === null) return;
          contacts.contact(strike, { actor, target: player.position, canReach: () => canReach(actor, player.position, physics), hit: () => {
            if (!canReach(actor, player.position, physics)) return;
            combat.hit({ source: 'env', sourceTags: [`elite.${actor.variant}`, 'feel.blow', 'cover.checked'], target: health, amount: row.amount,
              point: actor.position, dir: new THREE.Vector3(), cause: { kind: actor.kind, label: actor.label } });
          } });
        }; break;
      }
      case 'knockdown': apply = () => { const [x, z] = row.values, length = Math.hypot(x, z) || 1; environment.onKnockdown(x / length, z / length, row.duration); }; break;
      case 'feed': apply = () => { hud.killFeed(row.text); }; break;
      case 'sound': apply = () => { audio.animal(row.cue, new THREE.Vector3(...row.values), player.position, player.yaw); }; break;
      case 'record': apply = () => { persistence.kill(row.actorKind, row.variant); persistence.feat(row.actorKind); }; break;
      case 'patrol-rider': {
        if (controllerLoan.kind !== 'external' || controllerLoan.owner.row.mode !== 'script') throw new Error('Invalid rider result controller');
        const controller = controllerLoan.owner;
        apply = () => { const [x, z, yaw] = row.values, actor = patrol?.spawnRider({ x, z, yaw, variant: row.variant }); if (actor !== undefined && actor !== null) controller.adopt(actor); }; break;
      }
      case 'patrol-line': {
        if (controllerLoan.kind !== 'external' || controllerLoan.owner.row.mode !== 'script') throw new Error('Invalid support result controller');
        const controller = controllerLoan.owner;
        apply = () => { controller.support(patrol?.spawnLine({ count: row.values[0] }) ?? []); }; break;
      }
      case 'wildlife-pack': {
        if (controllerLoan.kind !== 'keeper') throw new Error('Invalid pack result controller');
        const controller = controllerLoan.owner;
        apply = () => { const [x, z, homeX, homeZ] = row.values, pack = wildlife?.spawnPack(x, z, row.variants) ?? null;
          if (pack !== null) { pack.homeX = homeX; pack.homeZ = homeZ; } controller.pack = pack; }; break;
      }
      case 'wildlife-herd': {
        if (controllerLoan.kind !== 'external' || controllerLoan.owner.row.mode !== 'herd') throw new Error('Invalid herd result controller');
        const controller = controllerLoan.owner;
        apply = () => {
          const [x, z, yaw] = row.values, herd = wildlife?.spawnHerd(x + row.offset[0], z + row.offset[1], row.mares, row.foals, row.stallion);
          if (herd === undefined) return;
          const actor = animals.spawn(row.actorKind, x, z, yaw, row.variant), index = herd.members[0]?.herd ?? -1;
          actor.herd = index; if (index >= 0) animals.herds[index]?.members.push(actor); herd.adoptStallion(actor); controller.adopt(actor, herd);
        }; break;
      }
      default: throw new Error('Unsupported elite output');
    }
    prepared.push(() => { live(); apply(); });
  }
  return { validate: live, validateOwners: liveOwners, operations: prepared };
}

/** Native kernels already chose these events. Match only admitted finite action
 * metadata; guest-prepared page banks retain their place in this SAME drain. */
function drainElitePageOutputs(elites: Elites, actions: readonly EliteOutputAction[], loans: ElitePageOutputLoans): void {
  const events = loans.controllers.flatMap((loan, controller) => loan.owner.drainEffects().map(effect => ({ controller, effect })));
  const actors: Animal[] = [];
  for (const { effect } of events) if (effect.kind === 'hit' || effect.kind === 'retire') {
    const actor = effect.kind === 'hit' ? effect.animal : effect.actor;
    if (!actors.includes(actor)) actors.push(actor);
  }
  const prepared = events.map(({ controller, effect }): PreparedEliteOutputs => {
    if (effect.kind === 'page-bank') return effect.bank;
    const loan = loans.controllers[controller]; if (loan === undefined) throw new Error('Missing elite output controller');
    const candidates = actions.filter(action => action.controller === controller);
    const choose = (matches: (action: EliteOutputAction) => boolean): EliteOutputAction => {
      const rows = candidates.filter(matches), row = rows[0];
      if (rows.length !== 1 || row === undefined) throw new Error('Missing or ambiguous elite native output');
      return row;
    };
    let action: EliteOutputAction, values: readonly number[];
    switch (effect.kind) {
      case 'hit': action = choose(row => row.kind === 'contact' && row.amount === effect.amount); values = [actors.indexOf(effect.animal)]; break;
      case 'knock': action = choose(row => row.kind === 'knockdown'); values = [effect.x, effect.z]; break;
      case 'feed': action = choose(row => row.kind === 'feed' && row.text === effect.id); values = []; break;
      case 'sound': action = choose(row => row.kind === 'sound' && row.cue === effect.id); values = [effect.at.x, effect.at.y, effect.at.z]; break;
      case 'record': action = choose(row => row.kind === 'record' && row.actorKind === effect.species && row.variant === effect.variant); values = []; break;
      case 'retire': action = choose(row => row.kind === 'patrol-dissolve'); values = [actors.indexOf(effect.actor)]; break;
      case 'support': action = choose(row => row.kind === 'patrol-line'); values = [effect.count]; break;
      case 'pack': action = choose(row => row.kind === 'wildlife-pack' && row.variants.length === effect.variants.length && row.variants.every((value, index) => value === effect.variants[index]));
        values = [effect.x, effect.z, loan.owner.def.lair.x, loan.owner.def.lair.z]; break;
      case 'request': {
        if (loan.kind !== 'external' || effect.row !== loan.owner.row) throw new Error('Foreign elite request row');
        const spawn = effect.row.spawn;
        action = spawn.source === 'rider' ? choose(row => row.kind === 'patrol-rider' && row.variant === spawn.variant)
          : choose(row => row.kind === 'wildlife-herd' && row.actorKind === spawn.kind && row.variant === spawn.variant
            && row.mares === spawn.mares && row.foals === spawn.foals && row.stallion === spawn.stallion
            && row.offset.every((value, index) => Object.is(value, spawn.offset[index])));
        values = [effect.row.def.lair.x, effect.row.def.lair.z, spawn.yaw]; break;
      }
      default: throw new Error('Unsupported elite native effect');
    }
    return elites.prepareV2Outputs(parseEliteOutputBank(actions, [{ action: action.id, values }], actors.length), actors);
  });
  for (const transaction of prepared) transaction.validate();
  for (const transaction of prepared) for (const apply of transaction.operations) apply();
}
