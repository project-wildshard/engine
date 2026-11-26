/**
 * A data cell's scene life on a grid page (meta SHARD-SOURCE SS-SHIPb): its look's detail layers (AP32d1: grass, ferns), its
 * hung lanterns and signs (SS8c: `look.light.swings`), its declared water's surfaces (MOSSGATE-ZONE MZ6), its pools' splash
 * (SS6) and the wind clock they sway on (SS8a).
 *
 * A standalone page installs these in `ShardfileClient.world()` (`shardfile/client.ts`). A grid cell never runs that: the
 * session draws a data cell through its tile admission (`session.ts`), which compiles the look's materials, and so their
 * swing uniforms, but nothing wrote them, drew the layers or advanced the clock. On staging v0.1.33 Mossgate's lanterns
 * hung still (within 0.4 px over 5 s) and its yard had no detail grass, though the devserver page showed both.
 *
 * Like `NeighbourLife`, only the entered cell lives (G663: a neighbour is scene-graph level of detail, with no logic): its
 * layers are built on its first entry, then draw and follow the viewer while entered; its swings and splash step only
 * then. A product's copies share one compiled material set and so one set of swing uniforms (world-space pivots), so a
 * slug placed more than once keeps its swings still rather than turn one copy's lanterns round another's pivots.
 *
 * Its declared look lamps (`look.light.lamps`, QA 11-25 row 138): a standalone page lights them in its data look's compose
 * (`dataLook.ts`), which a grid cell never runs, so Mossgate's hut stood unlit on the grid path (the dev page since engine
 * e02a796fb, and every player). They are built under the cell's root (`lampLights`, a lamp on a swing swinging with its
 * lantern) and shown through the page pool's reserved lights (`LightPool.show`): out of three's light count, so entering and
 * leaving never rebuilds a lit program. Only the entered cell's light, its nearest lamps to the camera, as many as the
 * reserve holds (at most the tier's own `PHONE_LAMPS` / `DESKTOP_LAMPS`), flickering as declared.
 *
 * The water surfaces are drawn on admission, as the cell's tiles are, so a neighbour's pond shows from the road; a planar
 * mirror (one extra scene draw per frame in view) shows only while its cell is entered, and its ripples step only then. On
 * staging rev 6 Mossgate's pond drew splash and rings over a bare pit: the grid drew `source.water`'s splash, never its
 * surface (QA 11-19 row 27).
 */
import { Group, Vector3, type Material, type Mesh, type PointLight } from 'three';
import type { LightPool } from '@wildshard/engine/fx/LightPool';
import { DESKTOP_LAMPS, PHONE_LAMPS, lampLights } from '@wildshard/engine/render/lookLight';
import { lookLightOn } from '@wildshard/engine/ui/lookLightOption';
import type { Scope } from '@wildshard/engine/app/scope';
import { windClockFallback } from '@wildshard/engine/world/wind';
import { SwingField, type SwingMover, type SwingUniforms } from '@wildshard/engine/world/swings';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { detailLayerFiles, installClientDetails } from '../shardfile/clientDetails';
import { installClientSplash } from '../shardfile/clientSplash';
import { installClientWater } from '../shardfile/clientWater';
import type { GridCell } from '../../../shared/game/grid/assembly';

/** What a cell's scene life reads from the session. */
export interface CellSceneLifePorts {
  readonly scope: Scope;
  /** the phone tier grows half the detail radius and slots */
  readonly phone: boolean;
  /** the traveller's feet in the page scene's metres (the home frame the cell roots sit in), not the active frame's */
  readonly feet: () => { readonly x: number; readonly y: number; readonly z: number };
  /** whether the traveller is in this cell (the active frame) */
  readonly active: (instance: string) => boolean;
  /** the page's light pool, whose reserved lights show the entered cell's look lamps (absent: no lamps light) */
  readonly lights?: LightPool | undefined;
  /** the camera's world position, written into `out` (the nearest lamps light); absent: the feet */
  readonly eye?: ((out: Vector3) => Vector3 | undefined) | undefined;
  /** Settings ▸ Debug ▸ Look ▸ "Look light" (default: the saved row) */
  readonly lookLight?: (() => boolean) | undefined;
}

/** The cell's compiled look, as the session's tile admission holds it per slug. */
export interface CellScenePresentation {
  readonly materials: ReadonlyMap<string, Material>;
  /** absent: its surfaces bind none (nothing on it swings) */
  readonly swings: SwingUniforms | undefined;
}

/** One cell's readout. */
export interface CellSceneLifeCell { readonly instance: string; readonly layers: number; readonly swings: number; readonly water: number; readonly splash: boolean; readonly live: boolean;
  /** its look lamps (QA 11-25 row 138): how many its look declares, how many it may light at once, and how many light now */
  readonly lampsDeclared: number; readonly lamps: number; readonly lampsLit: number }

