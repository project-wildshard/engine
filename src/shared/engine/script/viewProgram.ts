/**
 * G600 L7: one view module and its rows (format/viewProgram) as a view-lane owner (SCRIPT-ABI v2, lane 3; WASM-HOST H9).
 * Each displayed frame it samples its binding's columns (the player, a registry piece's floor under the player,
 * constants, each pool's actor slots), runs the lane, re-adds the last landed bank's camera channels and, on landing,
 * writes its look, visibility, opacity, uniform, instanced-attribute and lent-cell channels, draws each lent ground tell
 * from its channels (its ring, lane or wedge, or hides it), and puts each validated matrix on its
 * target: a lent object, a named bone under it, one copy of a lent instanced draw, or the actor bound to a pool slot.
 * Every target is claimed once for its owner's life (a slot's actor for as long as it holds the slot) and restored when
 * it ends; a rendered pose is a visual only and never an authority position. It names no renderer class, so a host that
 * draws nothing can run a view whose only writes are lent cells (CI12).
 */
import { Color, Matrix4, Quaternion, Vector3, type BufferAttribute, type BufferGeometry, type Camera, type InstancedMesh, type InterleavedBufferAttribute,
  type Material, type Object3D, type ShaderMaterial } from 'three';
import { viewTellShape, type ViewProgramRows, type ViewTargetRef, type ViewTellShape } from '@wildshard/format/viewProgram';
import type { Scope } from '../app/scope';
import { ViewLane, type PreparedViewMemory } from './viewLane';
import { diagnosticNow } from '../core/clock';

/** The actor bound to one slot: its identity (a new one starts uninterpolated), pose, life, the ground under it, its
 *  named finite fields, the visual fields a program may set, and its drawn object. */
export interface ViewSlotActor {
  readonly identity: string; readonly object: Object3D;
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly alive: boolean; readonly ground: number;
  field: (name: string) => number;
  set: (name: string, value: number) => void;
}
/** What a program moves of its owner's camera: a server lends these two fields alone. */
export type ViewCamera = Pick<Camera, 'position' | 'rotation'>;
/** A ground tell its owner lends (engine/fx/groundTell): its draped ring, lane and wedge, or hidden. */
export interface ViewTell {
  ring: (x: number, z: number, radius: number, alpha: number) => void;
  lane: (x: number, z: number, x1: number, z1: number, width: number, alpha: number) => void;
  wedge: (x: number, z: number, yaw: number, reach: number, fill: number, alpha: number) => void;
  hide: () => void;
}
/** A native group's ordered slots, as its owner binds them (null: the slot is free); `refresh` (optional) rebinds them once a
 *  frame, before the program reads any of them. */
export interface ViewSlots { refresh?: () => void; actor: (slot: number) => ViewSlotActor | null }
/** What a program borrows from its owner. `floor` / `slots` are null for a piece / group the owner lacks. */
export interface ViewProgramPorts {
  readonly scope: Scope;
  /** An admitted slot may prepare its private memory before the native lender binds. */
  readonly preparedMemory?: PreparedViewMemory;
  readonly player: { readonly position: Vector3; readonly velocity: Vector3; readonly yaw: number };
  /** The display rate the lane's rate policy may halve the guest from (default 60: down to every fourth frame when it runs
   *  over its time target). A host that needs every frame (CI12's Node simulation, whose decisions read the cells) passes
   *  15: the guest then runs on every frame whatever it costs. */
  readonly displayHz?: number;
  readonly camera: ViewCamera;
  /** a lent numeric snapshot by id: each named field read once a frame; null for one the owner lacks */
  readonly values: (source: string) => ((field: string) => number) | null;
  readonly floor: (piece: string) => ((x: number, z: number) => number | undefined) | null;
  readonly slots: (group: string) => ViewSlots | null;
  readonly object: (id: string) => Object3D;
  readonly look: (look: string, param: string, value: number) => void;
  /** a lent numeric cell by id, written on landing (absent: the owner lends none) */
  readonly cell?: (id: string) => { value: number };
  /** a lent ground tell by id (absent: the owner lends none) */
  readonly tell?: (id: string) => ViewTell;
  /** a lent numeric array by id, read whole once a frame (absent: the owner lends none) */
  readonly array?: (id: string) => () => ArrayLike<number>;
  /** a lent instanced draw by id that a frame writes in bulk (absent: the owner lends none) */
  readonly draw?: (id: string) => InstancedMesh;
}
export interface ViewProgram {
  /** one displayed frame: the presentation delta and its system's frame time (the `clock` sample), seconds; whether the
   *  module ran (the lane's rate may skip a frame: an owner that hands it one-frame events keeps them until it runs) */
  frame: (dt: number, time: number) => boolean;
  readonly frozen: boolean;
}

