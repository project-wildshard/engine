/** Client-only presentation of a baked cave interior declared as rows (format/caveInterior). */
import * as THREE from 'three';
import * as v from 'valibot';
import { loadPBR, loadTexture, texUrl } from '@wildshard/engine/core/assets';
import { readColliderRows } from '@wildshard/engine/models/colliders';
import type { ColliderDesc } from '@wildshard/engine/world/registry';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { insidePolygon, yawLocal, yawWorld, type YawFrame } from '@wildshard/engine/world/yawFrame';
import { CaveFileSchema, CaveInteriorSchema, type CaveFile, type CaveInteriorRows } from '@wildshard/format/caveInterior';
import { lentLook, setLentParam, setLentTexture } from './lentLooks';
import { loadFirstPartyProduct } from './runtimeProduct';
import { GeometryPack } from '@wildshard/engine/models/geometryPack';
import { packedRows } from '@wildshard/format/geometryPack';
import { fetchDeflated } from '../plugin/geometry';

/** The walls' day fill each rock look reads, shared by every resident view of it. */
const fills = new Map<string, { value: number }>();

/**
 * A cave cut into the terrain: one interior baked by a shard's builder, described in its own frame (lx across, lz in,
 * y world height), and its look near the mouth. It answers the world's questions — the terrain's cut rows, the roof patch over the cut as a trimesh (its geometry a part of a declared pack), the reverb spots, the
 * footprint, the passage's floor — and draws the shaft of light (a lent graph, additive) and the drips near the mouth,
 * fills the walls by day through the rock look's fill param and hides the sun's depth-less disc under the roof.
 */
export class CaveInterior {
  readonly meta: CaveFile['meta'];
  /** the shaft and the drips (added by `buildFx`) */
  readonly fx: THREE.Object3D[] = [];
  readonly shell: ColliderDesc[] = [];
  private readonly frame: YawFrame;
  private readonly look: CaveInteriorRows['look'];
  private readonly fill: { value: number };
  private shaft: THREE.Mesh | null = null;
  private drips: THREE.Points | null = null;
  private dripState: Float32Array = new Float32Array(0);
  private near = false;
  private under = false;
  private readonly eye = new THREE.Vector3();

