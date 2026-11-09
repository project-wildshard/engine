import { appIdentity } from '../../../shared/engine/app/identity';
import { listenDom, mountDom } from '../input/dom';
import { engineString } from '../../../shared/engine/strings';
import { app } from '../app/runtime';
/**
 * Explore World — the viewer (project/archive/2026-09-23-explore-world.md): the title's EXPLORE WORLD panel opens it over the already
 * loaded shard. A lazy chunk (main.ts `import('./explore/Explore')`), styled by src/client/engine/ui/styles/explore.css (prefix ws-x-).
 *
 *   const x = new Explore(host);
 *   x.open('hub' | 'model' | 'sets' | 'world', { cam?: [x, y, z, yaw, pitch], model?: id })
 *   x.back()                  // ✕ / Esc: one step back — turntable → catalog → hub → the title (E182)
 *   x.close()                 // out of Explore altogether → host.onExit() (back to the title)
 *   x.context()               // the feedback note's context while exploring (camera pose, mode, model …)
 *   x.toast('Note sent') / x.hold(true)   // the review composer is up: input off, frame frozen by main.ts
 *
 * Modes:
 *   hub    — a scrolling list (E307): the shared cards first (MODEL EXPLORER, SET EXPLORER, WORLD EXPLORER, the developer-only PRACTICE
 *            ARENA), then the shard's own feature playgrounds (src/client/engine/practice/playground/catalog.ts; developer-only too): Nine
 *            Dragon's grapple course, Nalati's horse track — none on Driftwood Isle or Pine Hollow
 *   world  — god mode in the real scene: FreeCam (desktop: RMB look, WASD, Q/E, Shift, wheel, F) or TouchFly (phone:
 *            FLY stick, drag to spin, pinch, ▲▼); the player is parked far away (bootstrap `freeCamera`), so the
 *            animals run their ambient AI and nothing notices the camera (D6)
 *   model  — the Model Explorer (src/client/engine/explore/ModelExplorer.ts)
 *   sets   — the Set Explorer (src/client/engine/explore/SetExplorer.ts; E306 / E315 M7): the shard's sets — groups of placed models —
 *            each framed where it stands, between single models and the whole world. The tabs read in that order:
 *            MODELS · SETS · WORLD (keys 1 · 2 · 3). A member opens its model card; ✕ from there comes back to the set
 * ✎ everywhere: the frame + a note → the review inbox (D5: fire and forget); sending needs the review password (D3),
 * which ✎ asks for once if this device has none.
 */
import * as THREE from 'three';
import { beginExploreEntry, endExploreEntry } from '../boot/bootTrace';
import '../ui/styles/explore.css';
import { FreeCam } from './FreeCam';
import { keycap } from '../input/keycap';
import { TouchFly, holdButton } from './TouchFly';
import { heightAt } from '../../../shared/engine/world/Heightfield';
import { CHUNK_HALF } from '../../../shared/engine/core/config';
import { reviewUnlocked, unlockReview, type ContextValue } from '../ui/review';
import type { World } from '../core/bootstrap';
import { ModelExplorer } from './ModelExplorer';
import { SetExplorer } from './SetExplorer';
import { catalogEntries, type CatalogEntry } from './catalog';
import { registeredPicks } from './registry';
import { Select } from './Select';
import type { SelectTarget } from './pick';
import { boxEntry, firstView, physicsClear, roundBlocker, viewCandidates } from './viewPoint';
import { placedGroups } from '../models/place';
import { MiniMap } from './MiniMap';
import { exploreArt } from '../../../shared/engine/level/data';
import { Compare, hasCompareTargets } from './Compare';
import { isDev, onDev } from '../core/devMode';
import { asPlaygroundId, playgroundsFor, type PlaygroundCard, type PlaygroundId } from '../practice/playground/catalog';

export type ExploreMode = 'hub' | 'world' | 'model' | 'sets';
/** a tab's / a card's `data-m` as a mode (anything else: the World Explorer) */
const asMode = (m: string | undefined): ExploreMode => (m === 'model' || m === 'sets' ? m : 'world');

/** the level's presentation the game layer hands Explore: its name and its picker art */
export interface ExploreTitle { name: string; landscape: string; thumb: string }

export interface ExploreHost {
  world: World;
  /** the level's name and picker art (the composition root's; until it passes one, read from the world's manifest) */
  title: ExploreTitle;
  /** ✕ / ◀ TITLE: main.ts shows the title again */
  onExit: () => void;
  /** the hub's Practice Arena card returns to play with the current shard's starter weapon */
  onPractice: () => void;
  /** a feature playground's card (E307): main.ts loads its scene and enters it, as the Practice card enters the arena */
  onPlayground?: (id: PlaygroundId) => void;
  /** ✎: main.ts opens the review composer (src/client/engine/ui/Feedback.ts) */
  openFeedback: () => void;
  /** hidden while exploring: the chunk-edge force field (it draws lines across the sea from the air) */
  hide?: THREE.Object3D[];
  /** the shard's live animals (ambient AI): the catalog gets one creature per species, a tap on one opens its species.
   *  The models themselves come from the registry (src/client/engine/explore/registry.ts) — whatever the shard's setup registered. */
  creatures?: readonly { mesh: THREE.Object3D; kind: string; position: THREE.Vector3; scale: number }[];
  /** left out of the map's top-down shot (MiniMap): the layers that only fill in around the eye — grass, undergrowth,
   *  mist, ground cover, gulls — which from 1.4 km up are dark tiles, not detail */
  overhead?: THREE.Object3D[];
}


