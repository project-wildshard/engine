import * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { LookKey } from '@wildshard/engine/render/dataLook';
import type { LookStrategy } from '@wildshard/engine/render/look';
import { lampLights } from '@wildshard/engine/render/lookLight';
import type { LookLamp } from '@wildshard/format/look-light';
import type { ShardWater } from '@wildshard/format/water';
import { installClientWater } from '../shardfile/clientWater';
import { swapDevBoxes, type DevBox } from '@wildshard/engine/game/devColliders';

/**
 * SHARD-SOURCE AP5 (J347: engine is the deployed client and server; dev tooling is sharddev's). The dev hook: the one thing
 * a DEVSERVER page carries for `wildshard watch`. sharddev owns the rest, its WebSocket server and protocol, the part diff
 * and a page script `watch` injects into the page it serves; that script owns one scope per part and the swap order, and
 * calls these five functions on `window.__wildshardDevHook`:
 *
 *   addPart(name, part)        draw a new part: meshes, sprites, lamps (the look's lamp lights) and water (the client's water)
 *   replacePart(name, part)    build the new part first, then dispose the old part's scope, in one call: no frame shows neither
 *   removePart(name)           dispose the part's scope
 *   setLook(look)              the data look's day keys (sky, fog, sun, ambient) in place: true, or false when the page's look
 *                              can't take them live and the page must reload
 *   swapColliders(name, boxes) the part's solid boxes, in the page's world and the in-page server's (the worker, by its
 *                              harness port), new set first, then the old one goes
 *
 * `version` is `DEV_HOOK_VERSION`; sharddev refuses a page with another (its page script) and a client whose build flags
 * say another (`build-flags.json` `devHook`, written by `scripts/app-build-pipeline.mjs`). Bump it on any change to these
 * signatures or to `DevPart`. A production build has none of this: `finish.ts` imports it only behind `__DEVSERVER__`, and
 * `scripts/check-devserver.mjs` refuses a bundle that holds `DEV_HOOK_GLOBAL`.
 */
export const DEV_HOOK_VERSION = 1;
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

/** The part of a shardfile look a watched page takes live. */
export interface DevLook { readonly keys: readonly LookKey[] }

export interface DevHook {
  readonly version: number;
  addPart: (name: string, part: DevPart) => void;
  replacePart: (name: string, part: DevPart) => void;
  removePart: (name: string) => void;
  setLook: (look: DevLook) => boolean;
  swapColliders: (name: string, boxes: readonly DevBox[]) => void;
}

export interface DevHookPorts {
  readonly scope: Scope;
  readonly scene: THREE.Object3D;
  /** the page's physics world (the player's prediction); null on a page without one */
  readonly physics: Physics | null;
  /** the page's look now */
  readonly look: () => LookStrategy | null;
  /** the in-page server's half of `swapColliders` (the worker page's harness port); null when the page has none */
  readonly server: () => ((name: string, boxes: readonly DevBox[]) => void) | null;
  readonly watchFrames: (fn: (dt: number) => void) => () => void;
}

interface Held<T extends { dispose: () => void }> { readonly value: T; users: number }
interface LivePart { readonly scope: Scope; readonly geometries: readonly string[]; readonly textures: readonly string[] }

/** Build the hook over the page's scene and world; `installDevHook` puts it on the window. */
export function createDevHook(ports: DevHookPorts): DevHook & { readonly root: THREE.Group; held: () => { geometries: number; textures: number } } {
  const { scope } = ports, root = new THREE.Group(), parts = new Map<string, LivePart>(), colliders = new Map<string, Scope>();
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
    return current !== null && 'liveKeys' in current && current.liveKeys !== undefined && current.liveKeys(look.keys);
  };
  const swapColliders = (name: string, boxes: readonly DevBox[]): void => {
    if (ports.physics !== null) swapDevBoxes(ports.physics, scope, colliders, name, boxes);
    ports.server()?.(name, boxes);
  };
  scope.onDispose(() => { for (const held of colliders.values()) held.dispose(); colliders.clear(); });
  return { version: DEV_HOOK_VERSION, root, addPart, replacePart, removePart, setLook, swapColliders,
    held: () => ({ geometries: geometries.size, textures: textures.size }) };
}

/** Put the hook on the window for sharddev's page script, for the page's level. */
export function installDevHook(ports: DevHookPorts): DevHook {
  const hook = createDevHook(ports), { version, addPart, replacePart, removePart, setLook, swapColliders } = hook;
  ports.scope.expose(window, DEV_HOOK_GLOBAL, Object.freeze({ version, addPart, replacePart, removePart, setLook, swapColliders } satisfies DevHook));
  return hook;
}

function makeMaterial(row: DevMaterial, shared: THREE.DataTexture | null, owned: { dispose: () => void }[]): THREE.Material {
  let map: THREE.Texture | null = null;
  if (shared !== null) {
    // a clone shares the raster (one upload) and keeps its own repeat and offset, as an author's `clone()` does
    map = shared.clone(); owned.push(map); map.repeat.set(...row.repeat); map.offset.set(...row.offset); map.needsUpdate = true;
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
