import * as THREE from 'three';
import type { Game } from '../core/Game';
import { worldTime } from '../../../shared/engine/core/time';
import { makeFlashTexture } from '../combat/view/firearmFx';
import { CameraFX } from '../player/CameraFX';
import { Impacts } from './Impacts';

/**
 * Gunfire (meta QA42/QA44, Jake 2026-11-19 on Brasscap: "They're clearly shooting at me, but there's no particle
 * effects ... There's no bullets"): what a shot looks like in the world, for every zone. One per game, pooled, no
 * allocations after construction:
 *
 *   • TRACERS: a hot streak that runs from the muzzle to where the round stops at TRACER_SPEED, its width kept to a few
 *     pixels at any distance (an additive box, stretched along the shot).
 *   • FLASHES: a world muzzle flash (the engine's flash sprite, additive, a random roll) for a shot the player does not
 *     hold: a bandit's rifle, another player's gun.
 *   • DUST: a soft cloud of sand where a round lands, or round a big body going under (a few soft billboards that swell
 *     and fade), with Impacts' grit or sparks thrown off it.
 *   • SHAKE: the camera's trauma, for a blow that lands near the player.
 *
 *   const fire = Gunfire.for(game);                    // the session makes it; views with no game read Gunfire.current()
 *   fire.shot(muzzle, end, 'enemy'); fire.flash(muzzle, direction, 0.5); fire.impact(end, direction, 'dust');
 */
export type GunfireImpact = 'dust' | 'sparks' | 'armour' | 'flesh';
export type TracerTone = 'own' | 'enemy';

const TRACERS = 16, FLASHES = 8, CLOUDS = 48;
/** m/s the streak runs at: fast enough to read as a round, slow enough to see for a few frames */
const TRACER_SPEED = 150;
/** m of streak, and its width in pixels' worth of the view at any distance */
const TRACER_LENGTH = 6, TRACER_ANGLE = 0.006, TRACER_MIN_WIDTH = 0.012;
const FLASH_SECONDS = 0.08;
/** m: a creature's round closer than this draws nothing (a knife's lunge), and how far past the eye its tracer runs */
const MIN_ENEMY_RANGE = 3, ENEMY_OVERSHOOT = 6;
/** m: how far a big body's blow is felt in the view */
const QUAKE_RANGE = 45;
const TONES: Record<TracerTone, THREE.Color> = { own: new THREE.Color(2.4, 1.9, 1.1), enemy: new THREE.Color(2.6, 1.2, 0.5) };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3(), _cam = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

interface Tracer { readonly mesh: THREE.Mesh; readonly from: THREE.Vector3; readonly to: THREE.Vector3; length: number; t: number; live: boolean }
interface Flash { readonly sprite: THREE.Sprite; t: number; size: number; live: boolean }
interface Cloud { readonly sprite: THREE.Sprite; readonly velocity: THREE.Vector3; t: number; life: number; size: number; grow: number; live: boolean }