/** a mode that lives in its own module (Model Explorer, …): shown / hidden with its tab, ticked while shown */
export interface ExplorePane {
  readonly el: HTMLElement;
  show: (opts: Record<string, string>) => void;
  hide: () => void;
  update: (dt: number) => void;
  context: () => Record<string, ContextValue>;
  /** E182: the ✕ / Esc steps back one level. The pane takes the step if it has one of its own (the Model Explorer's
   *  turntable → its catalog) and says so; false hands the step on, which leaves the pane for the hub. */
  back?: () => boolean;
}

/** the World Explorer's first view: up and behind the shard's spawn, looking the way the spawn faces — over the
 *  canopy on a forest shard (its pines reach 26 m), so the first frame is the land, not a trunk */
function homeView(world: World): { pos: THREE.Vector3; look: THREE.Vector3 } {
  const s = world.game.level.spawn, fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  // a built floor (ShardManifest.spawn.y, a structure-first shard) stands in for the ground
  const ground = Math.max(s.y ?? heightAt(s.x, s.z), app.world.water.level ?? -Infinity);
  const up = world.forest.trees.length > 0 ? 42 : 26;
  return { pos: new THREE.Vector3(s.x - fx * 12 - fz * 12, ground + up, s.z - fz * 12 + fx * 12), look: new THREE.Vector3(s.x + fx * 150, ground + 4, s.z + fz * 150) };
}
const SPEEDS = [['Slow', 4], ['Normal', 12], ['Fast', 40]] as const;
/** VIEW IN WORLD's first eye (E342): the colliders and copy boxes are tried at most this long, ms, then the old framing stands */
const VIEW_BUDGET_MS = 40;
/** VIEW IN WORLD's landed search (E342): at most this many other eyes, one tap's pick a frame (Nine Dragon: ~25 ms each) */
const VIEW_TRIES = 24;
/** VIEW IN WORLD's landed search (E345): the copies it may try, the landed one and the next nearest it, VIEW_TRIES eyes each */
const VIEW_COPIES = 3;
/** VIEW IN WORLD in flight (E342): the copy it frames, the eyes it may use, the one it is flying to; `checked` once it hopped */
interface Landing { entry: CatalogEntry; eyes: THREE.Vector3[]; at: number; look: THREE.Vector3; box: THREE.Box3; checked: boolean }
/**
 * the landed view's search (E342): the eyes left to try round the copy `l` frames, and where the camera landed (moved by
 * hand: the search stops); E345: the model's next copies nearest the landed one (null until the landed copy's eyes are
 * spent) and the landed copy's box, selected where the camera stands when no eye of any copy picks the model
 */
interface ViewSearch { l: Landing; queue: number[]; from: THREE.Vector3; next: THREE.Box3[] | null; landed: THREE.Box3 }
const PARK = new THREE.Vector3(0, -600, -CHUNK_HALF * 12); // where the player waits: out of every animal's senses

const html = (tag: string, cls: string, inner = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };
const fill = (root: ParentNode, selector: string, text: string): void => { const node = root.querySelector(selector); if (node === null) throw new Error(`Explore: missing ${selector}`); node.textContent = text; };
/** the same switch the play HUD uses (TouchControls puts `touch` on #hud on coarse-pointer devices, `?touch=1` forces it) */
const touchDevice = (): boolean => document.getElementById('hud')?.classList.contains('touch') === true;

/** A shard can have world geometry without any close-up specimens registered yet. Keep the Models tab useful and honest. */
class EmptyModels implements ExplorePane {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  readonly el: HTMLElement;

  constructor(explore: Explore, shardName: string) {
    this.el = html('div', 'ws-x-empty-models', `
      <div class="ws-x-empty-panel">
        <div class="ws-x-empty-label"></div>
        <div class="ws-x-empty-count"><span>Catalog</span><span>00 models</span></div>
        <div class="ws-x-empty-symbol" aria-hidden="true">◇</div>
        <h2>No models<br>catalogued yet</h2>
        <p>3D assets are in this world, but none are registered for close inspection yet.</p>
        <button type="button">Explore the world <span aria-hidden="true">›</span></button>
        <small>The model catalog will appear here as assets are added.</small>
      </div>`);
    fill(this.el, '.ws-x-empty-label', `Model explorer / ${shardName}`);
    listenDom(this.uiScope, this.el.querySelector('button'), 'click', () => { explore.setMode('world'); });
  }

  show(): void { this.el.classList.add('show'); }
  hide(): void { this.el.classList.remove('show'); }
  update(): void { /* no turntable or thumbnails to animate */ }
  context(): Record<string, ContextValue> { return { view: 'empty catalog', models: 0 }; }
}

