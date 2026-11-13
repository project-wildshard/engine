// REMOTE-PLAYERS RP12 (Jake, 2026-11-12: Jimmy had "a blurred name"): another player's Name, sharp on a phone. The text is painted
// big enough for 3 device px a CSS px (Jake's iPhone 17 Pro, 402×874 pt), its height on screen falls with distance between
// NAME_MIN_PX and NAME_MAX_PX, it stands NAME_CLEAR over the head wherever the head is (on foot, on a board, in a saddle), and
// past NAME_HIDE metres it is gone. Each draw fits it to the camera drawing it (`onBeforeRender`), so it needs no frame hook.
import * as THREE from 'three';
import { CASTAWAY_HEIGHT } from '../models/castawayBody';

/** Past this many metres from the eye a Name is not drawn. */
export const NAME_HIDE = 60;
/** The tag's height on screen, in CSS px: its most near, its least far. Its letters are about 0.65 of that. */
export const NAME_MAX_PX = 28, NAME_MIN_PX = 16;
/** Out to this many metres the tag is its tallest; past it, its height on screen falls with the square root of the distance. */
export const NAME_NEAR = 5;
/** The gap between the crown of the head and the tag's foot: this many metres, or this many CSS px if that is more. */
export const NAME_CLEAR = 0.15, NAME_CLEAR_PX = 6;
/** The canvas: 128 px tall holds the tallest tag (28 CSS px, 84 device px) with room to spare, mipmapped for the smallest (48 device px). */
const PAINT_HEIGHT = 128, PAINT_FONT = 84, PAINT_PAD = 40, PAINT_MAX_WIDTH = 1024;
/** The castaway's head bone runs from its base to the crown, 0.24 m (models/castawayBody.ts: head 1.56 m to 1.80 m). */
const CROWN = 0.24;
/** A view depth under this is in the eye; the tag's size there is moot. */
const NEAREST = 0.1;

/** What a draw made of the tag: on or not, metres from the eye, height on screen (CSS px), and the crown and its foot (world y). */
export interface NameTagShown { readonly shown: boolean; readonly metres: number; readonly px: number; readonly crown: number; readonly bottom: number }

/** The tag `metres` from the eye at view depth `depth`: its height on screen in CSS px and in the world, for a camera whose
 *  projection scales y by `focal` (1 / tan(fov / 2)) onto a view `viewHeight` CSS px tall. */
export function tagSize(metres: number, depth: number, focal: number, viewHeight: number): { readonly shown: boolean; readonly px: number; readonly height: number } {
  if (!(metres <= NAME_HIDE)) return { shown: false, px: 0, height: 0 };
  const px = THREE.MathUtils.clamp(NAME_MAX_PX * Math.sqrt(NAME_NEAR / Math.max(metres, NAME_NEAR)), NAME_MIN_PX, NAME_MAX_PX);
  return { shown: true, px, height: (px * 2 * Math.max(depth, NEAREST)) / (focal * viewHeight) };
}

/** The Name painted once: white on a dark rounded plate, the canvas as wide as the Name. */
function paint(name: string): { readonly texture: THREE.CanvasTexture; readonly aspect: number } {
  const canvas = document.createElement('canvas'), pen = canvas.getContext('2d'), font = `700 ${PAINT_FONT}px system-ui, -apple-system, sans-serif`;
  let width = PAINT_HEIGHT * 3;
  if (pen !== null) { pen.font = font; width = Math.min(PAINT_MAX_WIDTH, Math.ceil(pen.measureText(name).width) + PAINT_PAD * 2); }
  Object.assign(canvas, { width, height: PAINT_HEIGHT });
  if (pen !== null) {
    pen.font = font; pen.textAlign = 'center'; pen.textBaseline = 'middle';
    pen.fillStyle = 'rgba(8, 14, 24, 0.8)'; pen.beginPath(); pen.roundRect(2, 4, width - 4, PAINT_HEIGHT - 8, 36); pen.fill();
    pen.lineWidth = 8; pen.strokeStyle = 'rgba(0, 0, 0, 0.55)'; pen.lineJoin = 'round'; pen.strokeText(name, width / 2, PAINT_HEIGHT / 2 + 3, width - PAINT_PAD);
    pen.fillStyle = '#fff'; pen.fillText(name, width / 2, PAINT_HEIGHT / 2 + 3, width - PAINT_PAD);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  return { texture, aspect: width / PAINT_HEIGHT };
}

const at = new THREE.Vector3(), eye = new THREE.Vector3(), tip = new THREE.Vector3(), seen = new THREE.Vector3(), view = new THREE.Vector2();

/** A Name over another player's body. Add it to the body's group; it finds the head (the `Head` bone) itself. */
export class NameTag extends THREE.Sprite {
  /** What the last draw made of it, for `__onlinePlayers()`; not shown until a draw has fitted it. */
  report: NameTagShown = { shown: false, metres: 0, px: 0, crown: CASTAWAY_HEIGHT, bottom: CASTAWAY_HEIGHT + NAME_CLEAR };
  private readonly aspect: number;
  private head: THREE.Object3D | null = null;
  constructor(name: string) {
    const { texture, aspect } = paint(name);
    super(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
    this.aspect = aspect; this.name = 'Name';
    // Anchored at its foot, so it grows upward away from the head; never culled, so every draw fits it (a hidden one has no size).
    this.center.set(0.5, 0); this.frustumCulled = false;
    this.position.y = CASTAWAY_HEIGHT + NAME_CLEAR; this.scale.set(0.3 * aspect, 0.3, 1);
    this.onBeforeRender = (renderer, _scene, camera) => { this.fit(camera, renderer.getSize(view).y); };
  }
  /** Sizes and places the tag for `camera` on a view `viewHeight` CSS px tall: over the crown, its height on screen clamped, or none past NAME_HIDE. */
  fit(camera: THREE.Camera, viewHeight: number): void {
    const { parent } = this;
    if (parent === null || viewHeight <= 0) return;
    // The crown: the head bone's tip, or its base if a fall has the body upside down; a body not dressed yet stands 1.80 m.
    if (this.head === null) parent.traverse(node => { if (this.head === null && node instanceof THREE.Bone && node.name === 'Head') this.head = node; });
    const base = parent.getWorldPosition(at), floor = base.y;
    let crown = floor + CASTAWAY_HEIGHT;
    if (this.head !== null) crown = Math.max(this.head.getWorldPosition(tip).y, this.head.localToWorld(tip.set(0, CROWN, 0)).y);
    at.set(base.x, crown, base.z);
    const metres = at.distanceTo(camera.getWorldPosition(eye)), depth = -seen.copy(at).applyMatrix4(camera.matrixWorldInverse).z;
    const focal = camera.projectionMatrix.elements[5] ?? 1, size = tagSize(metres, depth, focal, viewHeight);
    const clear = size.shown ? Math.max(NAME_CLEAR, (NAME_CLEAR_PX * size.height) / size.px) : NAME_CLEAR, bottom = crown + clear;
    this.position.y = bottom - floor; this.scale.set(size.height * this.aspect, size.height, 1);
    this.updateMatrixWorld();
    // VOICE-POLISH V8's ring over a talker sits over the tag, whatever its size.
    const ring = parent.getObjectByName('Talking');
    if (ring !== undefined) { ring.position.y = this.position.y + size.height + ring.scale.y / 2 + 0.05; ring.updateMatrixWorld(); }
    this.report = { shown: size.shown, metres, px: size.px, crown, bottom };
  }
}
