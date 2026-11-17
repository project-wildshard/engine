/**
 * A data cell's scene life on a grid page (meta SHARD-SOURCE SS-SHIPb): its look's detail layers (AP32d1: grass, ferns), its
 * hung lanterns and signs (SS8c: `look.light.swings`), its pools' splash (SS6) and the wind clock they sway on (SS8a).
 *
 * A standalone page installs these in `ShardfileClient.world()` (`shardfile/client.ts`). A grid cell never runs that: the
 * session draws a data cell through its tile admission (`session.ts`), which compiles the look's materials, and so their
 * swing uniforms, but nothing wrote them, drew the layers or advanced the clock. On staging v0.1.33 Mossgate's lanterns
 * hung still (within 0.4 px over 5 s) and its yard had no detail grass, though the devserver page showed both.
 *
 * Like `NeighbourLife`, only the entered cell lives (G663: a neighbour is scene-graph level of detail, with no logic): its
 * layers draw and follow the viewer, its swings and splash step; a neighbour's layers are hidden and its swings stilled.
 * A product's copies share one compiled material set and so one set of swing uniforms (world-space pivots), so a slug
 * placed more than once keeps its swings still rather than turn one copy's lanterns round another's pivots.
 */
import { Group, Vector3, type Material } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { windClockFallback } from '@wildshard/engine/world/wind';
import { SwingField, type SwingMover, type SwingUniforms } from '@wildshard/engine/world/swings';
import type { DetailLayer } from '@wildshard/engine/world/detailLayer';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { detailLayerFiles, installClientDetails } from '../shardfile/clientDetails';
import { installClientSplash } from '../shardfile/clientSplash';
import type { GridCell } from '../../../shared/game/grid/assembly';

/** What a cell's scene life reads from the session. */
export interface CellSceneLifePorts {
  readonly scope: Scope;
  /** the phone tier grows half the detail radius and slots */
  readonly phone: boolean;
  /** the traveller's feet, world metres */
  readonly feet: () => { readonly x: number; readonly y: number; readonly z: number };
  /** whether the traveller is in this cell (the active frame) */
  readonly active: (instance: string) => boolean;
}

/** The cell's compiled look, as the session's tile admission holds it per slug. */
export interface CellScenePresentation {
  readonly materials: ReadonlyMap<string, Material>;
  /** absent: its surfaces bind none (nothing on it swings) */
  readonly swings: SwingUniforms | undefined;
}

/** One cell's readout. */
export interface CellSceneLifeCell { readonly instance: string; readonly layers: number; readonly swings: number; readonly splash: boolean; readonly live: boolean }

interface CellScene {
  readonly cell: GridCell;
  readonly root: Group;
  /** the detail layers' holder, shown only while the cell is entered */
  readonly details: Group;
  readonly layers: readonly DetailLayer[];
  readonly swings: SwingField | null;
  /** per-frame runs (the layers' ring, the splash), stepped only while entered */
  readonly frames: ((dt: number) => void)[];
  splash: boolean;
  live: boolean;
}

/** A cell carries scene life when it is a data cell (a runtime or declared page installs its own) with any of these rows. */
export function hasCellSceneLife(source: Shardfile): boolean {
  if (source.runtime !== null || hasDeclaredClientPage(source)) return false;
  return (source.look.details?.length ?? 0) > 0 || (source.look.light?.swings?.length ?? 0) > 0 || source.water.some(body => body.kind === 'pool' && body.surface !== undefined);
}

/** The data cells' scene life on this page: admitted with each cell's tiles, stepped in the page's late phase. */
export class CellSceneLife {
  private readonly ports: CellSceneLifePorts;
  private readonly cells = new Map<string, CellScene>();
  private readonly clock = windClockFallback();
  private readonly feet = new Vector3();
  private readonly player: { id: string; x: number; y: number; z: number; radius: number } = { id: 'player', x: 0, y: 0, z: 0, radius: 0.45 };
  private readonly movers: SwingMover[] = [this.player];