interface CellScene {
  readonly cell: GridCell;
  /** the detail layers' holder, shown only while the cell is entered; its layers are built on the first entry */
  readonly details: Group;
  readonly install: (() => number) | null;
  installed: boolean;
  layers: number;
  /** null: none, or its product is placed twice (the copies share one uniform set) */
  swings: SwingField | null;
  /** per-frame runs (the layers' ring, the splash), stepped only while entered */
  readonly frames: ((dt: number) => void)[];
  /** its declared water's surfaces (MZ6) */
  readonly water: readonly Mesh[];
  /** the planar mirrors among them, shown only while entered */
  readonly mirrors: readonly Mesh[];
  readonly splash: boolean;
  /** its look lamps (null: none declared, or no reserve to show them through), shown only while entered */
  readonly lamps: ReturnType<typeof lampLights> | null;
  /** how many lamps its look declares */
  readonly lampsDeclared: number;
  live: boolean;
}

/** A cell carries scene life when it is a data cell (a runtime or declared page installs its own) with any of these rows:
 *  any declared water body draws a surface, as a standalone page's `ShardfileClient.world()` draws it. */
export function hasCellSceneLife(source: Shardfile): boolean {
  if (source.runtime !== null || hasDeclaredClientPage(source)) return false;
  return (source.look.details?.length ?? 0) > 0 || (source.look.light?.swings?.length ?? 0) > 0 || (source.look.light?.lamps?.length ?? 0) > 0 || source.water.length > 0;
}

/** The data cells' scene life on this page: admitted with each cell's tiles, stepped in the page's late phase. */
export class CellSceneLife {
  private readonly ports: CellSceneLifePorts;
  private readonly cells = new Map<string, CellScene>();
  /** each admitted product's cells: a product placed twice shares one swing uniform set, so none of its copies swing */
  private readonly products = new Map<string, CellScene[]>();
  private readonly clock = windClockFallback();
  private readonly feet = new Vector3();
  private readonly player: { id: string; x: number; y: number; z: number; radius: number } = { id: 'player', x: 0, y: 0, z: 0, radius: 0.45 };
  private readonly movers: SwingMover[] = [this.player];
  /** the lamps' flicker clock (seconds the entered cell's lamps have lit) and the camera's position for their nearest */
  private lampTime = 0;
  private readonly eye = new Vector3();

  constructor(ports: CellSceneLifePorts) { this.ports = ports; }

  /** Admit one data cell's scene life, once its product and materials are ready (the session's shared per-slug load). Its
   *  detail files are read now (the product's inputs are released after admission); its layers are built on first entry. */
  async admit(cell: GridCell, root: Group, source: Shardfile, assets: { readonly retained: ReadonlyMap<string, Uint8Array>; readonly read: (hash: string) => Promise<Uint8Array> },
    presentation: CellScenePresentation): Promise<void> {
    if (this.cells.has(cell.instance) || !hasCellSceneLife(source)) return;
    const rows = source.look.details;
    const files = await detailLayerFiles(rows, assets.retained, (hash) => assets.read(hash));
    if (this.ports.scope.disposed || this.ports.scope.disposing || this.cells.has(cell.instance)) return;
    // the cell's own scope: a refused row (a swing past 32, a splash that will not build) leaves nothing behind
    const scope = this.ports.scope.child(`grid.scene-life:${cell.instance}`);
    try {
      const frames: ((dt: number) => void)[] = [];
      // ZE3a: hidden unless entered, so an admission between the late phase and the draw never draws it once
      const details = new Group(); details.name = 'cell-scene-details'; details.visible = false; root.add(details);
      scope.onDispose(() => { details.removeFromParent(); });
      const viewer = { x: 0, z: 0 };
      const install = (rows?.length ?? 0) === 0 ? null : (): number => installClientDetails(rows, files, { root: details, scope, materials: presentation.materials,
        phone: this.ports.phone, viewer: () => viewer, frame: (run) => { frames.push((dt) => { this.local(root, viewer); run(dt); }); } }).length;
      const siblings = this.products.get(cell.slug) ?? [], copies = siblings.length + 1;
      // a second copy stills the first before anything writes the shared pivots, and builds no field of its own
      for (const other of siblings) { other.swings?.dispose(); other.swings = null; }
      const swingRows = source.look.light?.swings ?? [];
      const swings = copies > 1 || swingRows.length === 0 || presentation.swings === undefined ? null : new SwingField(swingRows, presentation.swings, root);
      if (swings !== null) scope.onDispose(() => { swings.dispose(); });
      // MZ6: the declared water's surfaces, in the look's `water` material when it has one (as the standalone page)
      const ripples: ((dt: number) => void)[] = [];
      const water = installClientWater(source.water, { root, scope, materials: presentation.materials, frame: (run) => { ripples.push(run); } }, this.ports.phone ? 'phone' : 'desktop');
      const mirrors = water.filter((mesh) => (mesh as Mesh & { isReflector?: boolean }).isReflector === true);
      for (const mirror of mirrors) mirror.visible = false;
      frames.push(...ripples);
      const splashFeet = { id: 'player', x: 0, y: 0, z: 0 };
      const splash = installClientSplash(source.water, { root, scope, phone: this.ports.phone,
        movers: () => { this.local(root, splashFeet); return [splashFeet]; },
        frame: (run) => { frames.push(run); } }) !== null;
      // the lamps ride the cell's swings as they stand each frame (a second copy nulls them)
      const self: { scene: CellScene | null } = { scene: null };
      const lamps = this.lamps(source, root, scope, () => self.scene?.swings ?? null);
      const scene: CellScene = { cell, details, install, installed: install === null, layers: 0, swings, frames, water, mirrors, splash, lamps, lampsDeclared: source.look.light?.lamps?.length ?? 0, live: false };
      self.scene = scene;
      this.products.set(cell.slug, [...siblings, scene]);
      this.cells.set(cell.instance, scene);
    } catch (error) { scope.dispose(); throw error; }
  }

