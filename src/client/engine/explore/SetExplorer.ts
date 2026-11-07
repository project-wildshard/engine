import { listenDom, listenPage } from '../input/dom';
import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
/**
 * Set Explorer (E306 / E315 M7, project/archive/2026-09-30-model-architecture.md): the Explore pane between single models and the whole
 * world. A set is a named group of placed models — a camp, a market square, a kurgan field (`placeSet`,
 * src/client/engine/models/sets.ts). It owns no geometry, so it is shown where it stands: the real world, framed from a 3/4 aerial
 * camera round the set's bounds, orbitable, with its members alongside. Jake (E315): "we can explore individual models,
 * we can explore sets or places, groups, decorated scenes inside of the world, and then we can explore the full world."
 *
 *   const sx = new SetExplorer(explore, world, entries);   explore.addPane('sets', sx);
 *   sx.show({ set: 'nalati-grasslands/kurgan-field' })      // straight into a set;  sx.show({}) → the list
 *
 * List: a card per set — an aerial thumbnail the game renders itself (behind the glass the camera visits each set for a
 * few frames and the frame is copied, so the look, the LODs and the culling are the real ones), its models with their
 * copies and pipeline badges, and the set's own triangles and draws in that view.
 * Scene: the set as a diorama (./diorama.ts, Jake's pick A · circle): only the world inside a round cut about it, on the
 * studio backdrop, seen from a 3/4 aerial. Drag = orbit, pinch / wheel = zoom, idle → it slowly turns; a deep-blue box on a light halo marks the set's
 * bounds (Jake: "way darker, higher contrast"), ◎ on a member
 * outlines its copies (amber); a member row opens its model card (✕ / Esc come back here); ‹ › step through the sets;
 * VIEW IN WORLD hands the view to the World Explorer where it stands. The pure parts (framing, facts, measures) are
 * ./setView.ts.
 */
import * as THREE from 'three';
import type { World } from '../core/bootstrap';
import { CHUNK_HALF } from '../../../shared/engine/core/config';
import type { ContextValue } from '../ui/review';
import { measure, type CatalogEntry } from './catalog';
import type { Explore, ExplorePane } from './Explore';
import { registeredSets } from './registry';
import { FatLines, LOCATED, OUTLINE } from './fatLines';
import { Diorama } from './diorama';
import { studioBackdrop } from './ModelExplorer';
import type { DrawnAs, Pipeline, RegisteredSet } from '../world/registry';
import { bandWindow, boxEdges, copyBoxes, drawnRoots, fitOrbit, fitPoints, lensReset, lensShift, measureDrawn, memberFacts, orderSets, pendingOf, poseOrbit, regionOf, setTotals, type MemberFact, type NdcWindow, type SetOrder } from './setView';

type View = 'list' | 'set';

const PIPELINE_LABEL: Readonly<Record<Pipeline, string>> = { code: 'CODE', blender: 'BLENDER', trellis: 'TRELLIS', hunyuan: 'HUNYUAN', cc0: 'CC0' };
/** the card's thumbnail: 2 : 1, cut from the middle of the frame */
const THUMB_W = 480, THUMB_H = 240;
/** the 3/4 aerial: ~41° above the horizon */
const PITCH = 0.72;
/** on a structure-first shard (Nine Dragon: a set down among towers) steeper, so the towers round it don't stand in the view */
const PITCH_BUILT = 1.15;
/** frames the camera holds a set's view before its thumbnail is copied (the cullers, LODs and near-eye layers settle) */
const SHOT_FRAMES = 5;
/** the list's orders (a shard names 10–20 places: E315 M12) */
const ORDERS: readonly [SetOrder, string][] = [['map', 'By region'], ['az', 'A–Z'], ['size', 'Most copies']];
/** member chips on a card before '+ n more' */
const CHIPS = 4;

