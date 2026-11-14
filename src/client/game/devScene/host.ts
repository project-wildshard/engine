import * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { groups } from '@wildshard/engine/physics/groups';
import type { DevGeometry, DevMaterial, DevPart, DevTexture } from './wire';

/**
 * SHARD-SOURCE AP5: the dev scene host. A DEVSERVER page under `wildshard watch` draws the author's parts here, one scope
 * per part: replacing a part builds the new one first, then disposes the old one's scope (its meshes, materials, lights
 * and colliders) in the same call, so no frame shows neither and the frame loop never waits on it. Geometries and
 * rasters are immutable by key and shared across parts and revisions; a part only adds what it lacks.
 *
 * Colliders go into the page's physics world, the one the in-page server and the player's motor use, as WORLD solids.
 */
export interface DevSceneAssets {
  geometry: (key: string) => DevGeometry;
  texture: (key: string) => Uint8Array;
}

interface LivePart { readonly hash: string; readonly scope: Scope; readonly geometries: readonly string[]; readonly textures: readonly string[]; readonly draws: number }
interface Held<T extends { dispose: () => void }> { readonly value: T; users: number }

export class DevSceneHost {
  readonly root: THREE.Group = new THREE.Group();
  private readonly parts = new Map<string, LivePart>();
  private readonly geometries = new Map<string, Held<THREE.BufferGeometry>>();
  private readonly textures = new Map<string, Held<THREE.DataTexture>>();
  /** every applied part, in order (`name@hash`): what a test or the timing script reads */
  readonly applied: string[] = [];

  constructor(private readonly scope: Scope, parent: THREE.Object3D, private readonly physics: Physics | null) {
    this.root.name = 'devScene';
    parent.add(this.root);
    scope.onDispose(() => {
      for (const name of this.parts.keys()) this.remove(name);
      this.root.removeFromParent();
    });
  }

  /** the part's current hash, or undefined */
  hash(name: string): string | undefined { return this.parts.get(name)?.hash; }
  names(): string[] { return [...this.parts.keys()]; }
  /** draws (meshes, sprites, water) currently in the scene, by part */
  drawCounts(): Record<string, number> { return Object.fromEntries([...this.parts].map(([name, part]) => [name, part.draws])); }
  /** geometries and rasters the host holds now (a test reads that nothing leaks) */
  held(): { geometries: number; textures: number } { return { geometries: this.geometries.size, textures: this.textures.size }; }

  /** Which geometry and texture keys `part` needs that the host doesn't hold yet. */
  missing(part: DevPart): { geometries: string[]; textures: DevTexture[] } {
    return { geometries: part.geometries.filter(key => !this.geometries.has(key)), textures: part.textures.filter(texture => !this.textures.has(texture.key)) };
  }

  /** Build `part` and swap it in for the part of that name, if any. */
  apply(part: DevPart, assets: DevSceneAssets): void { this.applyAll([part], assets); }

  /**
   * Build every part, then swap them all in and only then release the parts they replace, so a geometry or raster that
   * moves from one part to another in one revision is never dropped in between. A part that fails to build leaves
   * nothing behind and the batch's earlier builds are taken back: the scene keeps the previous revision.
   */
  applyAll(parts: readonly DevPart[], assets: DevSceneAssets): void {
    const built: { part: DevPart; live: LivePart; group: THREE.Group }[] = [];
    try { for (const part of parts) built.push(this.build(part, assets)); }
    catch (cause) { for (const { live } of built) this.release(live); throw cause; }
    const previous: LivePart[] = [];
    for (const { part, live, group } of built) {
      const old = this.parts.get(part.name);
      if (old !== undefined) previous.push(old);
      this.root.add(group);
      this.parts.set(part.name, live);
      this.applied.push(`${part.name}@${part.hash}`);
    }
    for (const old of previous) this.release(old);
  }

  /** Take a part out of the scene and the world. */
  remove(name: string): void {
    const live = this.parts.get(name);
    if (live === undefined) return;
    this.parts.delete(name);
    this.release(live);
  }

  private acquire<T extends { dispose: () => void }>(map: Map<string, Held<T>>, key: string, make: () => T): T {
    const held = map.get(key);
    if (held !== undefined) { held.users++; return held.value; }
    const value = make();
    map.set(key, { value, users: 1 });
    return value;
  }