export class Explore {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  private readonly inputScope = (app.levelScope ?? app.engineScope).child('explore-input');
  active = false;
  private releaseClock: (() => void) | null = null;
  mode: ExploreMode = 'hub';
  readonly cam: FreeCam;
  readonly root: HTMLElement;
  private fly: TouchFly | null = null;
  private readonly hubEl: HTMLElement;
  private readonly flyEl: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly speedBtn: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly panes = new Map<ExploreMode, ExplorePane>();
  private speed = 1;
  private hubT = 0;
  private held = false;
  private readoutT = 0;
  private readonly parkedFrom = new THREE.Vector3();
  private viewmodelVisible = true;
  private toastScope = this.uiScope.child('toast');

  /** the level's name and picker art */
  readonly title: ExploreTitle;

  private readonly host: ExploreHost;
  constructor(host: ExploreHost) {
    this.host = host;
    const { game } = host.world;
    this.title = host.title;
    this.cam = new FreeCam(game.camera, game.canvas, { moveSpeed: SPEEDS[1][1], damping: 0.82, pointerLock: true });
    this.cam.enabled = false;
    this.uiScope.onDispose(() => { this.cam.dispose(); });
    this.cam.floor = (x, z) => heightAt(x, z);

    this.root = html('div', 'ws-x');
    const top = html('div', 'ws-x-top', `
      <div class="ws-x-brand"><span>${appIdentity().wordmark}</span><i>Explore</i></div>
      <div class="ws-x-tabs"><button type="button" data-m="model">Models</button><button type="button" data-m="sets">Sets</button><button type="button" data-m="world">World</button></div>
      <button class="ws-x-close" type="button" aria-label="Back to the title">✕</button>`);
    this.closeBtn = top.querySelector<HTMLElement>('.ws-x-close') ?? top;
    this.tabs = top.querySelector<HTMLElement>('.ws-x-tabs') ?? top;
    this.readout = html('div', 'ws-x-readout');
    const hubArt = exploreArt(game.level.explore);
    const worldArt = hubArt?.world ?? this.title.landscape, modelsArt = hubArt?.models ?? this.title.thumb; // a shard with none yet shows its picker art
    const setsArt = hubArt?.sets ?? worldArt; // E315 M7: one of the shard's sets from the air
    // the Practice card is this shard's own arena: the room takes each shard's grade and weapon (E292)
    const practiceArt = hubArt?.practice ?? this.title.thumb;
    // E307: the shard's own feature playgrounds under the shared cards (placeholder art: the verb's glyph on a dev tile)
    const playgrounds = playgroundsFor(game.level.id);
    // a scrolling list (E307, Jake: "this is going to have to be a scrollable list"), anchored to the bottom while it fits
    this.hubEl = html('div', 'ws-x-hub', `<div class="ws-x-hub-list">
      <div class="ws-x-hub-heading">Choose an explorer</div>
      <button class="ws-x-card" type="button" data-m="model"><span class="ws-x-card-art"></span><span class="ws-x-card-text"><b>Model explorer</b><small>Inspect every model up close</small></span><span class="ws-x-card-go">›</span></button>
      <button class="ws-x-card" type="button" data-m="sets"><span class="ws-x-card-art${hubArt?.sets === undefined ? ' ws-x-sets-art' : ''}"></span><span class="ws-x-card-text"><b>Set explorer</b><small>Camps, squares, fields: groups of models where they stand</small></span><span class="ws-x-card-go">›</span></button>
      <button class="ws-x-card" type="button" data-m="world"><span class="ws-x-card-art"></span><span class="ws-x-card-text"><b>World explorer</b><small></small></span><span class="ws-x-card-go">›</span></button>
      <button class="ws-x-card" type="button" data-m="practice" data-dev><span class="ws-x-card-art ws-x-practice-art"></span><span class="ws-x-card-text"><b>Practice arena</b><small>HUD · weapon explorer</small></span><span class="ws-x-card-go">›</span></button>
      </div>`);
    for (const [mode, art] of [['model', modelsArt], ['sets', setsArt], ['world', worldArt], ['practice', practiceArt]] as const) {
      const image = this.hubEl.querySelector<HTMLElement>(`[data-m="${mode}"] .ws-x-card-art`); if (image === null) throw new Error('Explore: missing card art'); image.style.backgroundImage = `url('${art}')`;
    }
    fill(this.hubEl, '[data-m="world"] small', `Fly over ${this.title.name} in god mode`);
    const hubList = this.hubEl.querySelector('.ws-x-hub-list'); if (hubList === null) throw new Error('Explore: missing hub list');
    if (playgrounds.length > 0) {
      const heading = html('div', 'ws-x-hub-heading ws-x-hub-level'); heading.dataset['dev'] = ''; heading.textContent = engineString('s_explore_playgrounds', [this.title.name]); hubList.append(heading);
      for (const card of playgrounds) hubList.append(this.playgroundCard(card));
    }
    this.hubEl.dataset['scroll'] = ''; // index.html swallows touchmove outside [data-scroll]: without it the list can't scroll on a phone
    // the developer-only entries: the Practice arena and the playgrounds (Settings ▸ Developer, live)
    const devOnly = [...this.hubEl.querySelectorAll<HTMLElement>('[data-dev]')];
    const showDev = (on: boolean): void => { for (const e of devOnly) e.hidden = !on; };
    showDev(isDev()); onDev(showDev);
    this.flyEl = html('div', 'ws-x-fly', `
      <div class="ws-x-rail">
        <button class="ws-x-btn ws-x-up" type="button" aria-label="Up">▲</button>
        <button class="ws-x-btn ws-x-down" type="button" aria-label="Down">▼</button>
        <button class="ws-x-chip ws-x-speed" type="button">Speed · Normal</button>
      </div>
      <div class="ws-x-hint">RMB drag look · WASD fly · Q / E down · up · Shift fast · wheel speed · F frame</div>`);
    this.speedBtn = this.flyEl.querySelector<HTMLElement>('.ws-x-speed') ?? this.flyEl;
    const note = html('button', 'ws-x-note', '<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>');
    note.setAttribute('aria-label', engineString('s_a04a8fb11d48'));
    this.toastEl = html('div', 'ws-x-toast');
    this.root.append(top, this.readout, this.hubEl, this.flyEl, note, this.toastEl);
    mountDom(this.uiScope, document.body, this.root);

    listenDom(this.uiScope, this.closeBtn, 'click', () => { this.back(); }); // E182 (Jake: "the X button kicks you back out to level select")
    this.tabs.querySelectorAll<HTMLElement>('button').forEach((b) => { listenDom(this.uiScope, b, 'click', () => { this.setMode(asMode(b.dataset['m'])); }); });
    this.hubEl.querySelectorAll<HTMLElement>('.ws-x-card').forEach((b) => {
      listenDom(this.uiScope, b, 'click', () => {
        const pg = asPlaygroundId(b.dataset['pg']);
        if (pg !== null) this.startPlayground(pg);
        else if (b.dataset['m'] === 'practice') this.startPractice();
        else this.setMode(asMode(b.dataset['m']));
      });
    });
    // a tap on it while flying (another finger holds the stick) comes through TouchFly's MultiTouchTaps (E329)
    listenDom(this.uiScope, this.speedBtn, 'click', () => { this.setSpeed((this.speed + 1) % SPEEDS.length); });
    listenDom(this.uiScope, note, 'click', () => { void this.note(); });
    // ▲ / ▼: each held by its own fingers beside the stick and a look drag (E329, TouchFly.ts holdButton); both held = level
    const rise = { up: false, down: false };
    for (const [sel, key] of [['.ws-x-up', 'up'], ['.ws-x-down', 'down']] as const) {
      const b = this.flyEl.querySelector<HTMLElement>(sel);
      if (b) holdButton(b, (on) => { rise[key] = on; this.cam.move.y = (rise.up ? 1 : 0) - (rise.down ? 1 : 0); });
    }
    for (const action of ['back', 'map', 'pane.1', 'pane.2', 'pane.3', 'quickNote'] as const) {
      app.input.bind(action, () => {
        if (action === 'back' && !this.held) this.back();
        else if (action === 'map' && this.mode === 'world') this.map?.toggle();
        else if (action === 'pane.1') this.setMode('model');
        else if (action === 'pane.2') this.setMode('sets');
        else if (action === 'pane.3') this.setMode('world');
        else if (action === 'quickNote') void this.note();
      }, this.inputScope, () => this.active);
    }
    game.onUpdate((dt) => { this.update(dt); }, 'engine.explore.constructor');
    if ((game.level.pois ?? []).length > 0) this.map = new MiniMap(this, host.world, host.overhead ?? []);
    if (hasCompareTargets(host.world)) this.compare = new Compare(this, host.world);
    const entries = catalogEntries(host.world.sky, host.creatures ?? [], game.level.creatureStyle ?? 'pbr', game.level.spawn); // the level's own creature style
    if (entries.length > 0) {
      this.addPane('model', new ModelExplorer(this, host.world, entries));
      this.select = new Select(this, host.world, selectTargets(entries, host.creatures ?? []), entries);
      this.onTap = (x, y) => { this.select?.pick(x, y); };
    } else this.addPane('model', new EmptyModels(this, this.title.name));
    this.addPane('sets', new SetExplorer(this, host.world, entries));
  }

