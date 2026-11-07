/**
 * The border shimmer (SHARD-PLATFORM SF20a look, Jake's G78 "B: shimmer + HUD dim"; G119): a thin cyan shimmer line on
 * the ground at every shard cell's border, the same language as G85's soft wall and G89's void rail, in the road's
 * reserved HUD cyan. It follows each border's real ground (the cell's declared edge rows, the same heights the strips
 * start from), glows brightest at its foot and fades out with distance, so only the borders near the traveller read.
 *
 * G119: while a crossing waits for its durable save the shimmer nearest the traveller carries a "SAVING…" panel, and on a
 * refused save "SAVE FAILED, RETRY" (an explicit retry or safe retreat), so the hold never looks like a bug.
 *
 * One draw for every border (a ribbon per side) plus the panel's two quads, shown only while a status is up.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, SRGBColorSpace, ShaderMaterial } from 'three';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { StripProfile } from '@wildshard/engine/sim/strips';
import type { LookScope } from '../../../shared/game/grid/roadLayout';
import type { GridCrossingState } from '../../../shared/game/grid/crossing';

/** One cell's border in the home frame: its centre and its four declared edge rows (index 0 at the west / south end). */
export interface ShimmerCell { readonly x: number; readonly z: number; readonly edges: Readonly<Record<'north' | 'east' | 'south' | 'west', StripProfile>> | null }
/** G119: what the panel says (null: no panel). */
export type CrossingSaveStatus = 'saving' | 'failed' | null;
/** The readout. */
export interface BorderShimmerState { readonly borders: number; readonly status: CrossingSaveStatus }

const SEGMENTS = 64, HEIGHT = 1.5, FOOT = 0.25, PANEL_RANGE = 40, CYAN = new Color(0x8fe3ff);
/** Within this many metres of the eye the ribbon stays a line: its foot glow thins with the distance, its rise fades. */
const CLOSE = 12;
/** The crossing's refusal when its source checkpoint is not durable (`GridCrossing.step`). */
const NOT_DURABLE = 'Local checkpoint is not durable';

/** G119 from the crossing's telemetry: a refused durable save, else a crossing on its way (preparing / waiting to commit). */
export function crossingSaveStatus(state: GridCrossingState | null | undefined): CrossingSaveStatus {
  if (state === null || state === undefined) return null;
  if (state.phase === 'save-failed' || state.issue === NOT_DURABLE) return 'failed';
  if (state.target !== state.current && (state.phase === 'save-pending' || state.phase === 'ready')) return 'saving';
  return null;
}

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragment = /* glsl */ `
uniform vec3 uColour;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float d = length(vWorld.xz - cameraPosition.xz);
  float near = 1.0 - smoothstep(70.0, 150.0, d);
  if (near <= 0.0) discard;
  float h = vUv.y; // metres above the line's foot
  // up close the ribbon stands across the view (a road socket's lip is a few metres from it): its foot glow keeps the
  // height it shows from CLOSE metres and its rise fades out, so it stays a line on the ground, never a glowing sheet
  float eye = max(length(vWorld - cameraPosition), 0.01);
  float thin = max(1.0, ${CLOSE.toFixed(1)} / eye);
  float close = smoothstep(${(CLOSE / 4).toFixed(1)}, ${CLOSE.toFixed(1)}, eye);
  float foot = exp(-abs(h - ${FOOT.toFixed(2)}) * 5.0 * thin);
  float streak = pow(0.5 + 0.5 * sin(vUv.x * 2.1 + uTime * 1.7) * sin(vUv.x * 0.37 - uTime * 0.9), 6.0);
  float rise = (1.0 - smoothstep(${FOOT.toFixed(2)}, ${HEIGHT.toFixed(2)}, h)) * step(${FOOT.toFixed(2)}, h);
  float shimmer = 0.75 + 0.25 * sin(vUv.x * 0.6 - uTime * 3.0);
  float a = (foot * 1.7 * shimmer + (streak * rise * 0.7 + rise * 0.08) * close) * near;
  gl_FragColor = vec4(uColour * a, 1.0);
}`;