  private drop<T extends { dispose: () => void }>(map: Map<string, Held<T>>, keys: readonly string[]): void {
    for (const key of keys) {
      const held = map.get(key);
      if (held !== undefined && --held.users === 0) { held.value.dispose(); map.delete(key); }
    }
  }

  private release(live: LivePart): void {
    live.scope.dispose();
    this.drop(this.geometries, live.geometries);
    this.drop(this.textures, live.textures);
  }

  /** One part under its own scope; on a throw, everything it took is given back before the error leaves. */
  private build(part: DevPart, assets: DevSceneAssets): { part: DevPart; live: LivePart; group: THREE.Group } {
    const scope = this.scope.child(`devScene.${part.name}`), group = new THREE.Group(), owned: { dispose: () => void }[] = [];
    const geometryKeys: string[] = [], textureKeys: string[] = [];
    const live: LivePart = { hash: part.hash, scope, geometries: geometryKeys, textures: textureKeys, draws: part.draws.length + part.sprites.length + part.water.length };
    group.name = `devScene.${part.name}`;
    scope.onDispose(() => { group.removeFromParent(); for (const resource of owned) resource.dispose(); });
    try {
      const textures = new Map<string, THREE.DataTexture>(), geometries = new Map<string, THREE.BufferGeometry>();
      for (const row of part.textures) { textures.set(row.key, this.acquire(this.textures, row.key, () => makeTexture(row, assets.texture(row.key)))); textureKeys.push(row.key); }
      for (const key of part.geometries) { geometries.set(key, this.acquire(this.geometries, key, () => makeGeometry(assets.geometry(key)))); geometryKeys.push(key); }
      const need = <T>(map: Map<string, T>, key: string, what: string): T => { const value = map.get(key); if (value === undefined) throw new Error(`dev scene: part ${part.name} names ${what} ${key} it does not carry`); return value; };
      const materials = new Map<string, THREE.Material>();
      for (const row of part.materials) {
        const material = makeMaterial(row, row.map === null ? null : need(textures, row.map, 'texture'), owned);
        materials.set(row.key, material); owned.push(material);
      }
      for (const draw of part.draws) {
        const material = need(materials, draw.material, 'material'), geometry = need(geometries, draw.geometry, 'geometry');
        let mesh: THREE.Mesh;
        if (draw.instances === null) mesh = new THREE.Mesh(geometry, material);
        else {
          if (draw.instances.matrices.length !== draw.instances.count * 16) throw new Error(`dev scene: part ${part.name} has ${draw.instances.matrices.length} instance matrix floats for ${draw.instances.count} instances`);
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
      for (const light of part.lights) {
        const lamp = new THREE.PointLight(new THREE.Color().setRGB(...light.colour), light.intensity, light.distance, light.decay);
        lamp.position.set(...light.position);
        group.add(lamp);
      }
      for (const water of part.water) {
        const surface = new THREE.BufferGeometry();
        owned.push(surface);
        surface.setAttribute('position', new THREE.Float32BufferAttribute(water.triangles, 3));
        surface.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...water.tint), roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.86, depthWrite: false });
        owned.push(material);
        group.add(new THREE.Mesh(surface, material));
      }
      if (this.physics !== null) {
        const physics = this.physics;
        withOwner(scope, () => {
          for (const box of part.colliders) physics.world.createCollider(physics.R.ColliderDesc.cuboid(...box.half)
            .setTranslation(...box.centre).setRotation({ x: box.rotation[0], y: box.rotation[1], z: box.rotation[2], w: box.rotation[3] })
            .setCollisionGroups(groups('WORLD')));
        });
      }
      group.updateMatrixWorld(true);
    } catch (cause) { this.release(live); throw cause; }
    return { part, live, group };
  }
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

function makeTexture(row: DevTexture, rgba: Uint8Array): THREE.DataTexture {
  if (rgba.byteLength !== row.width * row.height * 4) throw new Error(`dev scene: texture ${row.key} is ${rgba.byteLength} bytes, not ${row.width}x${row.height} RGBA8`);
  const texture = new THREE.DataTexture(rgba, row.width, row.height);
  texture.colorSpace = row.colourSpace === 'linear' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