  constructor(ports: CellSceneLifePorts) { this.ports = ports; }

  /** Admit one data cell's scene life, once its product and materials are ready (the session's shared per-slug load). */
  async admit(cell: GridCell, root: Group, source: Shardfile, assets: { readonly retained: ReadonlyMap<string, Uint8Array>; readonly read: (hash: string) => Promise<Uint8Array> },
    presentation: CellScenePresentation): Promise<void> {
    if (this.cells.has(cell.instance) || !hasCellSceneLife(source)) return;
    const scope = this.ports.scope, rows = source.look.details;
    const files = await detailLayerFiles(rows, assets.retained, (hash) => assets.read(hash));
    if (scope.disposed || this.cells.has(cell.instance)) return;
    const live = this.ports.active(cell.instance), frames: ((dt: number) => void)[] = [];
    // ZE3a: hidden from birth unless entered, so an admission between the late phase and the draw never draws it once
    const details = new Group(); details.name = 'cell-scene-details'; details.visible = live; root.add(details);
    scope.onDispose(() => { details.removeFromParent(); });
    const local = { x: 0, z: 0 };
    const layers = installClientDetails(rows, files, { root: details, scope, materials: presentation.materials, phone: this.ports.phone,
      viewer: () => local, frame: (run) => { frames.push((dt) => { this.local(root, local); run(dt); }); } });
    const swingRows = source.look.light?.swings ?? [];
    const swings = swingRows.length === 0 || presentation.swings === undefined ? null : new SwingField(swingRows, presentation.swings, root);
    if (swings !== null) scope.onDispose(() => { swings.dispose(); });
    const scene: CellScene = { cell, root, details, layers, swings, frames, splash: false, live };
    const splashFeet = { id: 'player', x: 0, y: 0, z: 0 };
    scene.splash = installClientSplash(source.water, { root, scope, phone: this.ports.phone,
      movers: () => { this.local(root, splashFeet); return [splashFeet]; },
      frame: (run) => { frames.push(run); } }) !== null;
    this.cells.set(cell.instance, scene);
  }

  /** The feet in `root`'s own metres, written into `out` (x, z; y when it has one); returns the local point. */
  private local(root: Group, out: { x: number; z: number; y?: number }): Vector3 {
    const feet = this.ports.feet(), at = this.feet.set(feet.x, feet.y, feet.z);
    root.updateWorldMatrix(true, false); root.worldToLocal(at);
    out.x = at.x; out.z = at.z; if ('y' in out) out.y = at.y;
    return at;
  }

  /** The page's late phase: the entered cell's layers follow the viewer, its swings and splash step; the rest hold still. */
  late(dt: number): void {
    if (this.cells.size === 0) return;
    let stepped = false;
    const copies = new Map<string, number>();
    for (const scene of this.cells.values()) copies.set(scene.cell.slug, (copies.get(scene.cell.slug) ?? 0) + 1);
    for (const scene of this.cells.values()) {
      const live = this.ports.active(scene.cell.instance);
      scene.details.visible = live;
      // leaving the cell stills its swings: the shared uniforms never keep a lean the next copy would turn round
      if (!live) { if (scene.live) scene.swings?.dispose(); scene.live = false; continue; }
      scene.live = true;
      if (!stepped) { this.clock(dt); stepped = true; }
      for (const run of scene.frames) run(dt);
      if (scene.swings !== null && (copies.get(scene.cell.slug) ?? 0) === 1) {
        const feet = this.ports.feet();
        this.player.x = feet.x; this.player.y = feet.y; this.player.z = feet.z;
        scene.swings.update(dt, this.movers);
      }
    }
  }

  state(): CellSceneLifeCell[] {
    return [...this.cells.values()].map((scene) => ({ instance: scene.cell.instance, layers: scene.layers.length, swings: scene.swings?.count ?? 0, splash: scene.splash, live: scene.live }));
  }
}