/** The ribbons: each side SEGMENTS long, from just under the ground to HEIGHT above it, uv = (metres along, metres up). */
function ribbons(cells: readonly ShimmerCell[]): BufferGeometry {
  const sides = cells.length * 4, verts = (SEGMENTS + 1) * 2;
  const position = new Float32Array(sides * verts * 3), uv = new Float32Array(sides * verts * 2), index: number[] = [];
  let side = 0;
  for (const cell of cells) {
    const rows: readonly { name: 'north' | 'east' | 'south' | 'west'; fixed: 'x' | 'z'; at: number }[] = [
      { name: 'north', fixed: 'z', at: CHUNK_HALF }, { name: 'south', fixed: 'z', at: -CHUNK_HALF }, { name: 'east', fixed: 'x', at: CHUNK_HALF }, { name: 'west', fixed: 'x', at: -CHUNK_HALF },
    ];
    for (const row of rows) {
      const heights = cell.edges?.[row.name].heights ?? [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS, s = -CHUNK_HALF + t * 2 * CHUNK_HALF;
        const f = t * Math.max(0, heights.length - 1), i0 = Math.floor(f), i1 = Math.min(heights.length - 1, i0 + 1);
        // an edge under water (a shore cell) shows its line on the surface, at road level
        const ground = Math.max(0, heights.length === 0 ? 0 : (heights[i0] ?? 0) + ((heights[i1] ?? 0) - (heights[i0] ?? 0)) * (f - i0));
        const x = cell.x + (row.fixed === 'x' ? row.at : s), z = cell.z + (row.fixed === 'z' ? row.at : s);
        const v = side * verts + i * 2;
        position.set([x, ground - FOOT, z, x, ground + HEIGHT - FOOT, z], v * 3); // the top vertex stands over its foot (it had no z: every ribbon leaned to z = 0 as a vast cyan sheet)
        uv.set([s + CHUNK_HALF, 0, s + CHUNK_HALF, HEIGHT], v * 2);
        if (i < SEGMENTS) index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
      side++;
    }
  }
  const g = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3)).setAttribute('uv', new BufferAttribute(uv, 2)).setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** The panel's label: the status in white on the road's navy glass, a cyan rule under it (red-amber on a failure). */