  private playgroundCard(card: PlaygroundCard): HTMLElement {
    const button = html('button', 'ws-x-card', '<span class="ws-x-card-art"></span><span class="ws-x-card-text"><b></b><small></small></span><span class="ws-x-card-go">›</span>');
    (button as HTMLButtonElement).type = 'button'; button.dataset['m'] = 'playground'; button.dataset['pg'] = card.id; button.dataset['dev'] = '';
    const art = button.querySelector<HTMLElement>('.ws-x-card-art'); if (art === null) throw new Error('Explore: missing playground art');
    if (card.art === undefined) { art.classList.add('ws-x-pg-art'); art.innerHTML = card.icon; }
    else art.style.backgroundImage = `url('${card.art}')`;
    fill(button, 'b', card.title); fill(button, 'small', card.blurb); return button;
  }

  private select: Select | null = null;
  private map: MiniMap | null = null;
  private compare: Compare | null = null;

  /** ORBIT on a selection: one finger (phone) / Alt-drag (desktop) turns around it; off = free flight again */
  setOrbit(on: boolean, centre?: THREE.Vector3): void {
    if (this.fly) this.fly.orbiting = on;
    if (on && centre) { this.cam.focus(centre, this.host.world.game.camera.position.distanceTo(centre)); this.toast(this.fly ? engineString('s_f3b53c98df2e') : engineString('s_explore_orbit', [keycap('Alt')])); }
  }

