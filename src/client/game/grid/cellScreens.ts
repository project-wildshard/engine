/**
 * G578 (Jake, 2026-10-21: on the grid a cell load never leaves the 3D world): the waiting cell's loading steps on an
 * in-world screen at its edge, the same rows as the loading screen (`loadingPath('cell')`): each step done, the one now with
 * its detail, the rest to come, or why it refused. It stands over the road where the traveller meets the closed wall (the
 * soft wall's edge midpoint), 12 m beyond the wall and facing out, so a traveller held at the wall reads all of it (closer,
 * the 9 m panel overflows a portrait view; on the traveller's side it stood behind the camera). It draws over the cell's
 * ground (no depth test): the road and the other cells stay live around it while the cell's boundary holds. Presentation
 * only: it reads the session's step, and owns one canvas.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, SRGBColorSpace } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SoftWallEdge } from './softWallLook';

/** One row of the screen: its label and whether it is done, running now (with the detail) or still to come. */
export interface CellScreenRow { readonly label: string; readonly state: 'done' | 'now' | 'next' }
/** What the screen shows: whose cell, its rows, the running step's detail, or the refusal instead of the rows. */
export interface CellScreenView { readonly name: string; readonly rows: readonly CellScreenRow[]; readonly detail: string; readonly failed: string | null }

/** The side of a cell (`sides`, its four edges around `centre`) the traveller faces from `dx`, `dz` (their offset from the
 *  cell's centre): the axis they are further along, on their side; one standing at the very centre gets the +x side. */
export function facingEdge<E extends { readonly x: number; readonly z: number; readonly axis: 'x' | 'z' }>(sides: readonly E[],
  centre: { readonly x: number; readonly z: number }, dx: number, dz: number): E | undefined {
  const sx = dx < 0 ? -1 : 1, sz = dz < 0 ? -1 : 1;
  return Math.abs(dx) >= Math.abs(dz) ? sides.find(row => row.axis === 'x' && Math.sign(row.x - centre.x) === sx)
    : sides.find(row => row.axis === 'z' && Math.sign(row.z - centre.z) === sz);
}

const W = 1024, H = 576, WIDTH = 9, HEIGHT = WIDTH * H / W, LIFT = 1, IN = 12;
const CYAN = '#38e6ff', DIM = 'rgba(205, 240, 255, 0.55)', FONT = 'system-ui, -apple-system, sans-serif';

/** The one in-world loading screen, moved to whichever cell the traveller waits at. */
export class CellScreen {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly texture: CanvasTexture<HTMLCanvasElement | OffscreenCanvas>;
  private readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private drawn = '';
  constructor(parent: Object3D, scope: Scope) {
    this.canvas = typeof document === 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.texture = scope.own(new CanvasTexture(this.canvas)); this.texture.colorSpace = SRGBColorSpace;
    const material = scope.own(new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.mesh = new Mesh(scope.own(new PlaneGeometry(WIDTH, HEIGHT)), material);
    this.mesh.name = 'cell-loading-screen'; this.mesh.visible = false; this.mesh.renderOrder = 20; this.mesh.frustumCulled = false;
    parent.add(this.mesh); scope.onDispose(() => { this.mesh.removeFromParent(); });
  }

  /** Stand beyond `edge` (the waiting cell's closed wall in the home frame), facing the traveller outside it, and draw `view`. */
  show(edge: SoftWallEdge, cell: { readonly x: number; readonly z: number }, ground: number, view: CellScreenView): void {
    const outward = edge.axis === 'x' ? Math.sign(edge.x - cell.x) : Math.sign(edge.z - cell.z);
    const x = edge.axis === 'x' ? edge.x - outward * IN : edge.x, z = edge.axis === 'z' ? edge.z - outward * IN : edge.z;
    this.mesh.position.set(x, ground + LIFT + HEIGHT / 2, z);
    // the (front) face looks out of the cell, toward the traveller on the road
    this.mesh.rotation.set(0, edge.axis === 'x' ? (outward > 0 ? Math.PI / 2 : -Math.PI / 2) : (outward > 0 ? 0 : Math.PI), 0);
    this.mesh.updateMatrixWorld();
    this.mesh.visible = true;
    const key = JSON.stringify(view);
    if (key !== this.drawn) { this.drawn = key; this.draw(view); }
  }
  /** Hide it (the cell is ready, or no cell is waiting). */
  hide(): void { this.mesh.visible = false; }
  get visible(): boolean { return this.mesh.visible; }

  private draw(view: CellScreenView): void {
    const g = this.canvas.getContext('2d');
    if (g === null) throw new Error('Cell screen has no 2D context');
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(4, 18, 28, 0.82)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = CYAN; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = CYAN; g.font = `700 54px ${FONT}`; g.textBaseline = 'top';
    g.fillText(view.name.toUpperCase(), 44, 34);
    if (view.failed !== null) {
      g.fillStyle = '#ff9a7a'; g.font = `600 36px ${FONT}`; g.fillText(view.failed.slice(0, 48), 44, 130);
    } else {
      g.font = `500 32px ${FONT}`;
      view.rows.forEach((row, i) => {
        const y = 118 + i * 52;
        g.fillStyle = row.state === 'next' ? DIM : row.state === 'now' ? CYAN : '#ffffff';
        g.fillText(`${row.state === 'done' ? '✓' : row.state === 'now' ? '▶' : '·'}  ${row.label}`, 44, y);
      });
      g.fillStyle = DIM; g.font = `400 28px ${FONT}`; g.fillText(view.detail.slice(0, 60), 44, H - 64);
    }
    this.texture.needsUpdate = true;
  }
}
