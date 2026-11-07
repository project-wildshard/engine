import * as THREE from 'three';
import { Scope } from '../../shared/engine/app/scope';
import { installBrowserScopeEnvironment } from '../../client/engine/app/view/scopeEnvironment';
import type { Game, FixedPhase } from '../../client/engine/core/Game';
import { FIXED_STEP } from '../../shared/engine/core/fixedStep';
import { makeSystem, setLoopState, systemFault, type GameSystem } from '../../shared/engine/core/faults';
import { worldTime } from '../../shared/engine/core/time';
import { ViewmodelRoot } from '../../client/engine/render/viewmodel';

type Tick = (dt: number) => void;
type Update = (dt: number, t: number) => void;

/** Manual, renderer-free counterpart of Game.start. F8 replaces the phase driver with the engine scheduler. */
export class FakeGame {
  constructor() {
    installBrowserScopeEnvironment({ Mesh: THREE.Mesh, InstancedMesh: THREE.InstancedMesh });
  }
  readonly playerScope = new Scope('fake-player');
  readonly rootScene = new THREE.Scene();
  readonly scene = this.rootScene;
  readonly camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 2600);
  readonly viewmodel = new ViewmodelRoot();
  readonly clock = { elapsedTime: 0 };
  readonly renderer = {
    info: { render: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 } },
    getDrawingBufferSize: (out: THREE.Vector2): THREE.Vector2 => out.set(1600, 900),
  };
  dead = false;
  alpha = 0;
  fixedSteps = 0;
  frameCount = 0;
  private fixedAcc = 0;
  private stopLeft = 0;
  private readonly inputs: GameSystem<Tick>[] = [];
  private readonly fixed: Record<FixedPhase, GameSystem<Tick>[]> = { pre: [], step: [], post: [] };
  private readonly updaters: GameSystem<Update>[] = [];
  private readonly lates: GameSystem<Tick>[] = [];

  /** Legacy constructors demand all of Game, but only use the surface implemented here. */
  asGame(): Game {
    this.camera.add(this.viewmodel); this.scene.add(this.camera);
    return legacyDouble<Game>({
      scene: this.scene, rootScene: this.rootScene, camera: this.camera, viewmodel: this.viewmodel,
      renderer: legacyDouble<THREE.WebGLRenderer>({
        getDrawingBufferSize: this.renderer.getDrawingBufferSize,
        info: legacyDouble<THREE.WebGLInfo>(this.renderer.info),
        // SF59: a shard that compiles a material graph installs the node handler (nothing renders here)
        setNodesHandler: () => undefined,
      }),
      onInput: this.onInput.bind(this), onFixed: this.onFixed.bind(this),
      playerScope: this.playerScope, onPlayerUpdate: this.onUpdate.bind(this), onUpdate: this.onUpdate.bind(this), onLate: this.onLate.bind(this), hitStop: this.hitStop.bind(this),
    });
  }
  onInput(fn: Tick, label?: string, core = false): void { this.inputs.push(makeSystem(fn, label, core, `input#${this.inputs.length}`)); }
  onFixed(phase: FixedPhase, fn: Tick, label?: string, core = false): void { this.fixed[phase].push(makeSystem(fn, label, core, `fixed.${phase}#${this.fixed[phase].length}`)); }
  onUpdate(fn: Update, label?: string, core = false): void { this.updaters.push(makeSystem(fn, label, core, `update#${this.updaters.length}`)); }
  onLate(fn: Tick, label?: string, core = false): void { this.lates.push(makeSystem(fn, label, core, `late#${this.lates.length}`)); }
  hitStop(seconds: number): void { this.stopLeft = Math.max(this.stopLeft, seconds); }
  private isDead(): boolean { return this.dead; }

  private run<F extends Tick | Update>(systems: readonly GameSystem<F>[], invoke: (fn: F) => void): void {
    for (const s of systems) {
      if (!s.on) continue;
      try { invoke(s.fn); } catch (error) {
        if (systemFault(s, error, this.frameCount, this.clock.elapsedTime * 1000) === 'fatal') this.dead = true;
      }
    }
  }

  /** One rendered frame; seconds are real time, clamped exactly as Game.start clamps getDelta(). */
  advance(seconds: number, { fixedHz = 1 / FIXED_STEP } = {}): void {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(fixedHz) || fixedHz <= 0) throw new RangeError('invalid manual step');
    if (this.isDead()) return;
    setLoopState('running');
    this.clock.elapsedTime += seconds;
    const realDt = Math.min(0.1, seconds);
    let scale = 1;
    if (this.stopLeft > 0) { this.stopLeft -= realDt; scale = 0.04; }
    worldTime.scale = scale; worldTime.realDt = realDt;
    const dt = realDt, step = 1 / fixedHz;
    this.frameCount++;
    this.renderer.info.render.calls = 0;
    this.run(this.inputs, (fn) => fn(dt));
    this.fixedAcc += dt;
    let n = 0;
    while (this.fixedAcc >= step && n < 3) {
      this.run(this.fixed.pre, (fn) => fn(step));
      this.run(this.fixed.step, (fn) => fn(step));
      this.run(this.fixed.post, (fn) => fn(step));
      this.fixedAcc -= step; n++;
    }
    if (n === 3 && this.fixedAcc >= step) this.fixedAcc %= step;
    this.alpha = this.fixedAcc / step; this.fixedSteps = n;
    this.run(this.updaters, (fn) => fn(dt, this.clock.elapsedTime));
    this.run(this.lates, (fn) => fn(dt));
    if (this.isDead()) return;
    this.renderer.info.render.calls = 1;
    this.renderer.info.render.frame++;
  }
}

/** Legacy APIs accept a concrete class. Fail loudly if they start reading an unimplemented test-double member. */
export function legacyDouble<T extends object>(surface: Partial<T>): T {
  return new Proxy(surface, {
    get(target, key, receiver): unknown {
      if (!Reflect.has(target, key)) throw new Error(`test double does not implement ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  }) as T;
}

/** mulberry32, scoped by its returned restore function (call in afterEach). */
export function seedRandom(seed = 0x2545f491): () => void {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = original; };
}
