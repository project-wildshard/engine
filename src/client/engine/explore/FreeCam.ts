import { app } from '../app/runtime';
import { listenDom, listenPage } from '../input/dom';
/**
 * FreeCam — Unity scene-view camera controls (the Explore World god camera on desktop).
 *
 * Vendored from three-freecam 0.2.0 (https://github.com/hxtnv/three-freecam, MIT, © 2026 Daniel / hxtnv; demo
 * https://hxtnv.github.io/three-freecam/ — 0.2.0's runtime is 0.1.1's, only its docs changed)
 * as strict TypeScript: `package.json` / the lockfile carried other agents' WIP when this landed, and the
 * library is ~260 lines with no dependencies. Behaviour is the upstream's; the only additions are
 * `enabled` gating every listener (Explore turns it off while a sheet is open) and `look(dx, dy)` / `move`
 * inputs so the touch layer (TouchFly.ts) drives the same camera.
 *
 *   const cam = new FreeCam(camera, canvas, { moveSpeed: 14 });
 *   cam.update(dt);                 // every frame
 *   cam.placeAt(pos, lookAt);       // jump
 *   cam.focus(object3d);            // frame an object (F)
 *
 * Right-drag look + WASD fly, Q / E down / up (Space up), Shift boost, wheel = speed while looking else
 * dolly, middle-drag pan, Alt + left-drag orbit, F frame the pivot.
 */
import { Box3, Euler, Matrix4, Quaternion, Sphere, Vector3, type Object3D, type PerspectiveCamera } from 'three';

export interface FreeCamKeys {
  forward: string[]; back: string[]; left: string[]; right: string[]; up: string[]; down: string[]; boost: string[]; focus: string[];
}

export interface FreeCamOptions {
  /** base fly speed in m/s; the wheel changes it while looking */
  moveSpeed?: number;
  /** multiplier while the boost key is held */
  boost?: number;
  /** look sensitivity, radians per pixel */
  lookSpeed?: number;
  /** pan speed, metres per pixel per metre of pivot distance */
  panSpeed?: number;
  /** fraction of the pivot distance one wheel notch dollies */
  zoomSpeed?: number;
  /** speed multiplier per wheel notch while looking */
  speedStep?: number;
  moveSpeedRange?: [number, number];
  /** 0 = instant (Unity), toward 1 = a gliding flythrough */
  damping?: number;
  invertY?: boolean;
  maxPitch?: number;
  keys?: Partial<FreeCamKeys>;
  /** pointer lock while dragging so the look never runs out of screen */
  pointerLock?: boolean;
}

const DEFAULT_KEYS: FreeCamKeys = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  up: ['KeyE', 'Space'], down: ['KeyQ'], boost: ['ShiftLeft', 'ShiftRight'], focus: ['KeyF'],
};

const cameraContextIds = { next: 0 };

const _box = new Box3();
const _sphere = new Sphere();
const _offset = new Vector3();
const _quat = new Quaternion();
const _matrix = new Matrix4();

type Drag = 'none' | 'look' | 'pan' | 'orbit';

export class FreeCam {
  private readonly scope = (app.levelScope ?? app.engineScope).child('free-camera');
  private readonly context = `camera.${this.scope.name}.${cameraContextIds.next++}`;
  enabled = true;
  moveSpeed: number;
  boost: number;
  lookSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  speedStep: number;
  moveSpeedRange: [number, number];
  damping: number;
  invertY: boolean;
  maxPitch: number;
  pointerLock: boolean;
  /** what orbit turns around and the wheel dollies toward; follows the camera otherwise */
  readonly pivot: Vector3 = new Vector3();
  /** analogue input from the touch layer: x strafe, y up, z forward (−1..1 each); added to the keys */
  readonly move: Vector3 = new Vector3();
  /** set by the touch layer while its boost chip is on */
  boosted = false;
  /** a floor under the camera (terrain / sea) — the camera never goes below `floor(x, z) + clearance` */
  floor: ((x: number, z: number) => number) | null = null;
  clearance = 0.4;

  private readonly keymap: FreeCamKeys;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly velocity = new Vector3();
  private readonly scratch = new Vector3();
  private drag: Drag = 'none';
  private pivotDistance = 10;
  private locked = false;

