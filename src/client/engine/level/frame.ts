import type { Scope } from '../../../shared/engine/app/scope';
import type { TexturePolicyBinding } from '../boot/gpuFiles';
import { withOwner } from '../../../shared/engine/app/ownership';
import { bindChunkConstants, CHUNK_COORDS, SEED, TREE_COUNT } from '../../../shared/engine/core/config';
import type { Navmesh } from '../../../shared/engine/physics/navmesh';
import { bindHeightfield, captureHeightfield, HeightfieldBinding } from '../../../shared/engine/world/Heightfield';
import type { WaterBodies } from '../../../shared/engine/world/water/body';
import { bindLevelSelection, type LevelLookParts } from '../../../shared/engine/level/selection';
import type { LevelSpec } from '../../../shared/engine/level/spec';

/** The level-dependent app slots; physics, renderer, scene and player are bound separately. */
export interface LevelFrameHost {
  levelScope: Scope | null;
  navmesh: Navmesh | null;
  navmeshId: string | null;
  world: { bindWater: (water: WaterBodies) => () => void };
}
/** Retained regional resources, owned by the resident rather than the page. */
export interface LevelFrameOptions {
  level: LevelSpec;
  scope: Scope;
  /** Common level identity for sibling runtime registrations; resources still belong to scope. */
  levelScope?: Scope;
  water: WaterBodies;
  navmesh: Navmesh | null;
  /** Retained asset policy; absent keeps the configured page's existing texture choice. */
  textures?: Pick<TexturePolicyBinding, 'enter'>;
  /**
   * The level's own resolved look parts (its grass driver), bound with the level while the frame is entered (SF63): the
   * region's content builds its own level's grass, not the page look's. Absent / null: the engine defaults.
   */
  look?: LevelLookParts | null;
}
interface HostPorts { scope: Scope | null; navmesh: Navmesh | null; navmeshId: string | null }
interface HostFrame { ports: HostPorts }
interface HostBindings { home: HostPorts; frames: HostFrame[] }
const hosts = new WeakMap<LevelFrameHost, HostBindings>();
function read(host: LevelFrameHost): HostPorts { return { scope: host.levelScope, navmesh: host.navmesh, navmeshId: host.navmeshId }; }
function apply(host: LevelFrameHost, ports: HostPorts): void { host.levelScope = ports.scope; host.navmesh = ports.navmesh; host.navmeshId = ports.navmeshId; }

/**
 * Retains one local terrain/bake and explicitly enters its level-dependent engine services.
 * Does not allocate physics, register systems, select a document or load content. Enter alongside
 * the region's registry/frame binding; leave before home callbacks resume. Async terrain builds
 * capture `terrain`, so they do not borrow whichever frame happens to be active on completion.
 */
export class LevelFrameBinding {
  readonly terrain: HeightfieldBinding;
  private readonly options: LevelFrameOptions;
  private readonly constants: { slug: string; label: string; seed: number; treeCount: number };
  constructor(options: LevelFrameOptions) {
    if (options.scope.disposed || options.levelScope?.disposed === true) throw new Error('Level frame requires a live resident scope');
    this.options = options;
    this.terrain = new HeightfieldBinding(options.level);
    this.constants = { slug: options.level.id, label: options.level.label ?? CHUNK_COORDS, seed: options.level.seed ?? SEED, treeCount: options.level.treeCount ?? TREE_COUNT };
  }
  /** Install until either the entered scope or retained resident scope leaves; return an early leave. */
  enter(host: LevelFrameHost, entered: Scope): () => void {
    if (entered.disposed || this.options.scope.disposed || this.options.levelScope?.disposed === true) throw new Error('Cannot enter a disposed level frame');
    const { level, scope, navmesh, water } = this.options;
    captureHeightfield();
    let bindings = hosts.get(host);
    if (bindings === undefined) { bindings = { home: read(host), frames: [] }; hosts.set(host, bindings); }
    const retained = bindings;
    const frame: HostFrame = { ports: { scope: this.options.levelScope ?? scope, navmesh, navmeshId: navmesh === null ? null : level.id } };
    const leaveLevel = bindLevelSelection(level, this.options.look ?? null);
    const leaveTerrain = bindHeightfield(this.terrain);
    const leaveConstants = bindChunkConstants(this.constants);
    const leaveWater = host.world.bindWater(water);
    const leaveTextures = this.options.textures?.enter();
    retained.frames.push(frame); apply(host, frame.ports);
    let active = true;
    let forgetEntered: () => void = () => undefined;
    let forgetResident: () => void = () => undefined;
    const leave = (): void => {
      if (!active) return;
      active = false; forgetEntered(); forgetResident();
      const index = retained.frames.indexOf(frame);
      if (index !== -1) retained.frames.splice(index, 1);
      leaveTextures?.(); leaveWater(); leaveConstants(); leaveTerrain(); leaveLevel();
      apply(host, retained.frames.at(-1)?.ports ?? retained.home);
      if (retained.frames.length === 0) hosts.delete(host);
    };
    forgetEntered = entered.capture('disposers', leave);
    forgetResident = scope.capture('disposers', leave);
    return leave;
  }
  /** Synchronous setup/query under the resident owner; never hold ambient slots across an await. */
  run<T>(host: LevelFrameHost, run: () => T): T {
    const entered = this.options.scope.child('level.frame.setup');
    const leave = this.enter(host, entered);
    try { return withOwner(this.options.scope, run); }
    finally { leave(); entered.dispose(); }
  }
}
