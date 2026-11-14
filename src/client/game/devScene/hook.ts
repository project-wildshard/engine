import * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { LookKey } from '@wildshard/engine/render/dataLook';
import type { LookStrategy } from '@wildshard/engine/render/look';
import { lampLights } from '@wildshard/engine/render/lookLight';
import type { LookLamp } from '@wildshard/format/look-light';
import type { ShardWater } from '@wildshard/format/water';
import { installClientWater } from '../shardfile/clientWater';
import { shardfileLiveLook } from './liveLook';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { devGroundHeight, isDevColliders, liftedFeet, swapDevBoxes, type DevBox, type DevGround } from '@wildshard/engine/game/devColliders';
import { swapTerrainCollider } from '@wildshard/engine/physics/terrainTiles';
import type { HeightfieldBinding } from '@wildshard/engine/world/Heightfield';
import { decodeTerrainTile, type TerrainTileData } from '@wildshard/format/terrainTileBytes';
import { refreshTerrainTile } from '@wildshard/engine/world/terrainTileView';
import type { DevGameplay, DevPlace, DevRestarted } from '@wildshard/engine/game/devGameplay';
import { diagnosticNow } from '@wildshard/engine/core/clock';

/**
 * SHARD-SOURCE AP5 (J347: engine is the deployed client and server; dev tooling is sharddev's). The dev hook: the one thing
 * a DEVSERVER page carries for `wildshard watch`. sharddev owns the rest, its WebSocket server and protocol, the part diff
 * and a page script `watch` injects into the page it serves; that script owns one scope per part and the swap order, and
 * calls these functions on `window.__wildshardDevHook`:
 *
 *   addPart(name, part)        draw a new part: meshes, sprites, lamps (the look's lamp lights) and water (the client's water)
 *   replacePart(name, part)    build the new part first, then dispose the old part's scope, in one call: no frame shows neither
 *   removePart(name)           dispose the part's scope (its boxes stay: the page script calls swapColliders(name, []))
 *   setLook(look)              v2 (AP17): the look section in place, as the shardfile would carry it: day keys (sky, fog, sun,
 *                              ambient), the sun's arc, exposure, tone, vignette and bloom (`shardfileLiveLook`); v1 sent
 *                              the keys only. True, or false when the page's look can't take it live and the page must reload
 *   swapColliders(name, boxes) the part's solid boxes, in the page's world and the in-page server's (the worker, by its
 *                              harness port), new set first, then the old one goes; a player inside a new box is lifted
 *                              onto it (v3)
 *   setGround(bytes)           v3 (AP18): the whole ground as one terrain tile's wire bytes (`encodeTerrainTile`: the 257²
 *                              heights and colours the shard's tiles and collider are cut from). The page's heightfield
 *                              collider, its terrain field (`heightAt`) and every drawn ground tile whose samples changed are
 *                              swapped; the in-page server takes the same heights; a player under the new ground is lifted
 *                              onto it. True, or false when the page's ground can't take it (the page must reload)
 *   restartGameplay(gameplay)  v4 (AP19): the shard's quests, encounters, spawns or scripts changed (`DEV_GAMEPLAY_SECTIONS`,
 *                              the new rows of each). The in-page server saves, puts its world down and boots it again on
 *                              the new rows from that save, with the player where the page has it; the page's client rejoins
 *                              it, the held boxes and ground go to it again, and the quest views are built again from the new
 *                              quest section. Resolves to what ran, or `ok: false` when the page must reload
 *
 * `version` is `DEV_HOOK_VERSION`; sharddev refuses a page with another (its page script) and a client whose build flags
 * say another (`build-flags.json` `devHook`, written by `scripts/app-build-pipeline.mjs`). Bump it on any change to these
 * signatures or to `DevPart`. A production build has none of this: `finish.ts` imports it only behind `__DEVSERVER__`, and
 * `scripts/check-devserver.mjs` refuses a bundle that holds `DEV_HOOK_GLOBAL`.
 */
export const DEV_HOOK_VERSION = 4;