  private readonly camera: PerspectiveCamera;
  private readonly dom: HTMLElement;
  constructor(camera: PerspectiveCamera, dom: HTMLElement, options: FreeCamOptions = {}) {
    this.camera = camera;
    this.dom = dom;
    this.moveSpeed = options.moveSpeed ?? 12;
    this.boost = options.boost ?? 4;
    this.lookSpeed = options.lookSpeed ?? 0.0022;
    this.panSpeed = options.panSpeed ?? 0.0015;
    this.zoomSpeed = options.zoomSpeed ?? 0.12;
    this.speedStep = options.speedStep ?? 1.15;
    this.moveSpeedRange = options.moveSpeedRange ?? [0.1, 500];
    this.damping = options.damping ?? 0;
    this.invertY = options.invertY ?? false;
    this.maxPitch = options.maxPitch ?? Math.PI / 2 - 0.01;
    this.pointerLock = options.pointerLock ?? true;
    this.keymap = { ...DEFAULT_KEYS, ...options.keys };
    this.euler.setFromQuaternion(camera.quaternion);
    this.syncPivot();
    app.input.register({ id: this.context, actions: ['move.forward', 'move.back', 'move.left', 'move.right', 'fly.up', 'fly.down', 'fly.boost', 'focus'],
      enabled: () => this.enabled, keys: { 'move.forward': this.keymap.forward, 'move.back': this.keymap.back, 'move.left': this.keymap.left, 'move.right': this.keymap.right,
        'fly.up': this.keymap.up, 'fly.down': this.keymap.down, 'fly.boost': this.keymap.boost, focus: this.keymap.focus } }, this.scope);
    app.input.push(this.context, this.scope);
    app.input.bind('focus', () => { this.focus(this.pivot); }, this.scope, () => this.enabled);
    listenDom(this.scope, dom, 'pointerdown', this.onPointerDown);
    listenDom(this.scope, dom, 'wheel', this.onWheel, { passive: false });
    listenDom(this.scope, dom, 'contextmenu', this.onContextMenu);
    listenPage(this.scope, 'pointermove', this.onPointerMove);
    listenPage(this.scope, 'pointerup', this.onPointerUp);
    app.input.onReset(() => { this.drag = 'none'; this.releaseLock(); }, this.scope);
    listenDom(this.scope, document, 'pointerlockchange', this.onPointerLockChange);
  }

  /** once per frame */
  update(dt: number): void {
    if (!this.enabled) return;
    const speed = this.moveSpeed * (app.input.held('fly.boost') || this.boosted ? this.boost : 1);
    const move = this.scratch.set(
      Number(app.input.held('move.right')) - Number(app.input.held('move.left')) + this.move.x,
      Number(app.input.held('fly.up')) - Number(app.input.held('fly.down')) + this.move.y,
      Number(app.input.held('move.back')) - Number(app.input.held('move.forward')) - this.move.z,
    );
    if (move.lengthSq() > 0) {
      if (move.lengthSq() > 1) move.normalize();
      move.multiplyScalar(speed);
      const vertical = move.y;
      move.y = 0;
      move.applyQuaternion(this.camera.quaternion);
      move.y += vertical;
    }
    if (this.damping <= 0) this.velocity.copy(move);
    else this.velocity.lerp(move, 1 - this.damping ** (dt * 60)); // framerate independent
    this.camera.position.addScaledVector(this.velocity, dt);
    this.clampToFloor();
    this.camera.quaternion.setFromEuler(this.euler);
    if (this.drag !== 'orbit') this.syncPivot();
  }

  /** turn the view by a pixel delta (the touch layer's drag-to-spin) */
  look(dx: number, dy: number): void { this.rotate(dx, dy); }

  /** orbit the pivot by a pixel delta (touch: one finger while an orbit target is set) */
  orbit(dx: number, dy: number): void {
    this.rotate(dx, dy);
    _quat.setFromEuler(this.euler);
    _offset.set(0, 0, this.pivotDistance).applyQuaternion(_quat);
    this.camera.position.copy(this.pivot).add(_offset);
    this.clampToFloor();
    this.camera.quaternion.setFromEuler(this.euler);
    this.velocity.set(0, 0, 0);
  }