  /**
   * VIEW IN WORLD: the World Explorer flies to the model (a real copy of it, E306) and looks at it. The eye (E342,
   * viewPoint.ts) is the old three-quarter view, a little above, wherever that is clear, else the first clear one round
   * the copy: no collider at the eye or on the line to the copy, no other drawn-into copy's box in front. Once it lands, a
   * tap's own pick checks the view as drawn (Nine Dragon's facade shells have no colliders, a bush none either): when the
   * centre would pick something else, the other eyes are tried, one pick a frame, and it hops to the first that picks it.
   */
  viewInWorld(e: CatalogEntry): void {
    const box = e.worldBox?.() ?? new THREE.Box3().setFromObject(e.object());
    const look = box.getCenter(new THREE.Vector3());
    this.setMode('world'); // first: the Model Explorer puts the world back (its isolation hid what may stand in the way)
    const eyes = viewCandidates(box);
    const at = Math.max(0, firstView(eyes, (eye) => this.clearView(eye, look, box), VIEW_BUDGET_MS));
    this.flyTo(eyes[at] ?? look, look);
    this.landing = { entry: e, eyes, at, look, box, checked: false };
    this.search = null;
  }
  private landing: Landing | null = null;
  private search: ViewSearch | null = null;

  /** an eye VIEW IN WORLD may use (E342): above the ground, outside the copy's box, no collider and no other copy in the way */
  private clearView(eye: THREE.Vector3, look: THREE.Vector3, box: THREE.Box3): boolean {
    if (eye.y < heightAt(eye.x, eye.z) + this.cam.clearance) return false;
    const entry = boxEntry(eye, look, box);
    if (!Number.isFinite(entry) || entry < 0.5) return false;
    if (!physicsClear(this.host.world.physics, eye, look, box)) return false;
    return this.select?.copyInTheWay(eye, look, entry - 0.05) !== true;
  }

  /** VIEW IN WORLD has landed: the model selected — unless, as drawn, a tap at the centre picks something else (E342) */
  private land(l: Landing): void {
    this.landing = null;
    const here = l.eyes[l.at], sel = this.select;
    if (l.checked || here === undefined || sel === null) { sel?.selectEntry(l.entry, l.box); return; }
    const hit = sel.pickFrom(here, l.look);
    if (hit?.target.entry === l.entry.id) { sel.selectEntry(l.entry, l.box); return; }
    // the other eyes, the clear ones first, each tried with a tap's pick on a frame of its own (searchView); each group
    // looks round what the centre hit when that stands in front of the copy (E345: a market booth's canopy over a
    // scooter — the eyes from under its far edge come before the rest of the ring above)
    const blocker = hit !== null && hit.point.distanceTo(here) < l.look.distanceTo(here) ? hit.point : null;
    this.search = { l, queue: this.searchQueue(l, blocker), from: here.clone(), next: null, landed: l.box };
  }

  /** the eyes a landed search tries round `l`'s copy (but its own), the clear ones first, VIEW_TRIES of them (E342) */
  private searchQueue(l: Landing, blocker: THREE.Vector3 | null): number[] {
    const clear: number[] = [], rest: number[] = [];
    l.eyes.forEach((eye, i) => { if (i !== l.at) (this.clearView(eye, l.look, l.box) ? clear : rest).push(i); });
    const queue = blocker === null ? [...clear, ...rest] : [...roundBlocker(clear, l.eyes, l.look, blocker), ...roundBlocker(rest, l.eyes, l.look, blocker)];
    return queue.slice(0, VIEW_TRIES);
  }

  /** one eye of the landed view's search a frame (E342): the first whose centre picks the model is flown to */
  private searchView(): void {
    const s = this.search;
    if (!s) return;
    // the camera was flown off by hand: the model selected where the camera is
    if (this.host.world.game.camera.position.distanceToSquared(s.from) > 0.25) { this.search = null; this.select?.selectEntry(s.l.entry, s.landed); return; }
    const i = s.queue.shift(), eye = i === undefined ? undefined : s.l.eyes[i];
    if (i === undefined || eye === undefined) {
      // this copy's eyes are spent: the model's next copy nearest the landed one (E345: Nine Dragon's scooter nearest the
      // spawn is parked between two market booths, under both canopies — the next one is seen from under a canopy's edge)
      s.next ??= otherCopies(s.l.entry.id, s.landed, VIEW_COPIES - 1);
      const box = s.next.shift();
      if (box === undefined) { this.search = null; this.select?.selectEntry(s.l.entry, s.landed); return; }
      const look = box.getCenter(new THREE.Vector3());
      s.l = { entry: s.l.entry, eyes: viewCandidates(box), at: -1, look, box, checked: false };
      s.queue = this.searchQueue(s.l, null);
      return;
    }
    if (this.select?.pickFrom(eye, s.l.look)?.target.entry !== s.l.entry.id) return;
    this.search = null;
    this.flyTo(eye, s.l.look, 0.6);
    this.landing = { ...s.l, at: i, checked: true };
  }

