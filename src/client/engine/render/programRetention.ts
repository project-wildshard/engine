import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Camera, type Object3D, type Scene } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';

/** A native program-cache reference, independent of geometry, textures and live material uniforms. */
export interface ProgramReference { readonly cacheKey: string; usedTimes: number }
export const RETAINED_PROGRAM_LIMIT = 512;
/** Conservative admission estimate; native driver storage remains a measured, report-only quantity. */
export const RETAINED_PROGRAM_BYTES: number = 256 * 1024;

/** Add one material-owned reference per unique compiled key. Preflight before changing any reference count. */
export function pinProgramReferences(held: Map<string, ProgramReference>, programs: readonly ProgramReference[]): number {
  const unique = new Map(programs.map(program => [program.cacheKey, program]));
  const added = [...unique].filter(([key]) => !held.has(key));
  if (held.size + added.length > RETAINED_PROGRAM_LIMIT) throw new Error('Loading program inventory exceeds its bound');
  for (const [key, program] of unique) {
    if (!Number.isSafeInteger(program.usedTimes) || program.usedTimes < 1 || held.has(key) && held.get(key) !== program) throw new Error('Invalid loading program reference');
  }
  for (const [key, program] of added) { program.usedTimes += 1; held.set(key, program); }
  return held.size;
}

function programMap(value: unknown): value is Map<string, ProgramReference> {
  if (!(value instanceof Map)) return false;
  const entries: Iterable<[unknown, unknown]> = value.entries();
  for (const [key, program] of entries) {
    if (typeof key !== 'string' || typeof program !== 'object' || program === null
      || Reflect.get(program, 'cacheKey') !== key || typeof Reflect.get(program, 'usedTimes') !== 'number') return false;
  }
  return true;
}

/** What a program holder needs of the renderer: its compiled program list, compile, and (read by reflection) its material
 *  properties. */
export interface ProgramRenderer {
  readonly info: { readonly programs?: readonly ProgramReference[] | null };
  compile: (object: Mesh, camera: Camera, scene: Scene) => unknown;
}

/** A page-owned material whose ordinary program map holds extra program references: its disposal releases them. */
function programHolder(renderer: ProgramRenderer, owner: Scope, camera: Camera, scene: Scene): { material: MeshBasicMaterial; held: Map<string, ProgramReference> } {
  const material = owner.own(new MeshBasicMaterial()), geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  try { renderer.compile(new Mesh(geometry, material), camera, scene); } finally { geometry.dispose(); }
  const properties: unknown = Reflect.get(renderer, 'properties');
  const get: unknown = typeof properties === 'object' && properties !== null ? Reflect.get(properties, 'get') : undefined;
  const data: unknown = typeof get === 'function' ? Reflect.apply(get, properties, [material]) : undefined;
  const held: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'programs') : undefined;
  if (!programMap(held)) throw new Error('Renderer lacks its ordinary material program owner');
  return { material, held };
}

/** Programs kept across world retirements (see createProgramKeeper). */
export interface ProgramKeeper {
  /** Pin every program the renderer holds now under `label` (a world about to retire), replacing that label's earlier
   *  pin; the oldest labels release first while the kept programs exceed the keeper's limit. Returns the programs kept:
   *  0, keeping nothing, once its owner left or while the renderer holds more programs than the limit. */
  keep: (label: string) => number;
  /** the distinct programs kept */
  readonly size: number;
}

/**
 * G580 T2: keep compiled programs across world retirement, so a revisited world, or one sharing materials with the last,
 * links nothing again. Each `keep` pins the renderer's current programs on its own page-owned holder material, newest
 * last; past `limit` distinct programs the oldest holders are disposed, and three's ordinary disposal releases only the
 * programs nothing else uses. `owner` ends every pin.
 */
export function createProgramKeeper(renderer: ProgramRenderer, owner: Scope, camera: Camera, scene: Scene, limit: number = RETAINED_PROGRAM_LIMIT): ProgramKeeper {
  const holders = new Map<string, ReturnType<typeof programHolder>>();
  const distinct = (): number => { const keys = new Set<string>(); for (const holder of holders.values()) for (const key of holder.held.keys()) keys.add(key); return keys.size; };
  return {
    keep: label => {
      const programs = renderer.info.programs ?? [];
      if (owner.disposed || owner.disposing || programs.length > limit) return 0;
      const next = programHolder(renderer, owner, camera, scene);
      pinProgramReferences(next.held, programs);
      const previous = holders.get(label);
      holders.delete(label); holders.set(label, next); previous?.material.dispose();
      for (const [oldest, holder] of holders) {
        if (holders.size <= 1 || distinct() <= limit) break;
        holders.delete(oldest); holder.material.dispose();
      }
      return next.held.size;
    },
    get size() { return distinct(); },
  };
}

/** The most distinct programs a view keeper holds (`createViewProgramKeeper`). */
export const VIEW_PROGRAM_LIMIT = 48;

/** The programs three compiled for `material` (its ordinary program map), none when it has not compiled. */
function materialPrograms(renderer: ProgramRenderer, material: object): ProgramReference[] {
  const properties: unknown = Reflect.get(renderer, 'properties');
  const get: unknown = typeof properties === 'object' && properties !== null ? Reflect.get(properties, 'get') : undefined;
  const data: unknown = typeof get === 'function' ? Reflect.apply(get, properties, [material]) : undefined;
  const programs: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'programs') : undefined;
  return programMap(programs) ? [...programs.values()] : [];
}

/**
 * D12: keep the programs a streamed view's materials linked for `owner`'s life, so a view that retires and comes back (a
 * near placeholder the eye leaves and nears again, a far proxy refined away and restored) reuses them rather than linking
 * again: the Simulator spawn relinked one near placeholder's program 3 s after retiring it, and on WebKit every link in
 * play costs a 33-45 ms frame. One page-owned holder; a program kept once stays kept; past `limit` distinct programs a
 * view's new ones are not kept. Returns the keep, which answers the programs kept so far (0 once `owner` left).
 */
export function createViewProgramKeeper(renderer: ProgramRenderer, owner: Scope, camera: Camera, scene: Scene, limit: number = VIEW_PROGRAM_LIMIT): (root: Object3D) => number {
  let holder: ReturnType<typeof programHolder> | null = null;
  return root => {
    if (owner.disposed || owner.disposing) return 0;
    const programs = new Map<string, ProgramReference>();
    root.traverse(object => {
      const material: unknown = Reflect.get(object, 'material');
      const list: readonly unknown[] = Array.isArray(material) ? material : [material];
      for (const one of list) {
        if (typeof one === 'object' && one !== null && Reflect.get(one, 'isMaterial') === true) for (const program of materialPrograms(renderer, one)) programs.set(program.cacheKey, program);
      }
    });
    holder ??= programHolder(renderer, owner, camera, scene);
    const held = holder.held, fresh = [...programs.keys()].filter(key => !held.has(key)).length;
    if (fresh === 0 || held.size + fresh > limit) return held.size;
    return pinProgramReferences(held, [...programs.values()]);
  };
}