// the in-page server's half of `setGround`, which the standalone shell puts on the window (client/host/standalone/shell.ts)
declare global { interface Window {
  __workerClientDevGround?: (ground: DevGround) => void;
  /** AP19: the in-page server's soft restart (client/host/standalone/shell.ts) and the quest views' (shardfile/client.ts) */
  __workerClientDevRestart?: (gameplay: DevGameplay, at: DevPlace | null) => Promise<DevRestarted>;
  __shardfileDevQuests?: (quests: NonNullable<DevGameplay['quests']>) => Promise<boolean>;
} }
export const DEV_HOOK_GLOBAL = '__wildshardDevHook';

export type Rgb = readonly [number, number, number];

export interface DevMaterial {
  readonly key: string;
  readonly name: string;
  readonly kind: 'standard' | 'basic' | 'sprite';
  readonly colour: Rgb;
  readonly roughness: number;
  readonly metalness: number;
  readonly emissive: Rgb;
  readonly emissiveIntensity: number;
  /** a `DevTexture` key */
  readonly map: string | null;
  readonly repeat: readonly [number, number];
  readonly offset: readonly [number, number];
  readonly alphaTest: number;
  readonly side: 'front' | 'back' | 'double';
  readonly vertexColours: boolean;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly blending: 'normal' | 'additive';
  readonly depthWrite: boolean;
  readonly fog: boolean;
}

/** One RGBA8 raster, row 0 at v = 0. Immutable by key: a key the hook holds is not uploaded again. */
export interface DevTexture { readonly key: string; readonly width: number; readonly height: number; readonly colourSpace: 'srgb' | 'linear'; readonly rgba: Uint8Array }

/** One geometry in its own frame. Immutable by key, like a texture. */
export interface DevGeometry {
  readonly key: string;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array | null;
  readonly colour: Float32Array | null;
  readonly index: Uint32Array | null;
}

