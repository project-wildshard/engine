import { engineString } from '../../../../shared/engine/strings';
/**
 * The playgrounds' developer look (E307, Jake: "clearly-developer graphics … the Counter-Strike Source maps with developer
 * textures"): flat grey and orange measure tiles, a 1 m grid in a 4 m tile, every box face shaded by its facing so the
 * forms read without any light, and the whole level merged into one draw per tone.
 *
 *   const kit = new DevKit();
 *   kit.box('grey', x, y, z, sx, sy, sz)     // a box by its centre and size, world space; UVs in metres (world-aligned)
 *   kit.plane('dark', x, y, z, sx, sz)       // a floor quad facing up
 *   const group = kit.build()                // one Mesh per tone used
 *
 * Unlit (MeshBasicMaterial) and fogless on purpose: the dev level looks the same on every shard's grade and sky.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type DevTone = 'grey' | 'orange' | 'dark' | 'light' | 'sand' | 'field';

/** base / 1 m line / 4 m border / stamp, sRGB */
const TONES: Record<DevTone, readonly [string, string, string, string]> = {
  grey: ['#9ba0a6', '#868b91', '#6c7177', '#5d6268'],
  orange: ['#e2843a', '#cc702a', '#b0591b', '#8f4512'],
  dark: ['#3d434a', '#4b525a', '#5b636c', '#6a737d'],
  light: ['#d7dade', '#c3c7cc', '#a9aeb4', '#8d9298'],
  sand: ['#c8a676', '#b89567', '#9d7c4f', '#7f6240'],
  field: ['#77906a', '#6a835d', '#58704c', '#4a6040'],
};

/** metres a texture tile spans (4 × 4 one-metre cells) */
export const TILE = 4;

const textures = new Map<DevTone, THREE.CanvasTexture>();

/** the 4 m measure tile for `tone` (cached): 1 m lines, a bold border, a "4M" stamp in the corner */
export function devTexture(tone: DevTone): THREE.CanvasTexture {
  const hit = textures.get(tone);
  if (hit !== undefined) return hit;
  const [base, line, bold, stamp] = TONES[tone];
  const S = 256, cell = S / TILE;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (g !== null) {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    g.fillStyle = line;
    for (let i = 1; i < TILE; i++) { g.fillRect(i * cell - 1, 0, 2, S); g.fillRect(0, i * cell - 1, S, 2); }
    g.fillStyle = bold;
    g.fillRect(0, 0, S, 4); g.fillRect(0, 0, 4, S); g.fillRect(0, S - 2, S, 2); g.fillRect(S - 2, 0, 2, S);
    g.fillStyle = stamp;
    g.font = '700 22px monospace';
    g.textBaseline = 'top';
    g.fillText(engineString('s_1149d32581c9', [TILE]), 10, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  textures.set(tone, t);
  return t;
}

const materials = new Map<DevTone, THREE.MeshBasicMaterial>();
/** the shared developer-texture material of one tone (grey / orange / dark …), made once */
export function devMaterial(tone: DevTone): THREE.MeshBasicMaterial {
  let m = materials.get(tone);
  if (m === undefined) {
    m = new THREE.MeshBasicMaterial({ map: devTexture(tone), vertexColors: true, fog: false });
    m.name = `dev-grid:${tone}`;
    materials.set(tone, m);
  }
  return m;
}

/** how much light each facing gets: the top full, the sides stepped, the underside dim (a readable box without a light) */
function shade(nx: number, ny: number, nz: number): number {
  if (ny > 0.5) return 1;
  if (ny < -0.5) return 0.5;
  if (Math.abs(nx) > 0.5) return nx > 0 ? 0.84 : 0.76;
  return nz > 0 ? 0.68 : 0.62;
}

/** world-aligned metre UVs and the facing shade on a positioned geometry (every vertex's own normal picks its axes) */
function dress(g: THREE.BufferGeometry, tint = 1): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    // seen from outside each face, u runs to the viewer's right (the stamps read the right way round)
    const [u, v] = Math.abs(ny) > 0.5 ? [x, -z] : Math.abs(nx) > 0.5 ? [-z * Math.sign(nx), y] : [x * Math.sign(nz), y];
    uv[i * 2] = u / TILE; uv[i * 2 + 1] = v / TILE;
    const s = shade(nx, ny, nz) * tint;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** builds a playground from developer-textured boxes and planes, merged into one mesh per tone */
export class DevKit {
  private readonly parts = new Map<DevTone, THREE.BufferGeometry[]>();

  private add(tone: DevTone, g: THREE.BufferGeometry): void {
    const list = this.parts.get(tone);
    if (list === undefined) this.parts.set(tone, [g]); else list.push(g);
  }

  /** an axis-aligned box by its centre and full size (world space); `tint` darkens a whole box (a pillar under a pad) */
  box(tone: DevTone, x: number, y: number, z: number, sx: number, sy: number, sz: number, tint = 1): void {
    this.add(tone, dress(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), tint));
  }

  /** a quad facing up at height y (a floor that needs no underside) */
  plane(tone: DevTone, x: number, y: number, z: number, sx: number, sz: number): void {
    this.add(tone, dress(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(x, y, z)));
  }

  /** a quad on a wall: centre, width along the wall, height; `face` is the way it looks (+x, −x, +z, −z) */
  wall(tone: DevTone, x: number, y: number, z: number, width: number, height: number, face: 'px' | 'nx' | 'pz' | 'nz'): void {
    const g = new THREE.PlaneGeometry(width, height);
    if (face === 'px') g.rotateY(Math.PI / 2); else if (face === 'nx') g.rotateY(-Math.PI / 2); else if (face === 'nz') g.rotateY(Math.PI);
    this.add(tone, dress(g.translate(x, y, z)));
  }

  /** one Mesh per tone: every part of a tone merged into one draw */
  build(name: string): THREE.Group {
    const root = new THREE.Group();
    root.name = name;
    for (const [tone, list] of this.parts) {
      // BoxGeometry is indexed, PlaneGeometry too: mergeGeometries needs them all alike
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, devMaterial(tone));
      mesh.name = `${name}:${tone}`;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    this.parts.clear();
    return root;
  }
}

/**
 * A painted label (START, FINISH, P2 …) lying on a floor or standing on a wall: one small canvas texture on a quad,
 * transparent, never lit. `w` is its width in metres; the height follows the text.
 */
export function devLabel(text: string, w: number, opts: { color?: string; back?: string; standing?: boolean } = {}): THREE.Mesh {
  const c = document.createElement('canvas');
  const H = 96;
  const g0 = c.getContext('2d');
  const font = '700 72px monospace';
  let tw = 200;
  if (g0 !== null) { g0.font = font; tw = Math.ceil(g0.measureText(text).width) + 40; }
  c.width = tw; c.height = H;
  const g = c.getContext('2d');
  if (g !== null) {
    if (opts.back !== undefined) { g.fillStyle = opts.back; g.fillRect(0, 0, tw, H); }
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = opts.color ?? '#ffffff';
    g.fillText(text, tw / 2, H / 2 + 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const h = w * (H / tw);
  const geo = new THREE.PlaneGeometry(w, h);
  if (opts.standing !== true) geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  mesh.name = `dev-label:${text}`;
  mesh.renderOrder = 1;
  return mesh;
}