  /** a set (E315 M7): the Set Explorer, framed on it */
  openSet(id: string): void { this.setMode('sets', { set: id }); }

  /** a set's member row: its model card — and ✕ / Esc on that card come back to the set */
  openModelFromSet(model: string, set: string): void {
    this.setMode('model', { model });
    this.returnToSet = set;
  }
  private returnToSet: string | null = null;

  /** a set's VIEW IN WORLD: free flight from where the set's view stands, looking at it */
  viewSetInWorld(from: THREE.Vector3, look: THREE.Vector3, name: string): void {
    this.setMode('world');
    this.cam.placeAt(from, look);
    this.toast(engineString('s_7e433d55bb7c', [name]));
  }

  /** a smooth camera flight (god mode stays god mode: controls come back on arrival) */
  flyTo(to: THREE.Vector3, look: THREE.Vector3, seconds = 1.1): void {
    const cam = this.host.world.game.camera;
    this.flight = { t: 0, dur: seconds, from: cam.position.clone(), fromQ: cam.quaternion.clone(), to: to.clone(), look: look.clone() };
  }
  private flight: { t: number; dur: number; from: THREE.Vector3; fromQ: THREE.Quaternion; to: THREE.Vector3; look: THREE.Vector3 } | null = null;

  /** a mode implemented elsewhere (the Model Explorer); its element joins the overlay */
  addPane(mode: ExploreMode, pane: ExplorePane): void {
    this.panes.set(mode, pane);
    pane.el.classList.add('ws-x-pane');
    this.root.insertBefore(pane.el, this.toastEl);
  }

  open(mode: ExploreMode = 'hub', opts: { cam?: number[]; model?: string } = {}): void {
    const { world } = this.host;
    if (!this.active) {
      this.active = true;
      // the day clock stays where it is while exploring, and a look driven by play state shows its base light: the cards,
      // the turntable and the World view are lit the same whatever the quest left the sky at
      this.releaseClock = app.world.dayCycle?.hold() ?? null;
      // Weapons can set their own model visible during update (including custom weapons).
      // Hide their shared camera-space parent for the entire Explore session instead.
      this.viewmodelVisible = world.game.viewmodel.visible;
      world.game.viewmodel.visible = false;
      app.setState('explore');
      this.parkedFrom.copy(world.player.position);
      world.freeCamera = true;
      world.player.position.copy(PARK);
      world.player.keys.clear();
      this.root.classList.add('show');
      for (const o of this.host.hide ?? []) o.visible = false;
      this.setChrome(false);
      if (touchDevice() && !this.fly) {
        this.fly = new TouchFly(world.game.canvas, this.cam, this.flyEl);
        this.fly.onTap = (x, y) => { this.onTap?.(x, y); };
      }
      this.root.classList.toggle('touch', touchDevice());
    }
    this.setMode(mode, opts.model !== undefined ? { model: opts.model } : {});
    const c = opts.cam; // after setMode: entering the world from the hub puts the camera home, a `cam` (a note's "go there") wins
    if (mode === 'world' && c && c.length >= 3 && c.every((v) => Number.isFinite(v))) {
      const [x = 0, y = 0, z = 0, yaw = 0, pitch = 0] = c;
      this.cam.placeAt(new THREE.Vector3(x, y, z)); this.cam.setAngles(yaw, pitch);
    }
  }

  /**
   * One step back (E182, Jake: the ✕ "kicks you back out to level select"): an open overlay closes, else the pane takes
   * its own step (the turntable goes to its catalog), else a mode goes to the hub, and only from the hub does ✕ leave.
   */
  back(): void {
    if (this.compare?.isOpen === true) { this.compare.close(); this.syncBack(); return; }
    if (this.map?.isOpen === true) { this.map.close(); this.syncBack(); return; }
    const set = this.returnToSet;
    if (this.mode === 'model' && set !== null) { this.setMode('sets', { set }); return; } // a member's card goes back to its set
    if (this.panes.get(this.mode)?.back?.() === true) { this.syncBack(); return; }
    if (this.mode === 'hub') { this.close(); return; }
    this.setMode('hub');
  }

  /** the ✕ says where the step goes: ‹ while there is somewhere inside Explore to go back to, ✕ when it leaves */
  syncBack(): void {
    const inner = this.mode !== 'hub' || this.map?.isOpen === true || this.compare?.isOpen === true;
    this.closeBtn.textContent = inner ? engineString('s_0685a836e461') : engineString('s_be64f28a8d0a');
    this.closeBtn.setAttribute('aria-label', inner ? engineString('s_76900f1bfd16') : engineString('s_eac4d36a9469'));
  }