export interface DevDraw {
  readonly geometry: string;
  readonly material: string;
  /** column-major world matrix */
  readonly matrix: readonly number[];
  readonly instances: { readonly count: number; readonly matrices: ArrayLike<number>; readonly colours: ArrayLike<number> | null } | null;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

export interface DevSprite { readonly material: string; readonly position: readonly [number, number, number]; readonly scale: readonly [number, number]; readonly center: readonly [number, number] }

/** One part, decoded: every colour linear, every matrix column-major in world metres. Colliders come by `swapColliders`. */
export interface DevPart {
  readonly materials: readonly DevMaterial[];
  readonly textures: readonly DevTexture[];
  readonly geometries: readonly DevGeometry[];
  readonly draws: readonly DevDraw[];
  readonly sprites: readonly DevSprite[];
  /** the shardfile's lamp rows (`look.light.lamps`), drawn as the look's lamps are */
  readonly lamps: readonly LookLamp[];
  /** the shardfile's water rows, drawn as the client draws a shard's water */
  readonly water: ShardWater;
}

/** The look a watched page takes live: its day keys, and (v2, AP17) the whole look section the page's shardfile would carry. */
export interface DevLook { readonly keys: readonly LookKey[]; readonly look?: Shardfile['look'] }

export interface DevHook {
  readonly version: number;
  addPart: (name: string, part: DevPart) => void;
  replacePart: (name: string, part: DevPart) => void;
  removePart: (name: string) => void;
  setLook: (look: DevLook) => boolean;
  swapColliders: (name: string, boxes: readonly DevBox[]) => void;
  setGround: (ground: Uint8Array) => boolean;
  restartGameplay: (gameplay: DevGameplay) => Promise<DevRestart>;
}

/** What a soft restart did: the server's world restart and the page's quest views, and how long each took (ms). */
export interface DevRestart { readonly ok: boolean; readonly serverMs: number; readonly questsMs: number | null; readonly reason?: string }

/** The page's player, as a dev swap lifts it out of new solids. */
export interface DevPlayer { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly yaw: number; pitch: number; spawn: (x: number, z: number, yaw: number, y?: number) => void }

export interface DevHookPorts {
  readonly scope: Scope;
  readonly scene: THREE.Object3D;
  /** the page's physics world now (the player's prediction): a grid crossing swaps it, so the hook reads it per call;
   *  null on a page without one */
  readonly physics: () => Physics | null;
  /** the page's look now */
  readonly look: () => LookStrategy | null;
  /** the in-page server's half of `swapColliders` (the worker page's harness port); null when the page has none */
  readonly server: () => ((name: string, boxes: readonly DevBox[]) => void) | null;
  /** the in-page server's half of `setGround` (v3); null when the page has none */
  readonly serverGround?: () => ((ground: DevGround) => void) | null;
  /** the page's player now, for the lift out of new solids (v3); null on a page without one */
  readonly player?: () => DevPlayer | null;
  /** the page's terrain field now (`captureHeightfield`), which a new ground installs into (v3); absent in a test */
  readonly terrainField?: () => HeightfieldBinding;
  /** the in-page server's soft restart (v4); null when the page has none */
  readonly restart?: () => ((gameplay: DevGameplay, at: DevPlace | null) => Promise<DevRestarted>) | null;
  /** the page's quest views, built again from a new quest section (v4); null when the page can't */
  readonly quests?: () => ((quests: NonNullable<DevGameplay['quests']>) => Promise<boolean>) | null;
  readonly watchFrames: (fn: (dt: number) => void) => () => void;
}

interface Held<T extends { dispose: () => void }> { readonly value: T; users: number }
interface LivePart { readonly scope: Scope; readonly geometries: readonly string[]; readonly textures: readonly string[] }

/** Build the hook over the page's scene and world; `installDevHook` puts it on the window. */
export function createDevHook(ports: DevHookPorts): DevHook & { readonly root: THREE.Group; held: () => { geometries: number; textures: number } } {
  const { scope } = ports, root = new THREE.Group(), parts = new Map<string, LivePart>(), colliders = new Map<string, Scope>();
  const boxesOf = new Map<string, readonly DevBox[]>();
  let collidersIn: Physics | null = null;
  const geometries = new Map<string, Held<THREE.BufferGeometry>>(), textures = new Map<string, Held<THREE.DataTexture>>();
  root.name = 'devScene';
  ports.scene.add(root);
  scope.onDispose(() => {
    for (const name of Array.from(parts.keys())) removePart(name);
    root.removeFromParent();
  });

  const acquire = <T extends { dispose: () => void }>(map: Map<string, Held<T>>, key: string, make: () => T): T => {
    const held = map.get(key);
    if (held !== undefined) { held.users++; return held.value; }
    const value = make();
    map.set(key, { value, users: 1 });
    return value;
  };
  const drop = <T extends { dispose: () => void }>(map: Map<string, Held<T>>, keys: readonly string[]): void => {
    for (const key of keys) {
      const held = map.get(key);
      if (held !== undefined && --held.users === 0) { held.value.dispose(); map.delete(key); }
    }
  };
  const release = (live: LivePart): void => { live.scope.dispose(); drop(geometries, live.geometries); drop(textures, live.textures); };

  /** One part under its own scope, not yet in the scene; on a throw, everything it took is given back first. */
  const build = (name: string, part: DevPart): { live: LivePart; group: THREE.Group } => {
    const partScope = scope.child(`devScene.${name}`), group = new THREE.Group(), owned: { dispose: () => void }[] = [];
    const geometryKeys: string[] = [], textureKeys: string[] = [], live: LivePart = { scope: partScope, geometries: geometryKeys, textures: textureKeys };
    group.name = `devScene.${name}`;
    partScope.onDispose(() => { group.removeFromParent(); for (const resource of owned) resource.dispose(); });
    try {
      const maps = new Map<string, THREE.DataTexture>(), shapes = new Map<string, THREE.BufferGeometry>();
      for (const row of part.textures) { maps.set(row.key, acquire(textures, row.key, () => makeTexture(row))); textureKeys.push(row.key); }
      for (const row of part.geometries) { shapes.set(row.key, acquire(geometries, row.key, () => makeGeometry(row))); geometryKeys.push(row.key); }
      const need = <T>(map: Map<string, T>, key: string, what: string): T => { const value = map.get(key); if (value === undefined) throw new Error(`dev hook: part ${name} names ${what} ${key} it does not carry`); return value; };
      const materials = new Map<string, THREE.Material>();
      for (const row of part.materials) {
        const material = makeMaterial(row, row.map === null ? null : need(maps, row.map, 'texture'), owned);
        materials.set(row.key, material); owned.push(material);
      }
      for (const draw of part.draws) {
        const material = need(materials, draw.material, 'material'), geometry = need(shapes, draw.geometry, 'geometry');
        let mesh: THREE.Mesh;
        if (draw.instances === null) mesh = new THREE.Mesh(geometry, material);
        else {
          if (draw.instances.matrices.length !== draw.instances.count * 16) throw new Error(`dev hook: part ${name} has ${draw.instances.matrices.length} instance matrix floats for ${draw.instances.count} instances`);
          const instanced = new THREE.InstancedMesh(geometry, material, draw.instances.count);
          owned.push(instanced);
          instanced.instanceMatrix.array.set(draw.instances.matrices);
          if (draw.instances.colours !== null) instanced.instanceColor = new THREE.InstancedBufferAttribute(Float32Array.from(draw.instances.colours), 3);
          instanced.computeBoundingSphere();
          mesh = instanced;
        }
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(draw.matrix);
        mesh.castShadow = draw.castShadow; mesh.receiveShadow = draw.receiveShadow;
        group.add(mesh);
      }
      for (const sprite of part.sprites) {
        const card = new THREE.Sprite(need(materials, sprite.material, 'material') as THREE.SpriteMaterial);
        card.position.set(...sprite.position); card.scale.set(sprite.scale[0], sprite.scale[1], 1); card.center.set(...sprite.center);
        group.add(card);
      }
      if (part.lamps.length > 0) {
        // the look's own lamp lights (B2, M4.3): what a baked shard's `look.light.lamps` draws
        const lamps = lampLights(part.lamps);
        group.add(lamps);
        owned.push({ dispose: () => { for (const light of lamps.children) if (light instanceof THREE.Light) light.dispose(); } });
        const { update } = lamps;
        if (update !== null) { let time = 0; partScope.onDispose(ports.watchFrames(dt => { time += dt; update(time); })); }
      }
      // the client's own water surfaces, under this part's scope
      installClientWater(part.water, { root: group, scope: partScope, frame: run => { partScope.onDispose(ports.watchFrames(run)); } });
      group.updateMatrixWorld(true);
    } catch (cause) { release(live); throw cause; }
    return { live, group };
  };

  const replacePart = (name: string, part: DevPart): void => {
    const { live, group } = build(name, part), old = parts.get(name);
    root.add(group);
    parts.set(name, live);
    if (old !== undefined) release(old);
  };
  const addPart = (name: string, part: DevPart): void => {
    if (parts.has(name)) throw new Error(`dev hook: part ${name} is already drawn (replacePart swaps it)`);
    replacePart(name, part);
  };
  function removePart(name: string): void {
    const live = parts.get(name);
    if (live === undefined) return;
    parts.delete(name);
    release(live);
  }
  const setLook = (look: DevLook): boolean => {
    const current = ports.look();
    if (current === null || !('liveKeys' in current)) return false;
    if (look.look !== undefined) return current.liveLook !== undefined && current.liveLook(shardfileLiveLook(look.look));
    return current.liveKeys !== undefined && current.liveKeys(look.keys);
  };
  /** A player now inside new solids stands on them (the server lifts its own: `swapDevGround`). */
  const lift = (heightAt: ((x: number, z: number) => number) | null, boxes: readonly DevBox[]): void => {
    const player = ports.player?.() ?? null;
    if (player === null) return;
    const { x, y, z } = player.position, feet = liftedFeet(x, y, z, heightAt, boxes);
    if (feet === null) return;
    const pitch = player.pitch;
    player.spawn(x, z, player.yaw, feet); player.pitch = pitch;
  };

  // The boxes go into the page's world as it is now. After a grid crossing that is a new world: every held part's boxes
  // are made again in it, and the old world's sets are disposed (Physics skips removal from a freed world).
  const swapColliders = (name: string, boxes: readonly DevBox[]): void => {
    const message = { wildshardDevColliders: name, boxes };
    if (!isDevColliders(message)) throw new Error(`dev hook: part ${name} has a malformed collider box`);
    if (boxes.length === 0) boxesOf.delete(name); else boxesOf.set(name, boxes);
    const physics = ports.physics();
    if (physics !== collidersIn) {
      for (const held of colliders.values()) held.dispose();
      colliders.clear();
      collidersIn = physics;
      if (physics !== null) for (const [part, held] of boxesOf) if (part !== name) swapDevBoxes(physics, scope, colliders, part, held);
    }
    if (physics !== null) swapDevBoxes(physics, scope, colliders, name, boxes);
    ports.server()?.(name, boxes);
    lift(null, boxes);
  };
  // AP18: each drawn ground tile keeps a signature of the lattice samples it was last cut from; a swap cuts again only the
  // tiles whose samples changed, and a tile the page streams in later (cut from the boot's bytes) is cut on the next frame.
  let ground: TerrainTileData | null = null, groundScope: Scope | null = null, sweep = 0;
  const cut = new WeakMap<THREE.Mesh, number>();
  const tiles = (): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    ports.scene.traverse(object => { if (object instanceof THREE.Mesh && object.name.startsWith('terrain:')) out.push(object as THREE.Mesh); });
    return out;
  };
  /** Cut every tile whose samples differ from the ones it holds; false when one can't be cut from this lattice. */
  const recut = (lattice: TerrainTileData): boolean => {
    let ok = true;
    for (const mesh of tiles()) {
      const signature = tileSignature(mesh, lattice);
      if (signature === null) { ok = false; continue; }
      if (cut.get(mesh) === signature) continue;
      if (refreshTerrainTile(mesh, lattice)) cut.set(mesh, signature); else ok = false;
    }
    return ok;
  };
  const setGround = (bytes: Uint8Array): boolean => {
    let lattice: TerrainTileData;
    try { lattice = decodeTerrainTile(bytes); } catch { return false; }
    if (lattice.colours === undefined) return false;
    const heights: DevGround = { resolution: lattice.resolution, x: lattice.x, z: lattice.z, size: lattice.size, heights: lattice.heights };
    if (!recut(lattice)) return false;
    const physics = ports.physics(), next = scope.child('devGround');
    if (physics !== null) swapTerrainCollider(physics, heights, next);
    groundScope?.dispose(); groundScope = next;
    const heightAt = devGroundHeight(heights), field = ports.terrainField?.();
    const normalAt = (x: number, z: number, eps = 0.25): [number, number, number] => {
      const dx = heightAt(x - eps, z) - heightAt(x + eps, z), dz = heightAt(x, z - eps) - heightAt(x, z + eps), length = Math.hypot(dx, 2 * eps, dz);
      return [dx / length, 2 * eps / length, dz / length];
    };
    field?.install({ heightAt, normalAt, splatAt: field.field.splatAt });
    ports.serverGround?.()?.(heights);
    ground = lattice;
    lift(heightAt, []);
    return true;
  };
  // AP19: the server's world restarts on the new rows and the quest views are built again, side by side; then the new world
  // takes the boxes and ground watch had swapped into the old one.
  const restartGameplay = async (gameplay: DevGameplay): Promise<DevRestart> => {
    const server = ports.restart?.() ?? null, views = gameplay.quests === undefined ? null : ports.quests?.() ?? null;
    if (server === null) return { ok: false, serverMs: 0, questsMs: null, reason: 'the page has no in-page server' };
    if (gameplay.quests !== undefined && views === null) return { ok: false, serverMs: 0, questsMs: null, reason: 'the page can\'t rebuild its quest views' };
    const player = ports.player?.() ?? null, at = player === null ? null : { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw };
    const started = diagnosticNow();
    const quests = views === null || gameplay.quests === undefined ? Promise.resolve(null) : views(gameplay.quests).then(ok => ok ? diagnosticNow() - started : -1);
    const [restarted, questsMs] = await Promise.all([server(gameplay, at), quests]);
    if (restarted.ok) {
      for (const [name, boxes] of boxesOf) ports.server()?.(name, boxes);
      if (ground !== null) ports.serverGround?.()?.({ resolution: ground.resolution, x: ground.x, z: ground.z, size: ground.size, heights: ground.heights });
    }
    const ok = restarted.ok && questsMs !== -1;
    return { ok, serverMs: restarted.ms, questsMs: questsMs === null || questsMs < 0 ? null : Math.round(questsMs),
      ...(restarted.reason !== undefined ? { reason: restarted.reason } : questsMs === -1 ? { reason: 'the quest views refused the new quests' } : {}) };
  };
  scope.onDispose(ports.watchFrames(() => { if (ground !== null && ++sweep % 15 === 0) recut(ground); }));
  scope.onDispose(() => { for (const held of colliders.values()) held.dispose(); colliders.clear(); });
  return { version: DEV_HOOK_VERSION, root, addPart, replacePart, removePart, setLook, swapColliders, setGround, restartGameplay,
    held: () => ({ geometries: geometries.size, textures: textures.size }) };
}