/** Every claimed target of every live program: an object's transform or channel, or one instanced copy. */
const claims = new WeakMap<object, Set<string>>();
/** Claim `key` on `target` until `release` (returned) or the scope ends; `restore` runs on either. */
function claim(scope: Scope, target: object, key: string, restore: () => void): () => void {
  let held = claims.get(target); if (held === undefined) { held = new Set(); claims.set(target, held); }
  if (held.has(key)) throw new Error(`View target is already lent: ${key}`);
  held.add(key);
  let open = true;
  const release = (): void => { if (!open) return; open = false; held.delete(key); restore(); };
  scope.onDispose(release);
  return release;
}
/** A renderer object by its own class flag: nothing here loads a renderer class. */
const flagged = (value: unknown, flag: string): boolean => typeof value === 'object' && value !== null && Reflect.get(value, flag) === true;
const isMaterial = (value: unknown): value is Material => flagged(value, 'isMaterial');
const isShaderMaterial = (value: unknown): value is ShaderMaterial => flagged(value, 'isShaderMaterial');
const isInstanced = (value: unknown): value is InstancedMesh => flagged(value, 'isInstancedMesh');
const isGeometry = (value: unknown): value is BufferGeometry => flagged(value, 'isBufferGeometry');
const isAttribute = (value: unknown): value is BufferAttribute => flagged(value, 'isBufferAttribute');
const isInterleaved = (value: unknown): value is InterleavedBufferAttribute => flagged(value, 'isInterleavedBufferAttribute');
const numberCell = (cell: unknown): cell is { value: number } => typeof cell === 'object' && cell !== null && 'value' in cell && typeof cell.value === 'number';
const materials = (object: Object3D): Material[] => {
  const value: unknown = Reflect.get(object, 'material'), list: readonly unknown[] = Array.isArray(value) ? value : [value];
  return list.filter(isMaterial);
};
/** One write site over a lent object: claim it (saving what it restores) and set a value; re-made when a slot rebinds. */
type Site = (object: Object3D, release: (restore: () => void, key: string) => void) => (value: number | Matrix4) => void;

