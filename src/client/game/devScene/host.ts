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

interface LivePart { readonly hash: string; readonly scope: Scope; readonly geometries: readonly string[]; readonly draws: number }

export class DevSceneHost {
  readonly root: THREE.Group = new THREE.Group();
  private readonly parts = new Map<string, LivePart>();
  private readonly geometries = new Map<string, { geometry: THREE.BufferGeometry; users: number }>();
  private readonly textures = new Map<string, THREE.DataTexture>();
  /** every applied part, in order (`name@hash`): what a test or the timing script reads */
  readonly applied: string[] = [];

  constructor(private readonly scope: Scope, parent: THREE.Object3D, private readonly physics: Physics | null) {
    this.root.name = 'devScene';
    parent.add(this.root);
    scope.onDispose(() => {
      for (const name of this.parts.keys()) this.remove(name);
      for (const texture of this.textures.values()) texture.dispose();
      this.textures.clear();
      this.root.removeFromParent();
    });
  }

  /** the part's current hash, or undefined */
  hash(name: string): string | undefined { return this.parts.get(name)?.hash; }
  names(): string[] { return [...this.parts.keys()]; }
  /** draws (meshes, sprites, water) currently in the scene, by part */
  drawCounts(): Record<string, number> { return Object.fromEntries([...this.parts].map(([name, part]) => [name, part.draws])); }

  /** Which geometry and texture keys `part` needs that the host doesn't hold yet. */
  missing(part: DevPart): { geometries: string[]; textures: DevTexture[] } {
    return { geometries: part.geometries.filter(key => !this.geometries.has(key)), textures: part.textures.filter(texture => !this.textures.has(texture.key)) };
  }

  /** Build `part` and swap it in for the part of that name, if any. */
  apply(part: DevPart, assets: DevSceneAssets): void {
    for (const texture of part.textures) if (!this.textures.has(texture.key)) this.textures.set(texture.key, makeTexture(texture, assets.texture(texture.key)));
    for (const key of part.geometries) {
      const held = this.geometries.get(key);
      if (held !== undefined) held.users++;
      else this.geometries.set(key, { geometry: makeGeometry(assets.geometry(key)), users: 1 });
    }
    const scope = this.scope.child(`devScene.${part.name}`), group = new THREE.Group();
    group.name = `devScene.${part.name}`;
    const materials = new Map<string, THREE.Material>(), owned: { dispose: () => void }[] = [];
    for (const row of part.materials) { const material = this.makeMaterial(row, owned); materials.set(row.key, material); owned.push(material); }
    const need = <T>(map: Map<string, T>, key: string, what: string): T => { const value = map.get(key); if (value === undefined) throw new Error(`dev scene: part ${part.name} names ${what} ${key} it does not carry`); return value; };
    const geometry = (key: string): THREE.BufferGeometry => need(this.geometries, key, 'geometry').geometry;
    for (const draw of part.draws) {
      const material = need(materials, draw.material, 'material');
      let mesh: THREE.Mesh;
      if (draw.instances === null) mesh = new THREE.Mesh(geometry(draw.geometry), material);
      else {
        const instanced = new THREE.InstancedMesh(geometry(draw.geometry), material, draw.instances.count);
        instanced.instanceMatrix.array.set(draw.instances.matrices);
        if (draw.instances.colours !== null) instanced.instanceColor = new THREE.InstancedBufferAttribute(Float32Array.from(draw.instances.colours), 3);
        instanced.computeBoundingSphere();
        owned.push(instanced);
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
      surface.setAttribute('position', new THREE.Float32BufferAttribute(water.triangles, 3));
      surface.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...water.tint), roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.86, depthWrite: false });
      owned.push(surface, material);
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
    scope.onDispose(() => { group.removeFromParent(); for (const resource of owned) resource.dispose(); });
    const previous = this.parts.get(part.name);
    this.root.add(group);
    this.parts.set(part.name, { hash: part.hash, scope, geometries: part.geometries, draws: part.draws.length + part.sprites.length + part.water.length });
    if (previous !== undefined) this.release(previous);
    this.applied.push(`${part.name}@${part.hash}`);
  }

  /** Take a part out of the scene and the world. */
  remove(name: string): void {
    const live = this.parts.get(name);
    if (live === undefined) return;
    this.parts.delete(name);
    this.release(live);
  }

  private release(live: LivePart): void {
    live.scope.dispose();
    for (const key of live.geometries) {
      const held = this.geometries.get(key);
      if (held === undefined) continue;
      if (--held.users === 0) { held.geometry.dispose(); this.geometries.delete(key); }
    }
  }

  private makeMaterial(row: DevMaterial, owned: { dispose: () => void }[]): THREE.Material {
    let map: THREE.Texture | null = null;
    if (row.map !== null) {
      const shared = this.textures.get(row.map);
      if (shared === undefined) throw new Error(`dev scene: material ${row.name} maps texture ${row.map} it does not carry`);
      // a clone shares the raster (one upload) and keeps its own repeat and offset, as an author's `clone()` does
      map = shared.clone(); map.repeat.set(...row.repeat); map.offset.set(...row.offset); map.needsUpdate = true;
      owned.push(map);
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