/** Put the hook on the window for sharddev's page script, for the page's level. */
export function installDevHook(ports: DevHookPorts): DevHook {
  const hook = createDevHook(ports), { version, addPart, replacePart, removePart, setLook, swapColliders, setGround, restartGameplay } = hook;
  ports.scope.expose(window, DEV_HOOK_GLOBAL, Object.freeze({ version, addPart, replacePart, removePart, setLook, swapColliders, setGround, restartGameplay } satisfies DevHook));
  return hook;
}

/** A tile's lattice window (heights and colours), as one number: the samples a tile at its place and size is cut from. Null
 *  when the tile's corners are off the lattice. */
function tileSignature(mesh: THREE.Mesh, lattice: TerrainTileData): number | null {
  const box = mesh.geometry.boundingBox, colours = lattice.colours;
  if (box === null || colours === undefined) return null;
  const n = lattice.resolution, step = lattice.size / (n - 1), size = box.max.x - box.min.x;
  const x0 = Math.round((mesh.position.x - lattice.x) / step), z0 = Math.round((mesh.position.z - lattice.z) / step), span = Math.round(size / step);
  // one sample more on each side: a tile's normals read its neighbours' heights
  if (x0 < 0 || z0 < 0 || x0 + span >= n || z0 + span >= n) return null;
  let hash = 2166136261;
  const bits = new Uint32Array(1), float = new Float32Array(bits.buffer);
  const mix = (value: number): void => { float[0] = value; hash = Math.imul(hash ^ (bits[0] ?? 0), 16777619); };
  for (let z = Math.max(0, z0 - 1); z <= Math.min(n - 1, z0 + span + 1); z++) for (let x = Math.max(0, x0 - 1); x <= Math.min(n - 1, x0 + span + 1); x++) {
    const at = z * n + x;
    mix(lattice.heights[at] ?? 0); mix(colours[at * 3] ?? 0); mix(colours[at * 3 + 1] ?? 0); mix(colours[at * 3 + 2] ?? 0);
  }
  return hash >>> 0;
}

