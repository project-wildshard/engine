/**
 * A grid neighbour's declared panels (G222 playtest #7): the doors and gates a shardfile shows and hides through
 * `targets.panels`. The ring tiles carry only the baked props, so before this a neighbour's door was never drawn while its
 * region's collider still stood in the doorway: an invisible wall in a doorway that looked open, and a door that, once
 * opened, let the board into a hut that looked no different. Each cell now draws its panels in its own root and shows each
 * one exactly when its region says the panel is there: the region's collider state when the region is admitted (the
 * region's sim drives it from the published field, `syncTargetColliders`), else the field's declared default.
 *
 * Presentation only: nothing here writes a simulation, a field or a collider.
 */
import { Euler, Matrix4, Quaternion, Vector3, type Group, type Object3D } from 'three';
import type { MoverPose } from '@wildshard/engine/physics/mover';
import type { ClientTileViews } from '../shardfile/clientViews';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { GridCell } from '../../../shared/game/grid/assembly';
import type { ProbeAreaTarget } from '@wildshard/engine/debug/probe';
import { wirePage } from '../shardfile/wirePage';

/** What the panels read of a cell the live host has admitted: the solids of its world, and a field's row where this page has one. */
export interface PanelRegion { readonly colliders: ReadonlyMap<string, { readonly active: () => boolean; readonly setActive: (active: boolean) => void }>; readonly field: (name: string) => number | undefined }
/** The page scope the panels live and die with (the views' own scope type). */
type PageScope = Parameters<ClientTileViews['panels']>[3];
export interface NeighbourPanelPorts {
  readonly scope: PageScope; readonly region: (instance: string) => PanelRegion | undefined;
  /** the page's warm-up for a newly drawn root (the session's `prepareView`): compiled before the panel first draws */
  readonly prepare?: (root: Object3D, current: () => boolean) => Promise<void>;
}
type TargetRow = Shardfile['targets']['panels'][number];
interface Binding { readonly row: TargetRow; readonly panel: Object3D; readonly fallback: number }
interface CellPanels { readonly instance: string; readonly source: Shardfile; readonly bindings: readonly Binding[] }

/** A declared field default as the script world holds it (a bool is 0 / 1; text never matches a number). */
function numeric(value: boolean | number | string | undefined): number {
  return typeof value === 'boolean' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
}

/** Whether a target row's condition holds now: through the field's row where the page has one, else its default. */
export function targetMatched(row: TargetRow, fallback: number, region: PanelRegion | undefined, source: Shardfile): boolean {
  const field = source.state[row.scope].find((f) => f.id === row.fieldId);
  return ((field === undefined ? undefined : region?.field(field.name)) ?? fallback) === row.equals;
}

/** TEMPLATE-E2E TC-E5b: pose a mover's panel. The panel was baked where the mover rests (its `at` and `euler`), so each
 *  pose sets the panel to (pose) x (rest)^-1 x (its baked transform): it turns about the mover's own origin, as the server's
 *  body does. Presentation only: the mover's collider is the server's. */
export function moverPanelPose(panel: Object3D, rest: { readonly at: { x: number; y: number; z: number }; readonly euler: { x: number; y: number; z: number } }): (pose: MoverPose) => void {
  const one = new Vector3(1, 1, 1), euler = new Euler(0, 0, 0, 'YXZ'), q = new Quaternion(), at = new Vector3();
  panel.updateMatrix();
  const baked = panel.matrix.clone(), restInverse = new Matrix4().compose(new Vector3(rest.at.x, rest.at.y, rest.at.z),
    q.setFromEuler(euler.set(rest.euler.x, rest.euler.y, rest.euler.z, 'YXZ')).clone(), one).invert();
  const now = new Matrix4();
  return (pose) => {
    now.compose(at.set(pose.position.x, pose.position.y, pose.position.z), q.setFromEuler(euler.set(pose.euler.x, pose.euler.y, pose.euler.z, 'YXZ')), one)
      .multiply(restInverse).multiply(baked);
    now.decompose(panel.position, panel.quaternion, panel.scale); panel.updateMatrix(); // a frame-floored root walks no matrices
    panel.visible = pose.enabled;
  };
}