/** Install a program over its admitted module bytes, or null when a sampled piece or a pool's group is absent. */
export function viewProgram(bytes: Uint8Array, rows: ViewProgramRows, ports: ViewProgramPorts): ViewProgram | null {
  const floors = new Map<string, (x: number, z: number) => number | undefined>(), pools = new Map<string, { readonly slots: ViewSlots; readonly row: ViewProgramRows['pools'][number] }>();
  for (const row of rows.samples) if (row.kind === 'floor' && !floors.has(row.piece)) {
    const floor = ports.floor(row.piece); if (floor === null) return null; floors.set(row.piece, floor);
  }
  for (const row of rows.pools) { const slots = ports.slots(row.group); if (slots === null) return null; pools.set(row.id, { slots, row }); }
  const sources = new Map<string, (field: string) => number>();
  for (const row of rows.samples) if (row.kind === 'value' && !sources.has(row.source)) {
    const read = ports.values(row.source); if (read === null) return null; sources.set(row.source, read);
  }
  const scope = ports.scope, live = (): boolean => !scope.disposed && !scope.disposing, displayHz = ports.displayHz ?? 60;
  const position = new Vector3(), rotation = new Quaternion(), size = new Vector3();
  /** A target: a lent object is resolved and claimed once; a slot's actor on each write, re-claimed when its identity changes. */
  const target = (ref: ViewTargetRef, site: Site): ((value: number | Matrix4) => void) => {
    let identity: string | null = null, write: ((value: number | Matrix4) => void) | null = null, release: (() => void) | null = null;
    const bind = (object: Object3D, key: string): void => {
      release?.(); release = null;
      write = site(object, (restore, claimKey) => { release = claim(scope, object, `${key}:${claimKey}`, restore); });
    };
    if (typeof ref === 'string') { bind(ports.object(ref), 'lent'); return value => { write?.(value); }; }
    const pool = pools.get(ref.pool); if (pool === undefined) throw new Error(`Unknown view pool ${ref.pool}`);
    return value => {
      const actor = pool.slots.actor(ref.slot);
      if (actor === null) { release?.(); release = null; identity = null; write = null; return; }
      if (actor.identity !== identity) {
        identity = actor.identity;
        const object = ref.part === undefined ? actor.object : actor.object.getObjectByName(ref.part);
        // a part its owner adds after the actor appears binds the frame it appears
        if (object === undefined) { release?.(); release = null; identity = null; write = null; return; }
        bind(object, `${ref.pool}#${String(ref.slot)}`);
      }
      write?.(value);
    };
  };
  const transformSite = (bone: string | null): Site => (owner, lend) => {
    const object = bone === null ? owner : owner.getObjectByName(bone);
    if (object === undefined) throw new Error(`View bone ${bone ?? ''} is missing`);
    const saved = { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone(), auto: object.matrixAutoUpdate };
    lend(() => { object.position.copy(saved.position); object.quaternion.copy(saved.quaternion); object.scale.copy(saved.scale); object.matrix.copy(saved.matrix);
      object.matrixAutoUpdate = saved.auto; object.matrixWorldNeedsUpdate = true; }, `transform:${bone ?? ''}`);
    return value => {
      if (typeof value === 'number') return;
      value.decompose(position, rotation, size);
      object.position.copy(position); object.quaternion.copy(rotation); object.scale.copy(size);
      object.matrix.copy(value); object.matrixAutoUpdate = false; object.matrixWorldNeedsUpdate = true;
    };
  };
  const setters = rows.transforms.map((row): ((value: number | Matrix4) => void) => {
    if (row.kind !== 'instance') return target(row.object, transformSite(row.kind === 'bone' ? row.bone : null));
    const owner = ports.object(row.object);
    if (!isInstanced(owner) || row.index >= owner.count) throw new Error(`View instance ${row.object}#${String(row.index)} is not a lent copy`);
    const saved = new Matrix4(), mesh = owner; mesh.getMatrixAt(row.index, saved);
    claim(scope, mesh, `instance:${String(row.index)}`, () => { mesh.setMatrixAt(row.index, saved); mesh.instanceMatrix.needsUpdate = true; });
    return value => { if (typeof value !== 'number') { mesh.setMatrixAt(row.index, value); mesh.instanceMatrix.needsUpdate = true; } };
  });
  // each lent tell its channels name, claimed for the owner's life (hidden when it ends); drawn after each landing
  const tells = new Map<string, { readonly tell: ViewTell; readonly params: Record<string, number>; readonly shape: ViewTellShape }>();
  for (const row of rows.channels) if (row.kind === 'tell' && !tells.has(row.tell)) {
    const tell = ports.tell?.(row.tell), shape = viewTellShape(rows.channels.flatMap(other => other.kind === 'tell' && other.tell === row.tell ? [other.param] : []));
    if (tell === undefined || shape === null) throw new Error(`View tell ${row.tell} is not lent`);
    claim(scope, tell, 'tell', () => { tell.hide(); });
    tells.set(row.tell, { tell, params: {}, shape });
  }
  const draw = (): void => {
    for (const { tell, params, shape } of tells.values()) {
      const p = (name: string): number => params[name] ?? 0, alpha = p('alpha');
      // a negative alpha leaves the tell as it is this landing (no draw, no hide: an owner that made no call there)
      if (alpha < 0) continue;
      if (alpha <= .01) tell.hide();
      else if (shape === 'ring') tell.ring(p('x'), p('z'), p('radius'), alpha);
      else if (shape === 'lane') tell.lane(p('x'), p('z'), p('x1'), p('z1'), p('width'), alpha);
      else tell.wedge(p('x'), p('z'), p('yaw'), p('reach'), p('fill'), alpha);
    }
  };
  // channels landed on landing; camera channels are re-added every displayed frame
  const writers = rows.channels.map((row): ((value: number) => void) | null => {
    if (row.kind === 'camera') return null;
    if (row.kind === 'cell') {
      const cell = ports.cell?.(row.cell); if (cell === undefined) throw new Error(`View cell ${row.cell} is not lent`);
      const saved = cell.value; claim(scope, cell, 'cell', () => { cell.value = saved; });
      return value => { cell.value = value; };
    }
    if (row.kind === 'tell') { const params = tells.get(row.tell)?.params; return value => { if (params !== undefined) params[row.param] = value; }; }
    if (row.kind === 'look') return value => { ports.look(row.look, row.param, value); };
    if (row.kind === 'field') {
      const pool = pools.get(row.pool); if (pool === undefined) throw new Error(`Unknown view pool ${row.pool}`);
      const slots = pool.slots;
      return value => { slots.actor(row.slot)?.set(row.field, value); };
    }
    if (row.kind === 'color') return target(row.object, (object, lend) => {
      const list = materials(object).flatMap(material => { const color: unknown = Reflect.get(material, 'color'); return color instanceof Color ? [color] : []; });
      if (list.length === 0) throw new Error('View colour target has no coloured material');
      const saved = list.map(color => color.clone());
      lend(() => { for (const [i, color] of list.entries()) color.copy(saved[i] ?? color); }, 'color');
      const [r, g, b] = row.color;
      return value => { if (typeof value === 'number') for (const color of list) color.setRGB(r * value, g * value, b * value); };
    });
    if (row.kind === 'visible') return target(row.object, (object, lend) => {
      const saved = object.visible; lend(() => { object.visible = saved; }, 'visible');
      return value => { if (typeof value === 'number') object.visible = value > .5; };
    });
    if (row.kind === 'opacity') return target(row.object, (object, lend) => {
      const list = materials(object), saved = list.map(material => material.opacity);
      if (list.length === 0) throw new Error('View opacity target has no material');
      lend(() => { for (const [i, material] of list.entries()) material.opacity = saved[i] ?? material.opacity; }, 'opacity');
      return value => { if (typeof value === 'number') for (const material of list) material.opacity = value; };
    });
    if (row.kind === 'uniform') return target(row.object, (object, lend) => {
      const cells = materials(object).flatMap(material => { const cell: unknown = isShaderMaterial(material) ? material.uniforms[row.uniform] : undefined; return numberCell(cell) ? [cell] : []; });
      if (cells.length === 0) throw new Error(`View uniform ${row.uniform} is not a number`);
      const saved = cells.map(cell => cell.value);
      lend(() => { for (const [i, cell] of cells.entries()) cell.value = saved[i] ?? cell.value; }, `uniform:${row.uniform}`);
      return value => { if (typeof value === 'number') for (const cell of cells) cell.value = value; };
    });
    const object = ports.object(row.object), geometry: unknown = Reflect.get(object, 'geometry');
    const cell: unknown = isGeometry(geometry) && geometry.hasAttribute(row.attribute) ? geometry.getAttribute(row.attribute) : undefined;
    if (!(isAttribute(cell) || isInterleaved(cell)) || row.index >= cell.count) throw new Error(`View attribute ${row.object}.${row.attribute} is missing`);
    const saved = cell.getComponent(row.index, row.component);
    const touch = (): void => { if (isInterleaved(cell)) cell.data.needsUpdate = true; else cell.needsUpdate = true; };
    claim(scope, cell, `${String(row.index)}:${String(row.component)}`, () => { cell.setComponent(row.index, row.component, saved); touch(); });
    return value => { cell.setComponent(row.index, row.component, value); touch(); };
  });
  // the binding's columns: each scalar sample, or a pool's block of slots (present, x, y, z, yaw, alive, fields)
  const width = (row: ViewProgramRows['samples'][number]): number => {
    if (row.kind !== 'pool') return 1;
    const pool = pools.get(row.pool)?.row; return pool === undefined ? 0 : pool.count * (7 + pool.fields.length);
  };
  const n = rows.samples.reduce((sum, row) => sum + width(row), 0), columns = new Float64Array(2 * n);
  const seen = new Map<string, (string | null)[]>([...pools].map(([key, pool]) => [key, Array.from({ length: pool.row.count }, () => null)]));
  const staged = rows.transforms.map(() => new Matrix4()), dirty = new Set<number>(), landed = new Float64Array(rows.channels.length);
  // each lent array and each lent instanced draw its rows name; a draw is claimed for the owner's life (its drawn count
  // restored when that ends) and its attribute must hold a component per instance for every one the row writes
  const arrayRows = rows.arrays ?? [], batchRows = rows.batches ?? [];
  const arrays = arrayRows.map(row => { const read = ports.array?.(row.id); if (read === undefined) throw new Error(`View array ${row.id} is not lent`); return read; });
  const batches = batchRows.map(row => {
    const mesh = ports.draw?.(row.draw); if (mesh === undefined) throw new Error(`View draw ${row.draw} is not lent`);
    const found: unknown = row.attribute === undefined ? null : mesh.geometry.getAttribute(row.attribute.name);
    const attribute = isAttribute(found) ? found : null;
    if (row.attribute !== undefined && (attribute === null || attribute.itemSize < row.attribute.itemSize || attribute.count < mesh.instanceMatrix.count)) throw new Error(`View draw ${row.draw} lacks its attribute`);
    const saved = mesh.count; claim(scope, mesh, 'batch', () => { mesh.count = saved; });
    return { mesh, attribute, itemSize: row.attribute?.itemSize ?? 0 };
  });
  const lane = new ViewLane(bytes, rows.budget.pages, { bindings: [{ handle: 1, columns: n }],
    transforms: rows.transforms.map((_, output) => ({ binding: 0, output, element: 0 })), channels: rows.channels.length,
    arrays: arrayRows.map(row => row.length),
    batches: batchRows.map((row, i) => ({ instances: batches[i]?.mesh.instanceMatrix.count ?? 0, capacity: row.capacity, itemSize: row.attribute?.itemSize ?? 0 })),
    bounds: rows.bounds, targetMs: rows.budget.targetMs, fuel: rows.budget.fuel }, {
    batch: (index, total, first, changed, matrices, values) => {
      const batch = batches[index]; if (batch === undefined || !live()) return;
      const { mesh, attribute, itemSize } = batch;
      for (let k = 0; k < changed; k++) mesh.instanceMatrix.array.set(matrices.subarray(k * 16, k * 16 + 16), (first + k) * 16);
      if (attribute !== null) for (let k = 0; k < changed; k++) for (let c = 0; c < itemSize; c++) attribute.setComponent(first + k, c, values[k * itemSize + c] ?? 0);
      if (changed > 0) { mesh.instanceMatrix.needsUpdate = true; if (attribute !== null) attribute.needsUpdate = true; }
      mesh.count = total;
    },
    write: (index, matrix) => { const staging = staged[index]; if (staging === undefined) throw new Error('Unknown view transform'); if (live()) { staging.fromArray(matrix); dirty.add(index); } },
    channels: values => {
      landed.set(values.subarray(0, landed.length));
      if (live()) { for(let i=0;i<writers.length;i++)writers[i]?.(landed[i]??0); draw(); }
    },
    upload: () => {
      if (live()) for (const index of dirty) { const matrix = staged[index]; if (matrix !== undefined) setters[index]?.(matrix); }
      dirty.clear();
    },
  }, [0, 0], ports.preparedMemory === undefined ? undefined : { memory: ports.preparedMemory, scope }, scope);
  const camera = ports.camera, player = ports.player;
  let tick = 0;
  return { get frozen() { return lane.isFrozen; }, frame: (dt, time): boolean => {
    if (!live()) return false;
    const p = player.position;
    for (const pool of pools.values()) pool.slots.refresh?.();
    // previous columns are last frame's current ones; a fresh value (a scalar, a new identity in a slot) has no previous
    columns.copyWithin(0, n, 2 * n);
    let k = 0;
    const put = (value: number, fresh: boolean): void => { if (fresh) columns[k] = value; columns[n + k] = value; k++; };
    for (const row of rows.samples) {
      if (row.kind === 'pool') {
        const pool = pools.get(row.pool), last = seen.get(row.pool);
        if (pool === undefined || last === undefined) throw new Error(`Unknown view pool ${row.pool}`);
        for (let slot = 0; slot < pool.row.count; slot++) {
          // a new identity in a slot starts without interpolation: its previous columns are its current ones
          const actor = pool.slots.actor(slot), identity = actor?.identity ?? null, fresh = identity !== last[slot]; last[slot] = identity;
          put(Number(actor !== null), fresh);
          // Read the complete borrowed batch before writing any of its columns.
          const x = actor?.x ?? 0, y = actor?.y ?? 0, z = actor?.z ?? 0, yaw = actor?.yaw ?? 0;
          const alive = Number(actor?.alive === true), ground = actor?.ground ?? 0;
          put(x, fresh); put(y, fresh); put(z, fresh);
          put(yaw, fresh); put(alive, fresh); put(ground, fresh);
          for (const field of pool.row.fields) put(actor === null ? 0 : actor.field(field), fresh);
        }
        continue;
      }
      if (row.kind === 'value') {
        const value = sources.get(row.source)?.(row.field) ?? Number.NaN;
        if (!Number.isFinite(value)) throw new Error(`View value ${row.source}.${row.field} is not finite`);
        put(value, true); continue;
      }
      if (row.kind === 'clock') { if (!Number.isFinite(time)) throw new Error('View clock is not finite'); put(time, true); continue; }
      const floor = row.kind === 'floor' ? floors.get(row.piece)?.(p.x, p.z) : undefined;
      put(row.kind === 'constant' ? row.value : row.kind === 'floor' ? (row.field === 'present' ? Number(floor !== undefined) : floor ?? 0)
        : row.field === 'speed' ? Math.hypot(player.velocity.x, player.velocity.z) : row.field === 'yaw' ? player.yaw : p[row.field], true);
    }
    tick++;
    const ran = lane.frame(dt, 0, tick, [{ previousTick: tick - 1, currentTick: tick, values: columns }], displayHz, diagnosticNow, arrays.map(read => read()));
    if (lane.isFrozen) return ran;
    for(let i=0;i<rows.channels.length;i++){
      const row=rows.channels[i];if(row===undefined)throw new Error('Missing view channel');
      if (row.kind !== 'camera') continue;
      const value = landed[i] ?? 0;
      if (row.field === 'roll') camera.rotation.z += value; else if (row.field === 'pitch') camera.rotation.x += value;
      else if (row.field === 'yaw') camera.rotation.y += value; else camera.position[row.field] += value;
    }
    return ran;
  } };
}