  /** QA 11-25 row 138: the cell's declared look lamps under `root`, hidden until entered, shown through the page pool's
   *  reserved lights; null when it declares none, the Look light row is off, or the page has no reserve to show them. */
  private lamps(source: Shardfile, root: Group, scope: Scope, swingsOf: () => SwingField | null): ReturnType<typeof lampLights> | null {
    const rows = source.look.light?.lamps ?? [], pool = this.ports.lights;
    if (rows.length === 0 || pool === undefined || pool.reservedSize === 0 || !(this.ports.lookLight ?? lookLightOn)()) return null;
    const lit = Math.min(this.ports.phone ? PHONE_LAMPS : DESKTOP_LAMPS, pool.reservedSize);
    const group = lampLights(rows, lit, swingsOf);
    group.visible = false; // named 'look-light-lamps' as on a standalone page (lampLights), so tools find it the same way
    root.add(group);
    pool.show(group.children as PointLight[], scope);
    scope.onDispose(() => { group.removeFromParent(); for (const light of group.children as PointLight[]) light.dispose(); });
    return group;
  }

  /** The feet in `root`'s own metres, written into `out` (x, z; y when it has one). */
  private local(root: Group, out: { x: number; z: number; y?: number }): void {
    const feet = this.ports.feet(), at = this.feet.set(feet.x, feet.y, feet.z);
    root.updateWorldMatrix(true, false); root.worldToLocal(at);
    out.x = at.x; out.z = at.z; if ('y' in out) out.y = at.y;
  }

  /** The page's late phase: the entered cell's layers follow the viewer, its swings and splash step; the rest hold still. */
  late(dt: number): void {
    if (this.cells.size === 0) return;
    let stepped = false;
    for (const scene of this.cells.values()) {
      const live = this.ports.active(scene.cell.instance);
      // leaving the cell stills its swings: the shared uniforms never keep a lean, and re-entry starts from rest
      if (!live) {
        scene.details.visible = false; for (const mirror of scene.mirrors) mirror.visible = false; if (scene.lamps !== null) scene.lamps.visible = false;
        if (scene.live) scene.swings?.dispose(); scene.live = false; continue;
      }
      if (!scene.installed) {
        scene.installed = true;
        try { scene.layers = scene.install?.() ?? 0; } catch (error) { console.warn(`[grid] ${scene.cell.instance} draws no detail layers:`, error); }
      }
      scene.details.visible = true; scene.live = true;
      for (const mirror of scene.mirrors) mirror.visible = true;
      if (!stepped) { this.clock(dt); stepped = true; }
      for (const run of scene.frames) run(dt);
      if (scene.swings !== null) {
        const feet = this.ports.feet();
        this.player.x = feet.x; this.player.y = feet.y; this.player.z = feet.z;
        scene.swings.update(dt, this.movers);
      }
      if (scene.lamps !== null) {
        // after the swings: a lamp on a swing goes where its lantern swung this frame
        scene.lamps.visible = true; this.lampTime += dt;
        if (scene.lamps.update !== null) {
          const eye = this.ports.eye?.(this.eye) ?? (() => { const feet = this.ports.feet(); return this.eye.set(feet.x, feet.y, feet.z); })();
          scene.lamps.update(this.lampTime, eye);
        }
      }
    }
  }

  state(): CellSceneLifeCell[] {
    return [...this.cells.values()].map((scene) => ({ instance: scene.cell.instance, layers: scene.layers, swings: scene.swings?.count ?? 0, water: scene.water.length, splash: scene.splash, live: scene.live,
      lampsDeclared: scene.lampsDeclared, lamps: scene.lamps?.children.length ?? 0, lampsLit: scene.live ? scene.lamps?.children.filter((light) => (light as PointLight).intensity > 0).length ?? 0 : 0 }));
  }
}