/** The page's neighbour panels: one set per shardfile neighbour whose targets show or hide a panel; disposed with the scope. */
export class NeighbourPanels {
  private readonly ports: NeighbourPanelPorts;
  private readonly cells = new Map<string, CellPanels>();
  constructor(ports: NeighbourPanelPorts) { this.ports = ports; }

  /** Draw one neighbour's declared panels in its cell root (the session's shared per-slug load supplies views and bytes). */
  async admit(cell: GridCell, root: Group, source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, views: ClientTileViews): Promise<void> {
    const props = source.props;
    if (props === null || props.panels.length === 0 || source.targets.panels.length === 0 && source.movers.length === 0 || this.cells.has(cell.instance)) return;
    const panels = await views.panels(props, assets, root, this.ports.scope);
    if (this.ports.scope.disposed) return;
    // a panel's programs compile in the page's warm-up, off the drive's frames: hidden until then, then shown by sync
    const prepare = this.ports.prepare;
    if (prepare !== undefined) {
      for (const panel of panels.values()) panel.visible = false;
      for (const panel of panels.values()) await prepare(panel, () => !this.ports.scope.disposed && panel.parent !== null);
    }
    const bindings = source.targets.panels.map((row): Binding => {
      const panel = panels.get(row.panel); if (panel === undefined) throw new Error('Missing admitted target panel');
      const field = source.state[row.scope].find((f) => f.id === row.fieldId);
      return { row, panel, fallback: numeric(field?.default) };
    });
    const cellPanels: CellPanels = { instance: cell.instance, source, bindings };
    this.cells.set(cell.instance, cellPanels);
    // TEMPLATE-E2E TC-E5b: a mover's look is the props panel with its id; the wire's pose for it moves that panel. A data cell
    // the page walks in has its own view for that id (its collider, `dataCellMovers.ts`), which poses this look too.
    for (const row of source.movers) {
      const panel = panels.get(row.id); if (panel === undefined) continue;
      const view = { pose: moverPanelPose(panel, row) };
      panel.visible = row.enabled; // drawn at rest until the wire poses it (review SHOULD)
      wirePage.moverLooks.set(row.id, view);
      if (!wirePage.movers.has(row.id)) wirePage.movers.set(row.id, view);
      this.ports.scope.onDispose(() => {
        if (wirePage.moverLooks.get(row.id) === view) wirePage.moverLooks.delete(row.id);
        if (wirePage.movers.get(row.id) === view) wirePage.movers.delete(row.id);
      });
    }
    this.sync(cellPanels);
  }

  /** The page's late phase: every panel shown exactly when its region has it standing. */
  late(): void { for (const cell of this.cells.values()) this.sync(cell); }

  /** The drawn panels' visibility per cell (tests and the probe). */
  state(): ReadonlyMap<string, readonly { panel: string; visible: boolean }[]> {
    return new Map([...this.cells].map(([id, cell]) => [id, cell.bindings.map((b) => ({ panel: b.row.panel, visible: b.panel.visible }))]));
  }

  /** A cell's door panels as the probe reads them (T2E-1b): drawn, and solid while every collider stands in its admitted
   *  region (a panel with no colliders reads solid, as `shardfile.targets()` does). */
  targets(instance: string): readonly ProbeAreaTarget[] {
    const cell = this.cells.get(instance), region = this.ports.region(instance);
    return cell?.bindings.map(({ row, panel }) => ({ panel: row.panel, visible: panel.visible,
      solid: region !== undefined && row.colliders.every(id => region.colliders.get(id)?.active() === true) })) ?? [];
  }

  private sync(cell: CellPanels): void {
    const region = this.ports.region(cell.instance);
    for (const { row, panel, fallback } of cell.bindings) {
      const matched = targetMatched(row, fallback, region, cell.source);
      panel.visible = matched === row.visibleWhenMatched;
      for (const id of row.colliders) region?.colliders.get(id)?.setActive(matched === row.activeWhenMatched);
    }
  }
}
