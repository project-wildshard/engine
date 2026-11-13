// REMOTE-PLAYERS RP10: what a page shows when something hits another player. The server sends a `hit` to every page that knows
// the target; a page routes the one on itself to its own hurt, one on a creature to RowBodies, and one on a player it draws
// here: the body flashes red for a moment and a red number pops over it, rises and fades. The body's material is its own copy
// from its first hit on (the castaway's is shared by every body), so only the struck body flashes. Both are in the body's group
// and not marked shared, so `OtherPlayers.drop` frees them with it.
import * as THREE from 'three';
import { CASTAWAY_HEIGHT } from '../models/castawayBody';

/** How long a flash lasts (s), and its red. */
const FLASH = 0.3, FLASH_RED = new THREE.Color(0xff2a1a), FLASH_GLOW = 1.4;
/** A number's life (s), how far it rises (m) from where it starts, at the shoulder, its height on screen (CSS px), and how many show at once. */
const LIFE = 0.9, RISE = 0.55, START = CASTAWAY_HEIGHT * 0.8, PX = 22, POOL = 3;
/** How far beside the body numbers sit (m, across the view), alternating sides so two hits never stack. */
const SIDE = 0.32;

/** A proof's hold on every flash and number where it is (0 holds, 1 is real time). */
const PACE = Symbol.for('wildshard.remoteHurt.pace');
const pace = (): number => { const set = (globalThis as { [PACE]?: unknown })[PACE]; return typeof set === 'number' && Number.isFinite(set) && set >= 0 ? set : 1; };

/** What `__onlinePlayers()` reports of a body's hurt. */
export interface HurtShown { readonly hits: number; readonly last: number; readonly flash: number; readonly numbers: readonly string[] }

const view = new THREE.Vector2(), at = new THREE.Vector3(), right = new THREE.Vector3(), seen = new THREE.Vector3();

/** One red number over a body: a canvas sprite, sized to PX on screen at any distance, drawn over everything. */
class HurtNumber extends THREE.Sprite {
  t = LIFE;
  side = 1;
  text = '';
  private readonly pen: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  constructor() {
    const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 64 }), texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    super(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.pen = canvas.getContext('2d'); this.texture = texture;
    this.name = 'HurtNumber'; this.visible = false; this.renderOrder = 20; this.frustumCulled = false; this.center.set(0.5, 0);
    this.onBeforeRender = (renderer, _scene, camera) => { this.fit(camera, renderer.getSize(view).y); };
  }
  pop(text: string, side: number): void {
    this.t = 0; this.side = side; this.text = text; this.visible = true;
    const { pen } = this;
    if (pen !== null) {
      pen.clearRect(0, 0, 128, 64);
      pen.font = '700 46px system-ui, sans-serif'; pen.textAlign = 'center'; pen.textBaseline = 'middle'; pen.lineJoin = 'round';
      pen.lineWidth = 8; pen.strokeStyle = 'rgba(20, 0, 0, 0.9)'; pen.strokeText(text, 64, 34);
      pen.fillStyle = '#ff4433'; pen.fillText(text, 64, 34);
    }
    this.texture.needsUpdate = true;
  }
  /** Ages it; false once it has faded. */
  age(dt: number): boolean {
    if (!this.visible) return false;
    this.t += dt;
    if (this.t >= LIFE) { this.visible = false; return false; }
    const k = this.t / LIFE;
    this.material.opacity = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
    return true;
  }
  /** Over the body, beside it across the view, risen by its age, PX tall on a view `viewHeight` CSS px tall. */
  private fit(camera: THREE.Camera, viewHeight: number): void {
    const { parent } = this;
    if (parent === null || viewHeight <= 0) return;
    const k = Math.min(1, this.t / LIFE), rise = RISE * (1 - (1 - k) * (1 - k));
    parent.getWorldPosition(at); at.y += START + rise;
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize().multiplyScalar(SIDE * this.side);
    at.add(right);
    const depth = Math.max(0.5, -seen.copy(at).applyMatrix4(camera.matrixWorldInverse).z), focal = camera.projectionMatrix.elements[5] ?? 1;
    const height = (PX * 2 * depth) / (focal * viewHeight);
    this.position.copy(parent.worldToLocal(at)); this.scale.set(height * 2, height, 1);
    this.updateMatrixWorld();
  }
}

/** One other player's hurt: its flash and its numbers. */
export class RemoteHurt {
  private readonly group: THREE.Object3D;
  private readonly numbers: HurtNumber[] = [];
  private material: THREE.MeshStandardMaterial | null = null;
  /** The body's mesh, once it has its own copy; RP11's fade may dress it in a clone for a while. */
  private mesh: THREE.SkinnedMesh | null = null;
  private flashT = FLASH;
  private hits = 0;
  private last = 0;
  constructor(group: THREE.Object3D) { this.group = group; }
  /** A hit of `amount` landed on it. */
  hit(amount: number): void {
    this.hits += 1; this.last = Math.round(amount); this.flashT = 0;
    this.own();
    let number = this.numbers.find(each => !each.visible);
    if (number === undefined && this.numbers.length < POOL) { number = new HurtNumber(); this.numbers.push(number); this.group.add(number); }
    number ??= this.numbers.reduce((oldest, each) => (each.t > oldest.t ? each : oldest));
    number.pop(String(this.last), this.hits % 2 === 0 ? -1 : 1);
  }
  /** The flash fades and the numbers rise, at the proof's pace. */
  update(dt: number): void {
    const step = dt * pace();
    this.flashT = Math.min(FLASH, this.flashT + step);
    const k = 1 - this.flashT / FLASH, glow = k * k;
    if (this.material !== null) this.material.emissiveIntensity = FLASH_GLOW * glow;
    // While RP11's fade wears its own clone (a fade-in after a respawn), that clone flashes too.
    const worn = this.mesh?.material;
    if (worn !== this.material && worn instanceof THREE.MeshStandardMaterial && worn.userData['shared'] !== true) { worn.emissive.copy(FLASH_RED); worn.emissiveIntensity = FLASH_GLOW * glow; }
    for (const number of this.numbers) number.age(step);
  }
  get report(): HurtShown {
    const k = 1 - this.flashT / FLASH;
    return { hits: this.hits, last: this.last, flash: k * k, numbers: this.numbers.filter(each => each.visible).sort((a, b) => b.t - a.t).map(each => each.text) };
  }
  /** The body's material, its own copy from its first hit, lit red by `update`. While RP11's fade wears its own copy (not the
   *  shared one), the body takes none: the fade puts the shared one back, and the next hit copies that. */
  private own(): void {
    if (this.material !== null) return;
    this.group.traverse(node => {
      if (this.material !== null || !(node instanceof THREE.SkinnedMesh) || !(node.material instanceof THREE.MeshStandardMaterial) || node.material.userData['shared'] !== true) return;
      const copy = node.material.clone();
      copy.userData = { ...copy.userData, shared: false }; copy.emissive.copy(FLASH_RED); copy.emissiveIntensity = 0;
      node.material = copy; this.material = copy; this.mesh = node;
    });
  }
  /** Frees its copy of the body's material, which RP11's fade may hold off the mesh when the body goes. Twice is harmless. */
  dispose(): void { this.material?.dispose(); }
}