  /** Put the parked player back before either leaving to the title or entering practice. */
  private leave(): boolean {
    if (!this.active) return false;
    const { world } = this.host;
    this.compare?.close();
    this.hidePanes();
    this.active = false;
    this.releaseClock?.(); this.releaseClock = null;
    app.setState('title');
    this.cam.enabled = false; this.cam.move.set(0, 0, 0);
    world.player.position.copy(this.parkedFrom);
    world.freeCamera = false;
    world.game.viewmodel.visible = this.viewmodelVisible;
    this.root.classList.remove('show');
    for (const o of this.host.hide ?? []) o.visible = true;
    this.setChrome(true);
    if (document.pointerLockElement) document.exitPointerLock();
    endExploreEntry();
    return true;
  }

  /** leave to the title */
  close(): void { if (this.leave()) this.host.onExit(); }

  /** Option A: the third equal hub card opens the current shard's shared practice room. */
  private startPractice(): void { if (this.leave()) this.host.onPractice(); }

  /** E307: a feature playground's card — out of Explore and into that shard's dev level */
  private startPlayground(id: PlaygroundId): void {
    const go = this.host.onPlayground;
    if (go !== undefined && this.leave()) go(id);
  }

  /** set by the select layer (X4): a click / tap on the world at client (x, y) */
  onTap?: (x: number, y: number) => void;

  setMode(mode: ExploreMode, opts: Record<string, string> = {}): void {
    beginExploreEntry(mode);
    const prev = this.mode;
    this.returnToSet = null; // (openModelFromSet sets it again after)
    this.mode = mode;
    this.root.dataset['mode'] = mode;
    this.tabs.querySelectorAll<HTMLElement>('button').forEach((b) => { b.classList.toggle('on', b.dataset['m'] === mode); });
    this.cam.enabled = mode === 'world' && !this.held && this.compare?.isOpen !== true;
    if (this.fly) this.fly.enabled = mode === 'world' && this.compare?.isOpen !== true;
    if (mode !== 'world') { this.cam.move.set(0, 0, 0); this.map?.close(); this.compare?.close(); this.search = null; }
    // entering the world from the hub or the Model Explorer (whose camera was orbiting something else) starts at home;
    // VIEW IN WORLD / the map fly from there, a `cam` link (open) overrides it
    if (mode === 'world' && prev !== 'world') { const h = homeView(this.host.world); this.cam.placeAt(h.pos, h.look); }
    // the others hide first (a Set's diorama puts the world back) and then the one shown sets itself up (E315 M7)
    for (const [m, p] of this.panes) if (m !== mode) p.hide();
    this.panes.get(mode)?.show(opts);
    this.syncBack();
  }

  /** the build chip (src/client/engine/ui/Update.ts) sits where the Explore bar is; the frame meter's numbers move into the readout */
  private setChrome(on: boolean): void {
    const chip = document.querySelector<HTMLElement>('.ws-update');
    if (chip) chip.style.visibility = on ? '' : 'hidden';
  }

  private hidePanes(): void { for (const p of this.panes.values()) p.hide(); }

  private setSpeed(i: number): void {
    this.speed = i;
    const s = SPEEDS[i] ?? SPEEDS[1];
    this.cam.moveSpeed = s[1];
    this.speedBtn.textContent = engineString('s_63ff29eeca2a', [s[0]]);
  }

  /** the review composer is up (main.ts Feedback host.hold) */
  hold(on: boolean): void { this.held = on; this.cam.enabled = !on && this.mode === 'world' && this.compare?.isOpen !== true; if (on) this.cam.move.set(0, 0, 0); }

  /** Pause free flight while the static image comparison covers the World Explorer. */
  setCompareOpen(on: boolean): void {
    this.root.classList.toggle('compare-open', on);
    this.cam.enabled = !on && !this.held && this.mode === 'world';
    this.cam.move.set(0, 0, 0);
    if (this.fly) this.fly.enabled = !on && this.mode === 'world';
    if (on) { this.flight = null; this.map?.close(); }
    this.syncBack();
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastScope.dispose(); this.toastScope = this.uiScope.child('toast');
    this.toastScope.timeout(2600, () => { this.toastEl.classList.remove('show'); });
  }

  /** the note's context: what you were looking at, and the URL that reopens it (`?explore=` — main.ts) */
  context(): Record<string, ContextValue> {
    const c = this.host.world.game.camera.position;
    const pane = this.panes.get(this.mode);
    const cam = [c.x, c.y, c.z, this.cam.yaw, this.cam.pitch].map((v) => Number(v.toFixed(2)));
    return { explore: this.mode, cam, ...(pane ? pane.context() : {}), ...(this.mode === 'world' && this.select ? this.select.context() : {}), ...(this.mode === 'world' && this.compare ? this.compare.context() : {}) };
  }

  private async note(): Promise<void> {
    if (!reviewUnlocked()) { this.askPassword(); return; }
    await Promise.resolve();
    this.host.openFeedback();
  }