/** 86 · 5.3k · 1.24 M */
const count = (n: number): string => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(2)} M`);
const badge = (p: readonly Pipeline[]): string => (p.length === 0 ? '—' : p.map((x) => PIPELINE_LABEL[x]).join('+'));
const html = (tag: string, cls: string, inner = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };
const words = (tag: string, cls: string, text: string): HTMLElement => { const node = html(tag, cls); node.textContent = text; return node; };
const fill = (root: ParentNode, selector: string, text: string): void => { const node = root.querySelector(selector); if (node === null) throw new Error(`SetExplorer: missing ${selector}`); node.textContent = text; };

/** a set and what the explorer learned about it */
interface SetInfo {
  readonly set: RegisteredSet;
  readonly facts: MemberFact[];
  readonly totals: { models: number; copies: number };
  /** the objects that draw it, each once */
  readonly drawn: THREE.Object3D[];
  /** its own triangles and draws, measured in its thumbnail's view (null until then) */
  inView: { tris: number; calls: number } | null;
  thumb: HTMLCanvasElement | null;
}

export class SetExplorer implements ExplorePane {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly members: HTMLElement;
  private infos: SetInfo[] = [];
  private current: SetInfo | null = null;
  // the orbit round the open set
  private readonly centre = new THREE.Vector3();
  private yaw = 0; private pitch = PITCH; private dist = 100; private fit = 100;
  /** where the lens is centred, CSS px from the top: the middle of the band above the sheet */
  private lensY = 0;
  private idle = 0;
  private drag: { id: number; x: number; y: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private readonly scratch = new THREE.PerspectiveCamera();
  // the marks: the set's bounds (a deep-blue box on a light halo), one member's copies (amber boxes on a dark halo) —
  // screen-space lines (LineSegments2), always on top, readable on sand and sea, dark forest and neon alike
  private readonly marks = new THREE.Group();
  private readonly outline: FatLines;
  private readonly located: FatLines;
  private readonly res = new THREE.Vector2();
  /** what the camera frames: the set's bounds, or the diorama's whole cut */
  private readonly framed = new THREE.Box3();
  /** a diorama's outline, fitted instead of its box: the rim top and bottom, the set's top or a stacked set's lid */
  private framedPoints: THREE.Vector3[] | null = null;
  private readonly diorama: Diorama;
  private locatedModel: string | null = null;
  // thumbnails: the camera visits each set in turn behind the list's glass
  private shots: SetInfo[] = [];
  private shot: { info: SetInfo; frames: number; asked: boolean; dist: number; yaw: number } | null = null;
  private shotToken = 0;
  // the per-member triangles, measured a model per frame once a set is open
  private tallies: MemberFact[] = [];
  private readonly eachTris = new Map<string, number>();
  private readonly retries = new Map<string, number>();
  private listT = 0;
  private order: SetOrder = 'map';
  private readoutT = 0;

  private readonly explore: Explore;
  private readonly world: World;
  private readonly entries: readonly CatalogEntry[];
  constructor(explore: Explore, world: World, entries: readonly CatalogEntry[]) {
    this.explore = explore;
    this.world = world;
    this.entries = entries;
    this.el = html('div', 'ws-x-sets');
    const levelName = explore.title.name;
    this.listEl = html('div', 'ws-x-setlist', `
      <div class="ws-x-setlist-head"><span></span><b class="ws-x-setcount"></b></div>
      <p class="ws-x-setlist-blurb">Every named place, camp and square: the models placed there. Each opens where it stands in the world.</p>
      <div class="ws-x-setsort">${ORDERS.map(([o, l]) => `<button type="button" data-o="${o}">${l}</button>`).join('')}</div>
      <div class="ws-x-setcards"></div>`);
    fill(this.listEl, '.ws-x-setlist-head span', `Sets · ${levelName}`);
    this.cards = this.listEl.querySelector<HTMLElement>('.ws-x-setcards') ?? this.listEl;
    this.listEl.querySelectorAll<HTMLElement>('.ws-x-setsort button').forEach((b) => {
      listenDom(this.uiScope, b, 'click', () => { this.order = ORDERS.find(([o]) => o === b.dataset['o'])?.[0] ?? 'map'; this.renderList(); this.shots = this.listed().filter((i) => i.thumb === null && !i.set.bounds.isEmpty()); });
    });
    this.sheet = html('div', 'ws-x-setsheet', `
      <div class="ws-x-sethead"><button class="ws-x-setback" type="button">‹ Sets</button><b class="ws-x-setname"></b><span class="ws-x-setstep"><button class="ws-x-setprev" type="button" aria-label="Previous set">‹</button><button class="ws-x-setnext" type="button" aria-label="Next set">›</button></span><span class="ws-x-setfile"></span></div>
      <div class="ws-x-setstats"><span><i>Models</i><b data-s="models"></b></span><span><i>Copies</i><b data-s="copies"></b></span><span><i>Tris</i><b data-s="tris"></b></span><span><i>Draws</i><b data-s="calls"></b></span></div>
      <div class="ws-x-setframe"></div>
      <div class="ws-x-setmembers-head"><span>◎ shows its copies · a row opens its card</span><span>Tris each</span></div>
      <div class="ws-x-setmembers"></div>
      <div class="ws-x-setactions"><button class="ws-x-setworld" type="button">View in world</button></div>`);
    this.members = this.sheet.querySelector<HTMLElement>('.ws-x-setmembers') ?? this.sheet;
    this.el.append(this.listEl, this.sheet);
    // index.html swallows touchmove outside [data-scroll]: without the mark the list can't scroll on a phone (E109)
    this.cards.dataset['scroll'] = ''; this.members.dataset['scroll'] = '';
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-setback'), 'click', () => { this.openList(); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-setprev'), 'click', () => { this.step(-1); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-setnext'), 'click', () => { this.step(1); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-setworld'), 'click', () => {
      const c = this.current;
      if (c) this.explore.viewSetInWorld(this.world.game.camera.position.clone(), this.centre.clone(), c.set.name);
    });

    this.outline = new FatLines(OUTLINE);
    this.located = new FatLines(LOCATED);
    this.marks.add(this.outline.group, this.located.group);
    this.diorama = new Diorama(world, studioBackdrop);
    this.marks.visible = false;
    world.game.scene.add(this.marks);

    const canvas = world.game.canvas;
    listenDom(this.uiScope, canvas, 'pointerdown', this.onDown);
    listenPage(this.uiScope, 'pointermove', this.onMove);
    listenPage(this.uiScope, 'pointerup', this.onUp);
    listenPage(this.uiScope, 'pointercancel', this.onUp);
    listenDom(this.uiScope, canvas, 'wheel', this.onWheel, { passive: false });
    new ResizeObserver(() => { this.refit(); }).observe(this.sheet);
  }

  /** the shard's sets as the registry has them now (a shard registers its places a task apart during boot) */
  private sync(): void {
    const sets = registeredSets();
    if (sets.length === this.infos.length && sets.every((s, i) => this.infos[i]?.set === s)) return;
    const old = new Map(this.infos.map((i) => [i.set.id, i]));
    this.infos = sets.map((set) => {
      const was = old.get(set.id);
      return was?.set === set ? was : { set, facts: memberFacts(set, this.entries), totals: setTotals(set), drawn: drawnRoots(set), inView: null, thumb: null };
    });
  }

  show(opts: Record<string, string>): void {
    this.el.classList.add('show');
    this.sync();
    const id = opts['set'];
    const info = id !== undefined ? this.infos.find((i) => i.set.id === id) : undefined;
    if (info && !info.set.bounds.isEmpty()) this.openSet(info); else this.openList();
  }

  hide(): void {
    this.el.classList.remove('show');
    this.closeSet();
    this.shot = null; this.shotToken++;
    this.marks.visible = false;
  }

  /** E182: ✕ / Esc steps back to the list while a set is open, and hands the step on from the list itself */
  back(): boolean {
    if (this.el.dataset['view'] !== 'set') return false;
    this.openList();
    return true;
  }

  context(): Record<string, ContextValue> {
    const c = this.current;
    if (!c) return { view: 'sets', sets: this.infos.length };
    const p = this.world.game.camera.position;
    return { view: 'set', set: c.set.id, file: c.set.file, orbit: [p.x, p.y, p.z].map((v) => Number(v.toFixed(1))), located: this.locatedModel ?? '' };
  }

  // ── the list ──

  private openList(): void {
    this.closeSet();
    this.el.dataset['view'] = 'list' satisfies View;
    this.renderList();
    this.shots = this.listed().filter((i) => i.thumb === null && !i.set.bounds.isEmpty());
  }

  /** the sets in the list's order (the ‹ › of an open set walk it too) */
  private listed(): SetInfo[] { return orderSets(this.infos, this.order, CHUNK_HALF).map((r) => r.info); }

  private renderList(): void {
    const n = this.infos.length;
    const countEl = this.listEl.querySelector('.ws-x-setcount');
    if (countEl) countEl.textContent = engineString('s_5c34094656f1', [n, n === 1 ? '' : engineString('s_043a718774c5')]);
    this.listEl.querySelectorAll<HTMLElement>('.ws-x-setsort button').forEach((b) => { b.classList.toggle('on', b.dataset['o'] === this.order); });
    this.listEl.classList.toggle('few', n < 4); // (no ordering to choose between a handful)
    this.cards.replaceChildren();
    if (n === 0) {
      const empty = html('div', 'ws-x-setempty', '<b></b><small>A set names a group of placed models — <code>placeSet</code> in src/models/sets.ts.</small>');
      fill(empty, 'b', `No sets on ${this.explore.title.name} yet`); this.cards.append(empty);
      return;
    }
    let region: string | null = null;
    for (const { region: r, info } of orderSets(this.infos, this.order, CHUNK_HALF)) {
      if (this.order === 'map' && r !== region) {
        region = r;
        const inRegion = this.infos.filter((i) => !i.set.bounds.isEmpty() && regionOf(i.set.bounds, CHUNK_HALF) === r).length;
        const header = html('div', 'ws-x-setregion'); header.append(words('span', '', r ?? 'Not placed yet'), words('b', '', r === null ? '' : String(inRegion))); this.cards.append(header);
      }
      this.cards.append(this.card(info));
    }
  }

  /** one set's card: its aerial, name, size, cost, and its models as chips (the first few, then how many more) */
  private card(info: SetInfo): HTMLElement {
    const { set, totals, facts } = info;
    const pending = pendingOf(set), empty = set.bounds.isEmpty();
    const shown = facts.slice(0, CHIPS);
    const card = html('button', 'ws-x-set', `
      <span class="ws-x-set-thumb">${empty ? '<i>no models placed yet</i>' : ''}</span>
      <span class="ws-x-set-text"><b></b><small></small><small class="ws-x-set-cost"></small></span>
      <span class="ws-x-set-go">›</span>
      <span class="ws-x-setchips"></span>`);
    fill(card, '.ws-x-set-text b', set.name);
    fill(card, '.ws-x-set-text small', `${totals.models} model${totals.models === 1 ? '' : 's'} · ${totals.copies.toLocaleString()} ${totals.copies === 1 ? 'copy' : 'copies'}`);
    fill(card, '.ws-x-set-cost', empty ? '—' : this.costLabel(info));
    const chips = card.querySelector('.ws-x-setchips'); if (chips === null) throw new Error('SetExplorer: missing chips');
    for (const fact of shown) {
      const chip = html('span', 'ws-x-setchip'); chip.append(words('em', '', badge(fact.pipeline)), document.createTextNode(fact.name), words('small', '', `× ${fact.copies.toLocaleString()}`)); chips.append(chip);
    }
    if (facts.length > shown.length) chips.append(words('span', 'ws-x-setchip ws-x-setchip-more', `+ ${facts.length - shown.length} more`));
    if (pending.length > 0) chips.append(words('span', 'ws-x-setchip ws-x-setchip-pending', `+ ${pending.length} to come`));
    (card as HTMLButtonElement).type = 'button';
    (card as HTMLButtonElement).disabled = empty;
    card.dataset['id'] = set.id;
    if (info.thumb) card.querySelector('.ws-x-set-thumb')?.prepend(info.thumb);
    listenDom(this.uiScope, card, 'click', () => { if (!empty) this.openSet(info); });
    return card;
  }

  private costLabel(info: SetInfo): string {
    const v = info.inView;
    return v === null ? 'measuring…' : `${count(v.tris)} tris · ${v.calls} draw${v.calls === 1 ? '' : 's'} in view`;
  }

  // ── a set, where it stands ──

  private openSet(info: SetInfo): void {
    this.closeSet();
    this.shot = null; this.shotToken++; // a thumbnail being shot waits for the next visit to the list
    this.current = info;
    this.el.dataset['view'] = 'set' satisfies View;
    const { set, totals } = info;
    const q = (s: string): HTMLElement | null => this.sheet.querySelector<HTMLElement>(s);
    const name = q('.ws-x-setname'), file = q('.ws-x-setfile'), step = q('.ws-x-setstep');
    if (name) name.textContent = set.name;
    if (file) file.textContent = set.file;
    if (step) step.hidden = this.openable().length < 2;
    this.stat('models', String(totals.models)); this.stat('copies', totals.copies.toLocaleString());
    this.stat('tris', info.inView ? count(info.inView.tris) : '…'); this.stat('calls', info.inView ? String(info.inView.calls) : '…');
    this.renderMembers(info);
    this.mark(set);
    this.locate(null);
    // the diorama (Jake's pick, A · circle): only the world inside a round cut about the set, on the studio backdrop
    const vol = this.diorama.enter(set.bounds, [this.marks]);
    const top = Math.max(set.bounds.max.y, Number.isFinite(vol.top) ? vol.top : set.bounds.max.y);
    this.framed.set(new THREE.Vector3(vol.centre.x - vol.radius, vol.floor, vol.centre.z - vol.radius), new THREE.Vector3(vol.centre.x + vol.radius, top, vol.centre.z + vol.radius));
    const ring = (y: number, r: number): THREE.Vector3[] => Array.from({ length: 16 }, (_, k) => new THREE.Vector3(vol.centre.x + Math.cos((k / 16) * Math.PI * 2) * r, y, vol.centre.z + Math.sin((k / 16) * Math.PI * 2) * r));
    // the disc (its rim top and bottom) and what rises from it: a stacked set's lid, else the set's top
    const crown = Number.isFinite(vol.top) ? vol.radius : Math.hypot(set.bounds.max.x - set.bounds.min.x, set.bounds.max.z - set.bounds.min.z) / 2;
    this.framedPoints = [...ring(vol.floor, vol.radius), ...ring(vol.centre.y, vol.radius), ...ring(top, crown)];
    // the view: from the lit side (the camera between the sun and the set, a little off-axis), fitted to the screen above the sheet
    this.framed.getCenter(this.centre);
    const sun = this.world.game.sky.sunDir;
    // (a diorama cuts the towers away, so every shard's is seen from the same 3/4 aerial; the whole world, steeper on a stacked one)
    this.yaw = Math.atan2(sun.x, sun.z) + 0.55; this.pitch = PITCH; this.idle = 0;
    this.fit = 0;
    this.refit();
    this.dist = this.fit;
    this.tallies = info.facts.filter((f) => !this.eachTris.has(f.model));
    this.readoutT = 0;
  }

  /** the opening pitch of the aerial: steeper on a structure-first shard (ShardManifest.spawn.y: its ground is what it built) */
  private pitch0(): number { return this.world.game.level.spawn.y === undefined ? PITCH : PITCH_BUILT; }

  /** the box on a set's bounds */
  private mark(set: RegisteredSet): void {
    this.outline.set(boxEdges([set.bounds]));
    this.marks.visible = true;
  }

  private closeSet(): void {
    if (this.current !== null && lensReset(this.world.game.camera)) this.world.game.sky.csm.updateFrustums();
    this.diorama.exit();
    this.current = null;
    this.marks.visible = false;
    this.locate(null);
    this.drag = null; this.pointers.clear(); this.pinch = 0;
  }

  private stat(k: string, v: string): void { const b = this.sheet.querySelector(`.ws-x-setstats b[data-s="${k}"]`); if (b) b.textContent = v; }

  private renderMembers(info: SetInfo): void {
    this.members.replaceChildren();
    for (const f of info.facts) {
      const row = html('div', 'ws-x-member', `
        <button class="ws-x-locate" type="button" aria-label="Show its copies"><i></i></button>
        <button class="ws-x-member-open" type="button"${f.drawnAs === null ? ' disabled' : ''}><em></em><b></b><small></small><strong class="ws-x-member-tris"></strong><span>›</span></button>`);
      fill(row, 'em', badge(f.pipeline)); fill(row, 'b', f.name); fill(row, 'small', this.memberLine(f)); fill(row, 'strong', this.memberTris(f));
      row.dataset['model'] = f.model;
      listenDom(this.uiScope, row.querySelector('.ws-x-locate'), 'click', () => { this.locate(this.locatedModel === f.model ? null : f.model); });
      listenDom(this.uiScope, row.querySelector('.ws-x-member-open'), 'click', () => { const c = this.current; if (c && f.drawnAs !== null) this.explore.openModelFromSet(f.model, c.set.id); });
      this.members.append(row);
    }
    const pending = pendingOf(info.set);
    if (pending.length > 0) {
      const row = html('div', 'ws-x-setpending', '<b>To come</b>');
      row.append(document.createTextNode(` ${pending.map((m) => this.entries.find((e) => e.id === m)?.name ?? m).join(' · ')}: this place's models not on the model contract yet`)); this.members.append(row);
    }
  }

  private memberLine(f: MemberFact): string {
    const drawn: DrawnAs | '' = f.drawnAs ?? '';
    return `× ${f.copies.toLocaleString()}${drawn === '' ? ' · not in the catalog' : ` · ${drawn}`}`;
  }

  /** one copy's triangles, once measured */
  private memberTris(f: MemberFact): string { const t = this.eachTris.get(f.model); return t === undefined ? '…' : count(t); }

  /** ◎: outline one member's copies in amber (null: none) */
  private locate(model: string | null): void {
    this.locatedModel = model;
    const c = this.current;
    this.located.set(boxEdges(model !== null && c ? copyBoxes(c.set, model) : []));
    this.members.querySelectorAll<HTMLElement>('.ws-x-member').forEach((r) => { r.classList.toggle('on', r.dataset['model'] === model); });
  }

  /** the sets that can open (placed somewhere), in the list's order */
  private openable(): SetInfo[] { return this.listed().filter((i) => !i.set.bounds.isEmpty()); }

  /** ‹ › : the neighbouring set in the list's order, wrapping round */
  private step(by: -1 | 1): void {
    const c = this.current;
    const list = this.openable();
    if (!c || list.length < 2) return;
    const i = list.indexOf(c);
    const next = list[(i + by + list.length) % list.length];
    if (next) this.openSet(next);
  }

  /**
   * Fit the set into the band between the top bar and the sheet, from every yaw; the lens is centred on that band (a view
   * offset: the orbit still turns round the set, which sits above the sheet). The zoom keeps its ratio.
   */
  private refit(): void {
    const c = this.current;
    if (!c || this.el.dataset['view'] !== 'set') return;
    const cam = this.world.game.camera, H = this.world.game.canvas.clientHeight || innerHeight;
    const sheetTop = this.sheet.getBoundingClientRect().top, barBottom = document.querySelector('.ws-x-top')?.getBoundingClientRect().bottom ?? 60;
    const top = barBottom + 8, bottom = Math.max(top + 120, sheetTop > 0 ? sheetTop - 8 : H * 0.6);
    this.lensY = (top + bottom) / 2;
    this.lens();
    this.scratch.copy(cam); this.scratch.updateProjectionMatrix();
    const k = this.fit > 0 ? this.dist / this.fit : 1;
    const win = bandWindow(top, bottom, H, 0.04, 0.9), pts = this.framedPoints;
    this.fit = pts ? fitPoints(this.framed.getCenter(new THREE.Vector3()), pts, this.scratch, this.pitch, win, 12, 0, 0) : fitOrbit(this.framed, this.scratch, this.pitch, win, 12, 0, 0);
    this.dist = this.fit * k;
  }

  /** the lens on the band above the sheet (again each frame: another pane may have reset it as the tabs switched) */
  private lens(): void {
    const canvas = this.world.game.canvas;
    if (lensShift(this.world.game.camera, canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, this.lensY)) this.world.game.sky.csm.updateFrustums();
  }

  // ── input: drag orbit, wheel / pinch zoom (only while a set is open) ──
  private get inScene(): boolean { return this.current !== null && this.el.classList.contains('show'); }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.inScene) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    else { this.drag = null; this.pinch = this.spread(); }
    this.idle = 0;
  };

  private spread(): number { const [a, b] = [...this.pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.inScene || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.zoom(this.pinch / s);
      this.pinch = s;
      return;
    }
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.2, Math.min(1.45, this.pitch + dy * 0.005));
    this.idle = 0;
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.drag?.id === e.pointerId) this.drag = null;
    if (this.pointers.size < 2) this.pinch = 0;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.inScene) return;
    e.preventDefault();
    this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    this.idle = 0;
  };

  /** a diorama keeps the camera round its cut (from inside it the cut walls would face you); the world lets it go far */
  private zoom(k: number): void { const d = this.diorama.volume !== null; this.dist = Math.max(this.fit * (d ? 0.45 : 0.2), Math.min(this.fit * (d ? 1.6 : 3), this.dist * k)); }

  // ── every frame ──

  update(dt: number): void {
    const { camera } = this.world.game;
    if (this.marks.visible) { this.world.game.renderer.getSize(this.res); this.outline.resize(this.res); this.located.resize(this.res); this.diorama.update(this.res); }
    const c = this.current;
    if (c) {
      this.idle += dt;
      if (this.idle > 2.5 && !this.drag) this.yaw += dt * 0.12; // it turns slowly while you look
      this.lens();
      poseOrbit(camera, this.centre, this.yaw, this.pitch, this.dist, 0);
      this.tally();
      this.readoutT -= dt;
      if (this.readoutT <= 0) {
        this.readoutT = 0.5;
        const v = measureDrawn(c.drawn), { stats, lastFrame } = this.world.game;
        this.stat('tris', count(v.tris)); this.stat('calls', String(v.calls));
        const f = this.sheet.querySelector('.ws-x-setframe');
        if (f) f.textContent = engineString('s_36482b68a86a', [count(lastFrame.triangles), lastFrame.calls, stats.fps]);
      }
      return;
    }
    if (this.shotStep()) return;
    // the list floats over a slow orbit of the shard, like the hub
    this.listT += dt * 0.03;
    const base = this.world.game.level.spawn.y ?? 0;
    camera.position.set(Math.sin(this.listT + 2) * CHUNK_HALF * 0.92, base + CHUNK_HALF * 0.42, Math.cos(this.listT + 2) * -CHUNK_HALF * 0.92);
    camera.lookAt(0, base + 4, 0);
  }

  /** one member's triangles per copy a frame (its specimen built on first need, like the Model Explorer's cards) */
  private tally(): void {
    const f = this.tallies.shift();
    const c = this.current;
    if (!f || !c) return;
    const e = this.entries.find((x) => x.id === f.model);
    if (!e) return;
    const tris = measure(e.object()).tris;
    if (tris === 0) { if ((this.retries.get(f.model) ?? 0) < 600) { this.retries.set(f.model, (this.retries.get(f.model) ?? 0) + 1); this.tallies.push(f); } return; } // (a GLB still loading: again later)
    this.eachTris.set(f.model, e.live && e.drawnAs === 'instanced' && e.copies > 1 ? Math.round(tris / e.copies) : tris);
    const row = [...this.members.querySelectorAll<HTMLElement>('.ws-x-member')].find((r) => r.dataset['model'] === f.model);
    const cell = row?.querySelector('.ws-x-member-tris');
    if (cell) cell.textContent = this.memberTris(f);
  }

  /**
   * The list's thumbnails: the camera holds each set's aerial view for SHOT_FRAMES frames, then the frame the game drew is
   * copied (Game.captureFrame) and cut to the card, and the set's own draws in it measured. True while one is being shot.
   */
  private shotStep(): boolean {
    const { game } = this.world;
    if (!this.shot) {
      const info = this.shots.shift();
      if (!info) return false;
      const cam = game.camera, W = innerWidth, H = innerHeight;
      const band = W / H >= THUMB_W / THUMB_H ? { w: (H * THUMB_W) / THUMB_H, h: H } : { w: W, h: (W * THUMB_H) / THUMB_W };
      this.scratch.fov = cam.fov; this.scratch.aspect = cam.aspect; this.scratch.near = cam.near; this.scratch.far = cam.far; this.scratch.updateProjectionMatrix();
      const win: NdcWindow = { x0: -(band.w / W) * 0.9, x1: (band.w / W) * 0.9, y0: -(band.h / H) * 0.84, y1: (band.h / H) * 0.84 };
      const sun = game.sky.sunDir;
      const yaw = Math.atan2(sun.x, sun.z) + 0.55;
      this.shot = { info, frames: 0, asked: false, dist: fitOrbit(info.set.bounds, this.scratch, this.pitch0(), win, 1, yaw), yaw };
      this.mark(info.set); // its brackets are in the picture: the card shows which ground is the set
    }
    const s = this.shot;
    poseOrbit(game.camera, s.info.set.bounds.getCenter(this.centre), s.yaw, this.pitch0(), s.dist, 0);
    s.frames++;
    if (s.frames >= SHOT_FRAMES && !s.asked) {
      s.asked = true;
      const token = this.shotToken;
      void game.captureFrame(960).then((frame) => { if (token === this.shotToken) this.took(s.info, frame); return frame; });
    }
    return true;
  }

  /** a set's thumbnail frame is in: its card gets the picture, and the set's own draws in that view */
  private took(info: SetInfo, frame: HTMLCanvasElement): void {
    info.inView = measureDrawn(info.drawn); // the frame just drawn from this view: its culling and LODs as they stand
    info.thumb = cut(frame);
    this.shot = null;
    this.marks.visible = false;
    const card = this.cards.querySelector(`.ws-x-set[data-id="${CSS.escape(info.set.id)}"]`);
    if (!card) return;
    card.querySelector('.ws-x-set-thumb')?.prepend(info.thumb);
    const cost = card.querySelector('.ws-x-set-cost');
    if (cost) cost.textContent = this.costLabel(info);
  }
}

/** the middle 2 : 1 band of a frame, over black (Nine Dragon keeps view depth in alpha: its pixels are not opaque, E289) */
function cut(frame: HTMLCanvasElement): HTMLCanvasElement {
  const W = frame.width, H = frame.height;
  const w = W / H >= THUMB_W / THUMB_H ? (H * THUMB_W) / THUMB_H : W, h = (w * THUMB_H) / THUMB_W;
  const c = document.createElement('canvas'); c.width = THUMB_W; c.height = THUMB_H;
  const g = c.getContext('2d');
  if (g) {
    g.drawImage(frame, (W - w) / 2, (H - h) / 2, w, h, 0, 0, THUMB_W, THUMB_H);
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, THUMB_W, THUMB_H);
  }
  return c;
}