  /** move toward / away from the pivot (touch: pinch) — `amount` in pivot-distance fractions, + = closer */
  dolly(amount: number): void {
    const step = this.pivotDistance * amount;
    this.scratch.set(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(step);
    this.camera.position.add(this.scratch);
    this.pivotDistance = Math.max(0.5, this.pivotDistance - step);
    this.clampToFloor();
  }

  /** points the camera at something and backs off far enough to see all of it */
  focus(target: Object3D | Vector3, distance?: number): void {
    if (target instanceof Vector3) {
      this.pivot.copy(target);
      this.pivotDistance = distance ?? this.pivotDistance;
    } else {
      _box.setFromObject(target);
      if (_box.isEmpty()) return;
      _box.getBoundingSphere(_sphere);
      this.pivot.copy(_sphere.center);
      this.pivotDistance = distance ?? (_sphere.radius * 1.6) / Math.tan((this.camera.fov * Math.PI) / 360);
    }
    _offset.set(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(this.pivotDistance);
    this.camera.position.copy(this.pivot).add(_offset);
    this.velocity.set(0, 0, 0);
  }

  /** jumps the camera somewhere, optionally pointing it at a target */
  placeAt(position: Vector3, lookAt?: Vector3): void {
    this.camera.position.copy(position);
    this.velocity.set(0, 0, 0);
    if (lookAt) {
      _matrix.lookAt(position, lookAt, this.camera.up);
      _quat.setFromRotationMatrix(_matrix);
      this.euler.setFromQuaternion(_quat);
      this.pivotDistance = Math.max(0.5, position.distanceTo(lookAt));
    }
    this.camera.quaternion.setFromEuler(this.euler);
    this.syncPivot();
  }

  /** the current heading / pitch (radians, the Player's convention: yaw 0 looks −Z) */
  get yaw(): number { return this.euler.y; }
  get pitch(): number { return this.euler.x; }
  setAngles(yaw: number, pitch: number): void { this.euler.set(pitch, yaw, 0, 'YXZ'); this.camera.quaternion.setFromEuler(this.euler); this.syncPivot(); }

  dispose(): void { this.releaseLock(); this.scope.dispose(); }

  private clampToFloor(): void {
    if (!this.floor) return;
    const p = this.camera.position, y = this.floor(p.x, p.z) + this.clearance;
    if (p.y < y) p.y = y;
  }


  private syncPivot(): void { this.pivot.set(0, 0, -this.pivotDistance).applyQuaternion(this.camera.quaternion).add(this.camera.position); }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.pointerType === 'touch') return; // touch goes through TouchFly
    if (event.button === 2) this.drag = 'look';
    else if (event.button === 1) this.drag = 'pan';
    else if (event.button === 0 && event.altKey) this.drag = 'orbit';
    else return;
    event.preventDefault();
    if (this.pointerLock && this.drag !== 'orbit') void this.dom.requestPointerLock().catch(() => { /* refused: plain drag */ });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.drag === 'none' || !this.enabled) return;
    const dx = event.movementX, dy = event.movementY;
    if (dx === 0 && dy === 0) return;
    if (this.drag === 'pan') {
      const scale = this.panSpeed * Math.max(this.pivotDistance, 1);
      this.scratch.set(-dx * scale, dy * scale, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.add(this.scratch);
      return;
    }
    if (this.drag === 'orbit') { this.orbit(dx, dy); return; }
    this.rotate(dx, dy);
  };

  private rotate(dx: number, dy: number): void {
    const sign = this.invertY ? -1 : 1;
    this.euler.y -= dx * this.lookSpeed;
    this.euler.x -= dy * this.lookSpeed * sign;
    this.euler.x = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.euler.x));
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.drag === 'none') return;
    const released = (this.drag === 'look' && event.button === 2) || (this.drag === 'pan' && event.button === 1) || (this.drag === 'orbit' && event.button === 0);
    if (!released) return;
    this.drag = 'none';
    this.releaseLock();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    const notches = -Math.sign(event.deltaY);
    if (this.drag === 'look') { // while looking the wheel is a throttle, as in the editor
      const [min, max] = this.moveSpeedRange;
      this.moveSpeed = Math.max(min, Math.min(max, this.moveSpeed * this.speedStep ** notches));
      return;
    }
    this.dolly(this.zoomSpeed * notches);
  };

  private readonly onContextMenu = (event: MouseEvent): void => { if (this.enabled) event.preventDefault(); };
  private readonly onPointerLockChange = (): void => { this.locked = document.pointerLockElement === this.dom; };
  private releaseLock(): void { if (this.locked) document.exitPointerLock(); this.locked = false; }
}