  /** ✎ without a review password on this device: ask for it once (the inbox's own gate, D3) */
  private askPassword(): void {
    if (this.root.querySelector('.ws-x-unlock')) return;
    const box = html('form', 'ws-x-unlock', `<b>Feedback needs the review password</b><input type="password" autocomplete="current-password" placeholder="Review password"><div><button type="submit">Unlock</button><button type="button" class="ws-x-unlock-cancel">Cancel</button></div><small></small>`);
    const input = box.querySelector('input'), msg = box.querySelector('small');
    const done = (): void => { box.remove(); this.hold(false); };
    listenDom(this.uiScope, box.querySelector('.ws-x-unlock-cancel'), 'click', done);
    const submit = async (): Promise<void> => {
      const r = await unlockReview(input?.value ?? '');
      if (r === 'ok') { done(); this.host.openFeedback(); return; }
      if (msg) msg.textContent = r === 'bad' ? engineString('s_2dde10bde49e') : engineString('s_69cf0e392d1e');
    };
    listenDom(this.uiScope, box, 'submit', (e) => { e.preventDefault(); void submit(); });
    this.root.append(box);
    this.hold(true);
    input?.focus();
  }

  private update(dt: number): void {
    if (!this.active) return;
    const { camera } = this.host.world.game;
    if (this.mode === 'hub') {
      // a slow cinematic orbit of the island behind the hub cards
      this.hubT += dt * 0.035;
      const a = this.hubT - 1.1;
      const base = this.host.world.game.level.spawn.y ?? 0; // a structure-first shard orbits its built datum, not the ground far under it
      camera.position.set(Math.sin(a) * CHUNK_HALF, base + CHUNK_HALF * 0.47, Math.cos(a) * -CHUNK_HALF); // the whole shard from above its edge
      camera.lookAt(0, base + 4, 0);
    } else if (this.mode === 'world') {
      const f = this.flight;
      if (f) {
        f.t = Math.min(1, f.t + dt / f.dur);
        const k = f.t * f.t * (3 - 2 * f.t);
        camera.position.lerpVectors(f.from, f.to, k);
        camera.position.y += Math.sin(Math.PI * k) * f.from.distanceTo(f.to) * 0.18; // a little arc over whatever is between
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(camera.position, f.look, camera.up));
        camera.quaternion.slerpQuaternions(f.fromQ, q, k);
        if (f.t >= 1) { this.flight = null; this.cam.placeAt(f.to, f.look); if (this.landing) this.land(this.landing); }
      } else { this.cam.update(dt); this.searchView(); }
      this.select?.update();
      this.map?.update();
    }
    this.panes.get(this.mode)?.update(dt);
    this.readoutT -= dt;
    if (this.readoutT <= 0 && this.mode === 'world') {
      this.readoutT = 0.2;
      const p = camera.position, hdg = Math.round((((180 - (this.cam.yaw * 180) / Math.PI) % 360) + 360) % 360);
      const alt = p.y - Math.max(heightAt(p.x, p.z), 0);
      const { stats, lastFrame } = this.host.world.game;
      this.readout.textContent = engineString('s_1db2c8e54849', [alt.toFixed(alt < 10 ? 1 : 0), Math.round(p.x), Math.round(p.z), String(hdg).padStart(3, '0'), stats.fps, lastFrame.calls, (lastFrame.triangles / 1e6).toFixed(2)]);
    }
  }
}

/**
 * VIEW IN WORLD's next copies (E345): up to `n` of model `id`'s placed copies (src/client/engine/models/place.ts `placedGroups`) nearest
 * the copy `first` (not it), nearest first — the copies a landed search moves on to when none of `first`'s eyes picks it
 */
function otherCopies(id: string, first: THREE.Box3, n: number): THREE.Box3[] {
  const c = first.getCenter(new THREE.Vector3()), v = new THREE.Vector3(), all: { box: THREE.Box3; d: number }[] = [];
  for (const g of placedGroups()) {
    if (g.model !== id) continue;
    for (let i = 0; i < g.copies; i++) {
      const box = g.copyBox(i, new THREE.Box3()), d = box.getCenter(v).distanceToSquared(c);
      if (d > 1e-6) all.push({ box, d });
    }
  }
  return all.sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.box);
}

/** what a tap in the World Explorer can hit: every live registered model, the registered batch picks, each live animal */
function selectTargets(entries: readonly CatalogEntry[], creatures: NonNullable<ExploreHost['creatures']>): SelectTarget[] {
  const out: SelectTarget[] = entries.filter((e) => e.live).map((e) => ({ object: e.object(), entry: e.id }));
  for (const p of registeredPicks()) out.push({ object: p.object, entry: p.entry, ...(p.boxAt ? { boxAt: p.boxAt } : {}), ...(p.claim ? { claim: p.claim } : {}), ...(p.boxHit ? { boxHit: p.boxHit } : {}) });
  const bySpecies = new Map<string, string>(); // a live animal opens its species' card (E315 M5: the shard's roster model)
  for (const e of entries) if (e.species !== undefined) bySpecies.set(e.species, e.id);
  for (const a of creatures) {
    const entry = bySpecies.get(a.kind);
    if (entry === undefined) continue;
    out.push({ object: a.mesh, entry, boxAt: () => new THREE.Box3(new THREE.Vector3(a.position.x - 0.9 * a.scale, a.position.y - 0.2, a.position.z - 0.9 * a.scale), new THREE.Vector3(a.position.x + 0.9 * a.scale, a.position.y + 1.6 * a.scale, a.position.z + 0.9 * a.scale)) });
  }
  return out;
}