function label(text: string, failed: boolean): CanvasTexture {
  const el = document.createElement('canvas'); el.width = 512; el.height = 128;
  const g = el.getContext('2d');
  if (g !== null) {
    g.fillStyle = 'rgba(6,16,28,0.84)'; g.fillRect(0, 0, 512, 128);
    const accent = failed ? '#ffb547' : '#8fe3ff';
    g.strokeStyle = accent; g.lineWidth = 3; g.strokeRect(2, 2, 508, 124);
    g.fillStyle = '#eef9ff'; g.font = '600 40px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width;
    g.save(); g.translate(256, 58); g.scale(Math.min(1, 470 / Math.max(1, w)), 1); g.fillText(text, 0, 0); g.restore();
    g.fillStyle = accent; g.fillRect(176, 96, 160, 4);
  }
  const texture = new CanvasTexture(el); texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** What the shimmer reads each fixed step. */
export interface BorderShimmerPorts {
  /** the traveller's feet in the home frame */
  readonly feet: () => { readonly x: number; readonly z: number };
  /** G119: the crossing's save status now */
  readonly status: () => CrossingSaveStatus;
  /** the panel's words for a status */
  readonly text: (status: 'saving' | 'failed') => string;
}

/** Draw every cell's border shimmer; `step` runs each fixed step (the time, the G119 panel). */
export function installBorderShimmer(input: { readonly cells: readonly ShimmerCell[]; readonly ports: BorderShimmerPorts; readonly scene: Object3D; readonly scope: LookScope; readonly time: () => number }): { step: () => void; state: () => BorderShimmerState } {
  const { cells, ports, scene, scope } = input, group = new Group();
  group.name = 'grid-border-shimmer';
  const uTime = { value: 0 };
  const material = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
    uniforms: { uColour: { value: CYAN }, uTime } });
  const line = new Mesh(ribbons(cells), material);
  line.name = 'grid-border-shimmer-line'; line.frustumCulled = false; line.renderOrder = 2;
  const labelMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: DoubleSide });
  const panel = new Mesh(new PlaneGeometry(2.4, 0.6), labelMaterial);
  panel.name = 'grid-border-save'; panel.renderOrder = 5; panel.visible = false;
  group.add(line, panel); scene.add(group);
  let shown: CrossingSaveStatus = null, since = 0, holdUntil = 0;
  const step = (): void => {
    const now = input.time(); uTime.value = now;
    const status = ports.status();
    // a crossing that commits within a blink shows nothing; a shown status holds long enough to read
    if (status !== null && since === 0) since = now;
    if (status === null) since = 0;
    const want: CrossingSaveStatus = status !== null && (status === 'failed' || now - since > 0.15) ? status : now < holdUntil ? shown : null;
    if (want !== null && status !== null) holdUntil = now + 0.8;
    const feet = ports.feet();
    // the nearest border of the cell whose square the feet are nearest (the one being crossed)
    let best: { x: number; z: number; ry: number; d: number } | null = null;
    for (const cell of cells) {
      const lx = feet.x - cell.x, lz = feet.z - cell.z;
      const sx = Math.max(-CHUNK_HALF + 1.5, Math.min(CHUNK_HALF - 1.5, lx)), sz = Math.max(-CHUNK_HALF + 1.5, Math.min(CHUNK_HALF - 1.5, lz));
      const candidates = [{ x: cell.x + sx, z: cell.z + CHUNK_HALF, d: Math.abs(lz - CHUNK_HALF) + Math.abs(lx - sx), ry: lz > CHUNK_HALF ? 0 : Math.PI },
        { x: cell.x + sx, z: cell.z - CHUNK_HALF, d: Math.abs(lz + CHUNK_HALF) + Math.abs(lx - sx), ry: lz < -CHUNK_HALF ? Math.PI : 0 },
        { x: cell.x + CHUNK_HALF, z: cell.z + sz, d: Math.abs(lx - CHUNK_HALF) + Math.abs(lz - sz), ry: lx > CHUNK_HALF ? Math.PI / 2 : -Math.PI / 2 },
        { x: cell.x - CHUNK_HALF, z: cell.z + sz, d: Math.abs(lx + CHUNK_HALF) + Math.abs(lz - sz), ry: lx < -CHUNK_HALF ? -Math.PI / 2 : Math.PI / 2 }];
      for (const c of candidates) if (best === null || c.d < best.d) best = c;
    }
    if (want === null || best === null || best.d > PANEL_RANGE) { panel.visible = false; if (want === null) shown = null; return; }
    if (want !== shown) {
      shown = want;
      labelMaterial.map?.dispose(); labelMaterial.map = label(ports.text(want), want === 'failed'); labelMaterial.needsUpdate = true;
    }
    // stands on the line where the traveller meets it, at eye height, facing back at them
    panel.position.set(best.x, 1.9 + groundNear(cells, best.x, best.z), best.z); panel.rotation.set(0, best.ry, 0);
    panel.visible = true;
  };
  scope.onDispose(() => { group.removeFromParent(); line.geometry.dispose(); material.dispose(); panel.geometry.dispose(); labelMaterial.map?.dispose(); labelMaterial.dispose(); });
  return { step, state: () => ({ borders: cells.length * 4, status: panel.visible ? shown : null }) };
}

/** The border's ground at a point on it (the nearest cell's edge row), 0 without rows. */
function groundNear(cells: readonly ShimmerCell[], x: number, z: number): number {
  for (const cell of cells) {
    const lx = x - cell.x, lz = z - cell.z;
    if (Math.abs(lx) > CHUNK_HALF + 0.01 || Math.abs(lz) > CHUNK_HALF + 0.01 || cell.edges === null) continue;
    const row = Math.abs(lz) >= CHUNK_HALF - 0.01 ? cell.edges[lz > 0 ? 'north' : 'south'] : cell.edges[lx > 0 ? 'east' : 'west'];
    const s = Math.abs(lz) >= CHUNK_HALF - 0.01 ? lx : lz, f = ((s + CHUNK_HALF) / (2 * CHUNK_HALF)) * (row.heights.length - 1);
    return Math.max(0, row.heights[Math.max(0, Math.min(row.heights.length - 1, Math.round(f)))] ?? 0);
  }
  return 0;
}