function makeMaterial(row: DevMaterial, shared: THREE.DataTexture | null, owned: { dispose: () => void }[]): THREE.Material {
  let map: THREE.Texture | null = null;
  if (shared !== null) {
    // a clone shares the raster (one upload) and keeps its own repeat and offset, as an author's `clone()` does
    map = shared.clone(); owned.push(map); map.repeat.set(...row.repeat); map.offset.set(...row.offset); map.version++;
  }
  const colour = new THREE.Color().setRGB(...row.colour);
  const common = { name: row.name, color: colour, map, alphaTest: row.alphaTest, transparent: row.transparent, opacity: row.opacity, depthWrite: row.depthWrite, fog: row.fog,
    blending: row.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending };
  if (row.kind === 'sprite') return new THREE.SpriteMaterial(common);
  const side = row.side === 'double' ? THREE.DoubleSide : row.side === 'back' ? THREE.BackSide : THREE.FrontSide;
  if (row.kind === 'basic') return new THREE.MeshBasicMaterial({ ...common, side, vertexColors: row.vertexColours });
  return new THREE.MeshStandardMaterial({ ...common, side, vertexColors: row.vertexColours, roughness: row.roughness, metalness: row.metalness,
    emissive: new THREE.Color().setRGB(...row.emissive), emissiveIntensity: row.emissiveIntensity });
}

function makeGeometry(source: DevGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(source.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(source.normal, 3));
  if (source.uv !== null) geometry.setAttribute('uv', new THREE.BufferAttribute(source.uv, 2));
  if (source.colour !== null) geometry.setAttribute('color', new THREE.BufferAttribute(source.colour, 3));
  if (source.index !== null) geometry.setIndex(new THREE.BufferAttribute(source.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function makeTexture(row: DevTexture): THREE.DataTexture {
  if (row.rgba.byteLength !== row.width * row.height * 4) throw new Error(`dev hook: texture ${row.key} is ${row.rgba.byteLength} bytes, not ${row.width}x${row.height} RGBA8`);
  const texture = new THREE.DataTexture(row.rgba, row.width, row.height);
  texture.colorSpace = row.colourSpace === 'linear' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