export class Gunfire {
  private static byGame = new WeakMap<Game, Gunfire>();
  private static last: Gunfire | null = null;
  /** The session's gunfire, for views that hold no game (a creature skin's shot). */
  static current(): Gunfire | null { return Gunfire.last; }
  static for(game: Game): Gunfire {
    let fire = Gunfire.byGame.get(game);
    if (fire === undefined) {
      const made = new Gunfire(game); fire = made; Gunfire.byGame.set(game, made); Gunfire.last = made;
      game.onUpdate(() => { made.update(worldTime.realDt); }, 'world.gunfire');
    }
    return fire;
  }

  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly clouds: Cloud[] = [];
  private nextTracer = 0; private nextFlash = 0; private nextCloud = 0;
  private seed = 9187;
  private readonly root = new THREE.Group();
  private readonly game: Game;
  private constructor(game: Game) {
    this.game = game;
    this.root.name = 'gunfire';
    const streak = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
    for (let i = 0; i < TRACERS; i++) {
      const material = new THREE.MeshBasicMaterial({ color: TONES.own, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(streak, material); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 11;
      this.root.add(mesh); this.tracers.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), length: 0, t: 0, live: false });
    }
    // fog: false, like every engine sprite: Atmosphere's fog_vertex reads `transformed`, which three's sprite shader never
    // declares (with fog on, the program fails to link and T1's page-error check reds)
    const flashMap = makeFlashTexture();
    for (let i = 0; i < FLASHES; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false , fog: false }));
      sprite.visible = false; sprite.renderOrder = 12; this.root.add(sprite); this.flashes.push({ sprite, t: 0, size: 0, live: false });
    }
    const puff = cloudTexture();
    for (let i = 0; i < CLOUDS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0xd8b98a, transparent: true, depthWrite: false, opacity: 0 , fog: false }));
      sprite.visible = false; sprite.renderOrder = 10; this.root.add(sprite);
      this.clouds.push({ sprite, velocity: new THREE.Vector3(), t: 0, life: 1, size: 1, grow: 1, live: false });
    }
    game.scene.add(this.root);
  }
  private random(): number { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }

  /** A round's streak from `from` to `to`. */
  shot(from: THREE.Vector3, to: THREE.Vector3, tone: TracerTone = 'own'): void {
    const tracer = this.tracers[this.nextTracer++ % TRACERS]; if (tracer === undefined) return;
    tracer.from.copy(from); tracer.to.copy(to); tracer.length = from.distanceTo(to); tracer.t = 0; tracer.live = tracer.length > 0.3;
    (tracer.mesh.material as THREE.MeshBasicMaterial).color.copy(TONES[tone]);
  }
  /** A world muzzle flash at `at`, `size` metres across. */
  flash(at: THREE.Vector3, size: number): void {
    const flash = this.flashes[this.nextFlash++ % FLASHES]; if (flash === undefined) return;
    flash.sprite.position.copy(at); flash.size = size; flash.t = 0; flash.live = true;
    flash.sprite.material.rotation = this.random() * Math.PI * 2;
  }
  /** Where a round stops: a sand cloud and grit, sparks off metal, a dark spray off a body. `dir` is the round's way. */
  impact(at: THREE.Vector3, dir: THREE.Vector3, kind: GunfireImpact): void {
    const impacts = Impacts.for(this.game), back = _dir.copy(dir).negate();
    if (kind === 'dust') {
      impacts.burst('sand', at, back, 12); impacts.burst('dirt', at, back, 6);
      for (let i = 0; i < 4; i++) this.cloud(at, back, 0.6, 0.55, 0.8 + this.random() * 0.5, 2.6, 0xa8825a);
    } else if (kind === 'sparks' || kind === 'armour') {
      impacts.burst('sparks', at, back, kind === 'armour' ? 14 : 10);
      if (kind === 'armour') this.cloud(at, back, 0.2, 0.5, 0.35, 0.6, 0xbfb6a8);
    } else {
      impacts.burst('sparks', at, back, 6);
      this.cloud(at, back, 0.25, 0.6, 0.4, 0.9, 0x9a5a3c);
    }
  }
  /** A big body's dust: `count` clouds round `at` within `radius`, swelling out and up. */
  dust(at: THREE.Vector3, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2, r = radius * Math.sqrt(this.random());
      _a.set(at.x + Math.cos(a) * r, at.y + this.random() * 0.4, at.z + Math.sin(a) * r);
      _b.set(Math.cos(a), 0.6 + this.random(), Math.sin(a));
      this.cloud(_a, _b, 1.2 + this.random() * 1.2, 2.6, 1.6 + this.random() * 1.2, 2.4);
    }
    Impacts.for(this.game).burst('sand', at, _up, 24);
  }
  /** Shake the camera (0..1 trauma), as a blow nearby does. */
  shake(trauma: number): void { CameraFX.for(this.game).addTrauma(trauma); }
  /** A blow at `at` felt in the view: `trauma` at its foot, fading to nothing `QUAKE_RANGE` m away. */
  quake(at: THREE.Vector3, trauma: number): void {
    this.game.camera.getWorldPosition(_cam);
    const felt = trauma * Math.max(0, 1 - at.distanceTo(_cam) / QUAKE_RANGE);
    if (felt > 0.02) this.shake(felt);
  }
  /** A fountain of hot gold sparks and a warm cloud bursting up out of `at` (a big kill's spoils). */
  shower(at: THREE.Vector3): void {
    const impacts = Impacts.for(this.game);
    impacts.burst('sparks', at, _up, 40); impacts.burst('sand', at, _up, 16);
    for (let i = 0; i < 6; i++) this.cloud(at, _up, 1.6, 0.9, 1.4 + this.random() * 0.6, 2.8, 0xf2c45a);
  }
  /** A shot's kick of the view: up `pitchDeg`, rolled `rollDeg`. */
  kick(pitchDeg: number, rollDeg: number): void { CameraFX.for(this.game).kick(pitchDeg, rollDeg); }
  /**
   * A creature's round at the player (QA42: "They're clearly shooting at me ... There's no bullets"): a flash and a puff
   * of smoke at `muzzle`, and an enemy tracer that passes a hand's width off the eye and runs on past it, so it reads as a
   * round coming in without filling the view. Nothing within `MIN_ENEMY_RANGE` (a knife's reach: the rusher's lunge).
   * Returns whether it drew.
   */
  enemyRound(muzzle: THREE.Vector3): boolean {
    this.game.camera.getWorldPosition(_cam);
    const range = muzzle.distanceTo(_cam);
    if (range < MIN_ENEMY_RANGE) return false;
    _dir.subVectors(_cam, muzzle).divideScalar(range);
    // a near miss: off to one side and a little low, then on past the eye
    _b.crossVectors(_dir, _up); if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0); _b.normalize();
    const side = (this.random() < 0.5 ? -1 : 1) * (0.25 + this.random() * 0.25);
    _a.copy(_cam).addScaledVector(_b, side).addScaledVector(_up, -0.15 - this.random() * 0.15).addScaledVector(_dir, ENEMY_OVERSHOOT);
    this.flash(muzzle, 0.55);
    this.cloud(muzzle, _dir, 0.4, 0.25, 0.6, 2.2, 0xcfc6b8);
    this.shot(muzzle, _a, 'enemy');
    return true;
  }
  /** Live pooled pieces, for a probe or a test. */
  get live(): { readonly tracers: number; readonly flashes: number; readonly clouds: number } {
    return { tracers: this.tracers.filter(t => t.live).length, flashes: this.flashes.filter(f => f.live).length, clouds: this.clouds.filter(c => c.live).length };
  }

  private cloud(at: THREE.Vector3, dir: THREE.Vector3, speed: number, size: number, life: number, grow: number, colour = 0xd8b98a): void {
    const cloud = this.clouds[this.nextCloud++ % CLOUDS]; if (cloud === undefined) return;
    cloud.sprite.position.copy(at);
    cloud.velocity.set(dir.x + (this.random() - 0.5) * 0.8, Math.abs(dir.y) * 0.5 + 0.3 + this.random() * 0.4, dir.z + (this.random() - 0.5) * 0.8).normalize().multiplyScalar(speed);
    cloud.t = 0; cloud.life = life; cloud.size = size * (0.7 + this.random() * 0.6); cloud.grow = grow; cloud.live = true;
    cloud.sprite.material.color.setHex(colour); cloud.sprite.material.rotation = this.random() * Math.PI * 2;
  }

  private update(dt: number): void {
    const camera = this.game.camera; camera.getWorldPosition(_cam);
    for (const tracer of this.tracers) {
      if (!tracer.live) { tracer.mesh.visible = false; continue; }
      tracer.t += dt;
      const run = tracer.t * TRACER_SPEED, head = Math.min(tracer.length, run), tail = Math.max(0, run - TRACER_LENGTH);
      if (tail >= tracer.length - 0.01) { tracer.live = false; tracer.mesh.visible = false; continue; }
      _dir.subVectors(tracer.to, tracer.from).divideScalar(tracer.length);
      _a.copy(tracer.from).addScaledVector(_dir, tail); _b.copy(tracer.from).addScaledVector(_dir, head);
      const width = Math.max(TRACER_MIN_WIDTH, _a.distanceTo(_cam) * TRACER_ANGLE);
      tracer.mesh.position.copy(_b); tracer.mesh.quaternion.setFromUnitVectors(_z, _dir.negate());
      tracer.mesh.scale.set(width, width, Math.max(0.01, head - tail)); tracer.mesh.visible = true;
    }
    for (const flash of this.flashes) {
      if (!flash.live) { flash.sprite.visible = false; continue; }
      flash.t += dt;
      if (flash.t >= FLASH_SECONDS) { flash.live = false; flash.sprite.visible = false; continue; }
      const k = 1 - flash.t / FLASH_SECONDS; flash.sprite.scale.setScalar(flash.size * (0.7 + 0.5 * k)); flash.sprite.material.opacity = k; flash.sprite.visible = true;
    }
    for (const cloud of this.clouds) {
      if (!cloud.live) { cloud.sprite.visible = false; continue; }
      cloud.t += dt;
      if (cloud.t >= cloud.life) { cloud.live = false; cloud.sprite.visible = false; continue; }
      const u = cloud.t / cloud.life;
      cloud.velocity.multiplyScalar(Math.exp(-dt * 2.5));
      cloud.sprite.position.addScaledVector(cloud.velocity, dt);
      cloud.sprite.scale.setScalar(cloud.size * (1 + (cloud.grow - 1) * Math.sqrt(u)));
      cloud.sprite.material.opacity = 0.9 * (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9);
      cloud.sprite.visible = true;
    }
  }
}

/** A soft round puff: white in the middle, fading out, alpha in the texture. */
function cloudTexture(): THREE.CanvasTexture {
  const size = 64, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); if (ctx === null) throw new Error('Gunfire: no 2d canvas context');
  for (const [x, y, r] of [[32, 34, 26], [22, 30, 16], [42, 28, 15], [32, 22, 14]] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.6, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