  /** Admit the rows, read the baked cave from its product and lend the rock look its textures (`cap` their size). */
  static async load(input: unknown, cap: number): Promise<CaveInterior> {
    const rows = v.parse(CaveInteriorSchema, input);
    const [product, rock, map, normalMap, roof] = await Promise.all([loadFirstPartyProduct(rows.product), loadPBR(rows.rock.pbr, 1, cap),
      loadTexture(texUrl(rows.rock.grit, 'diffuse'), true), loadTexture(texUrl(rows.rock.grit, 'nor_gl')), fetchDeflated(rows.roof.url)]);
    const data = v.parse(CaveFileSchema, await product.json(rows.file));
    const cave = new CaveInterior(rows, data.meta, new GeometryPack(roof, packedRows(rows.roof.rows), 'cave roof').geometry(rows.roof.part));
    cave.shell.push(...readColliderRows([data.shell], { kinds: ['trimesh'], surfaces: ['rock'], requireSurface: true }));
    const lend = (name: string, texture: THREE.Texture): void => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1, 1); texture.needsUpdate = true;
      setLentTexture(rows.rock.look, name, texture);
    };
    lend('rockMap', rock.map); lend('rockNormal', rock.normalMap); lend('rockArm', rock.armMap);
    lend('gritMap', map); lend('gritNormal', normalMap);
    return cave;
  }

  private constructor(private readonly rows: CaveInteriorRows, meta: CaveFile['meta'], private readonly roof: THREE.BufferGeometry) {
    this.meta = meta; this.look = rows.look;
    this.frame = { x: rows.frame.x, z: rows.frame.z, yaw: rows.frame.yaw };
    let fill = fills.get(rows.rock.look);
    if (fill === undefined) { fill = { value: 1 }; fills.set(rows.rock.look, fill); }
    this.fill = fill;
  }

  /** Per frame: the live light and drips from the view camera, and the rock look's fill. */
  presentFrame(t: number, sky: SkyRig): void {
    sky.viewCamera.getWorldPosition(this.eye);
    this.update(t, this.eye, sky);
    setLentParam(this.rows.rock.look, this.rows.rock.fill, this.fill.value);
  }

  /** world (x, z) → cave-local (lx, lz) */
  local(x: number, z: number): [number, number] { return yawLocal(this.frame, x, z); }
  /** cave-local (lx, lz) → world (x, z) */
  world(lx: number, lz: number): [number, number] { return yawWorld(this.frame, lx, lz); }

  /** Immutable cut facts; the game owns triangle filtering and yields. */
  cutRows(): { frame: YawFrame; cuts: CaveFile['meta']['cuts']; holes: CaveFile['meta']['holes'] } { return { frame: this.frame, cuts: this.meta.cuts, holes: this.meta.holes }; }

  /** the reverb / bed spots, world */
  spots(): { x: number; z: number; r: number }[] {
    return this.meta.spots.map((s) => { const [x, z] = this.world(s.lx, s.lz); return { x, z, r: s.r }; });
  }

  /** inside the footprint (no rain falls there) */
  inside(x: number, z: number): boolean { const [lx, lz] = this.local(x, z); return insidePolygon(this.meta.inside, lx, lz); }

  /** the passage's floor height at depth `lz` */
  floorAt(lz: number): number | undefined {
    const f = this.meta.floor;
    for (let i = 0; i + 1 < Math.min(f.length, 256); i++) {
      const a = f[i], b = f[i + 1];
      if (a && b && lz >= a[0] && lz <= b[0]) return a[1] + (b[1] - a[1]) * ((lz - a[0]) / Math.max(1e-6, b[0] - a[0]));
    }
    return undefined;
  }

  /** The terrain over the cut as a trimesh (the ground above the mouth comes back), from the declared roof geometry. */
  roofPatch(): ColliderDesc[] {
    const g = this.roof, idx = g.getIndex();
    if (idx === null || idx.count === 0) return [];
    return [{ kind: 'trimesh', x: this.frame.x, y: 0, z: this.frame.z, vertices: Float32Array.from(g.getAttribute('position').array), indices: Uint32Array.from(idx.array), surface: this.look.surface }];
  }

  /** Build the shaft and the drips (hidden until the eye is near); they are added to `fx` in that order. */
  buildFx(): void {
    const meta = this.meta, look = this.look;
    const toW = (p: readonly [number, number, number]): THREE.Vector3 => { const [x, z] = this.world(p[0], p[2]); return new THREE.Vector3(x, p[1], z); };
    // the shaft: an open cone from the crack to the floor, additive, brightest at the crack, fading to the floor and its rim
    const top = toW(meta.shaft.top), foot = toW(meta.shaft.foot), len = top.distanceTo(foot);
    const geo = new THREE.CylinderGeometry(meta.shaft.r0, meta.shaft.r1, len, look.shaft.radialSegments, look.shaft.heightSegments, true);
    geo.translate(0, -len / 2, 0);
    const shaft = new THREE.Mesh(geo, lentLook(look.shaft.look));
    shaft.position.copy(top);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), foot.clone().sub(top).normalize());
    shaft.renderOrder = look.shaft.renderOrder; shaft.visible = false; shaft.name = 'cave-shaft';
    this.shaft = shaft; this.fx.push(shaft);
    // the drips: one Points, each drip falling from the roof on its own clock
    const n = meta.drips.length;
    if (n === 0) return;
    const pos = new Float32Array(n * 3);
    this.dripState = new Float32Array(n * 4);
    meta.drips.forEach((d, i) => {
      const [x, z] = this.world(d[0], d[2]);
      this.dripState.set([x, d[1], z, d[3]], i * 4); pos.set([x, d[1], z], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dl = look.drips;
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: dl.color, size: dl.size, sizeAttenuation: true, transparent: true, opacity: dl.opacity, depthWrite: false, fog: false }));
    pts.name = 'cave-drips'; pts.visible = false; pts.frustumCulled = false;
    this.drips = pts; this.fx.push(pts);
  }

  /** Per frame, the eye at `p`: the sun's disc under the roof, and near the mouth the fill, the shaft and the drips on clock `t`. */
  update(t: number, p: THREE.Vector3, sky: SkyRig): void {
    const look = this.look, [, lz] = this.local(p.x, p.z);
    // the sun's corona sprite draws without a depth test: under the roof the disc goes, corona and all
    const under = this.inside(p.x, p.z) && p.y < (this.floorAt(Math.min(look.under.lzMax, Math.max(look.under.lzMin, lz))) ?? p.y) + look.under.height;
    if (under !== this.under) { this.under = under; sky.sunDisc.visible = !under; }
    const near = Math.hypot(p.x - this.frame.x, p.z - this.frame.z) < look.near;
    if (near !== this.near) { this.near = near; if (this.shaft) this.shaft.visible = near; if (this.drips) this.drips.visible = near; }
    if (!near) return;
    if (this.shaft) {
      // the sky over the crack: bright by day (the lamps are out), a glimmer at night
      const s = look.shaft, day = 1 - Math.max(0, Math.min(1, sky.lamps));
      this.fill.value = look.fill[0] + look.fill[1] * day;
      setLentParam(s.look, 'intensity', s.gain * day * Math.min(1, s.sunBase + Math.max(0, sky.sunDir.y) * s.sunGain) + s.floor);
    }
    if (this.drips) {
      const pos = this.drips.geometry.getAttribute('position'), st = this.dripState, n = st.length / 4, dl = look.drips;
      for (let i = 0; i < Math.min(n, 256); i++) {
        const top = st[i * 4 + 1] ?? 0, floor = st[i * 4 + 3] ?? 0, h = Math.max(dl.minDrop, top - floor);
        // each drip forms for a while (hangs at the roof), then falls under gravity to the floor
        const period = dl.period + (i % dl.kinds) * dl.periodStep, ph = (t / period + i * dl.phaseStep) % 1;
        const fall = Math.sqrt((2 * h) / dl.gravity) / period, k = ph < 1 - fall ? 0 : (ph - (1 - fall)) / fall;
        pos.setY(i, top - dl.hang - 0.5 * dl.gravity * (k * fall * period) ** 2 * (k > 0 ? 1 : 0));
      }
      pos.needsUpdate = true;
    }
  }
}
