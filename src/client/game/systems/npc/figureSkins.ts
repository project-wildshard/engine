/** Client-only baked humanoid skin intake for the figure row host. */
import * as THREE from 'three';
import { ResourceMemo } from '@wildshard/engine/app/cachedAssets';
import * as v from 'valibot';
import { bindRig, loadRigFile, rigRoot } from '@wildshard/engine/anim/rig';
import type { Scope } from '@wildshard/engine/app/scope';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { FigureAtlasSchema, type FigureSkinRow } from '@wildshard/format/figures';
import { legBones, legPose, LEG_BONE_NAMES, type LegBuilt } from './npcRig';

const MAX_SURFACES = 8;
const isSkin = (node: THREE.Object3D): node is THREE.SkinnedMesh => node instanceof THREE.SkinnedMesh;
interface Source { rig: LegBuilt; map: THREE.Texture | null; normalMap: THREE.Texture | null }
export interface FigureRig {
  mesh: THREE.SkinnedMesh; height: number; lanternAt: THREE.Vector3 | null; handR: THREE.Bone; handAt: THREE.Vector3;
  walkSpeed: number; walkCycle: number;
  pose: (t: number, talk: number, point: number, pointYaw: number, look: number, walk: number, phase: number) => void;
}
/** Immutable sources are shared; every resident figure gets its own skeleton. */
export class FigureSkins {
  /** Shared prepared-skin validation for individual and merged row-owned figures. */
  static async prepared(url: string): Promise<THREE.SkinnedMesh> {
    const gltf = await loadRigFile(url), meshes: THREE.SkinnedMesh[] = [];
    rigRoot(gltf).traverse(node => { if (isSkin(node)) meshes.push(node); });
    const mesh = meshes[0];
    if (mesh === undefined || meshes.length !== 1 || !mesh.geometry.hasAttribute('skinIndex')
      || !mesh.geometry.hasAttribute('skinWeight')) throw new Error(`Invalid prepared figure skin ${url}`);
    return mesh;
  }
  private readonly sharedMats = new ResourceMemo<string, THREE.MeshStandardMaterial>();
  private readonly sources = new ResourceMemo<string, Source>(key => { this.sharedMats.invalidate(key); });
  /** Required baked intake; missing or invalid skins refuse, with no runtime fitting. */
  load(row: FigureSkinRow): Promise<Source> {
    return this.sources.load(JSON.stringify(row), async () => {
        const [mesh, appearance] = await Promise.all([FigureSkins.prepared(row.url), loadRigFile(row.material)]);
        if (mesh.skeleton.bones.length !== LEG_BONE_NAMES.length ||
            mesh.skeleton.bones.some((bone, i) => bone.name !== LEG_BONE_NAMES[i])) throw new Error(`Invalid baked NPC skin ${row.url}`);
        const surfaces: THREE.MeshStandardMaterial[] = [], look = rigRoot(appearance);
        look.traverse(node => {
          if (!('isMesh' in node) || node.isMesh !== true || !('material' in node)) return;
          const material: unknown = Array.isArray(node.material) ? node.material[0] : node.material;
          if (material instanceof THREE.MeshStandardMaterial) surfaces.push(material);
        });
        const material = surfaces[0];
        if (!(material instanceof THREE.MeshStandardMaterial) || material.map === null || material.normalMap === null) throw new Error(`Baked NPC lacks PBR maps ${row.url}`);
        const geometry = mesh.geometry;
        if (!geometry.hasAttribute('skinIndex') || !geometry.hasAttribute('skinWeight')) throw new Error(`Baked NPC lacks skin channels ${row.url}`);
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        if (geometry.boundingSphere !== null) geometry.boundingSphere.radius += 0.5;
        const right = row.ball[0], left = row.ball[1];
        if (row.rest.length !== LEG_BONE_NAMES.length) throw new Error(`Invalid baked NPC rest frame ${row.url}`);
        const rig: LegBuilt = { geometry, rest: row.rest.map(point => new THREE.Vector3().fromArray(point)),
          height: row.height, y0: row.y0, lantern: row.lantern === null ? null : new THREE.Vector3().fromArray(row.lantern),
          ball: [new THREE.Vector3().fromArray(right), new THREE.Vector3().fromArray(left)],
          walkSpeed: row.walkSpeed, walkCycle: row.walkCycle, webs: row.webs };
        const hit = { rig, map: material.map, normalMap: material.normalMap };
        look.traverse(node => { if ('geometry' in node && node.geometry instanceof THREE.BufferGeometry) node.geometry.dispose(); });
        const skinSurfaces = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (surfaces.length > MAX_SURFACES || skinSurfaces.length > MAX_SURFACES) throw new Error(`Baked NPC has over ${String(MAX_SURFACES)} materials ${row.url}`);
        for (let i = 0; i < Math.min(surfaces.length, MAX_SURFACES); i++) surfaces[i]?.dispose();
        for (let i = 0; i < Math.min(skinSurfaces.length, MAX_SURFACES); i++) skinSurfaces[i]?.dispose();
        mesh.skeleton.dispose();
        return hit;
    });
  }

  /** A baked skin instance, or null until its declared source has loaded. */
  rig(row: FigureSkinRow, sky: Pick<SkyRig, 'setupMaterial'>): FigureRig | null {
    const key = JSON.stringify(row), src = this.sources.peek(key);
    if (!src) return null;
    const mat = this.sharedMats.acquire(key, () => {
      const material = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap,
        normalScale: new THREE.Vector2(...row.surface.normalScale), roughness: row.surface.roughness, metalness: row.surface.metalness });
      material.name = row.surface.name;
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      sky.setupMaterial(material);
      return material;
    });
    // E322 F-M3: legs, a clavicle and a twist bone, the walk clip (npcRig.ts)
    const lb = src.rig, lbones = legBones(lb), pose = legPose(lbones, lb);
    const mesh = new THREE.SkinnedMesh(lb.geometry, mat);
    const root = lbones[0];
    if (root) mesh.add(root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(lbones));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const handR = lbones.find(bone => bone.name === 'handR');
    if (handR === undefined) throw new Error('Baked figure lacks its right hand');
    return {
      mesh, height: lb.height, lanternAt: lb.lantern, handR, handAt: new THREE.Vector3().setFromMatrixPosition(handR.matrixWorld), walkSpeed: lb.walkSpeed, walkCycle: lb.walkCycle,
      pose: (t, talk, point, pointYaw, look, walk, phase) => { pose({ t, talk, point, pointYaw, look, walk, phase }); },
    };
  }
}

/** A merged figure atlas's skin (format/figures.ts FigureAtlasSchema): the prepared skin, its joints in their declared
 *  order, painted on one painterly material from the original images packed onto the atlas's canvas cells. The owner
 *  owns the draw; joints are left for the caller to publish and drive. */
/** A product's content URL for a skin it names (GR6: built skins ship as product files); any other URL as written. */
export function productSkinUrl(product: { readonly hasFile: (name: string) => boolean; readonly url: (name: string) => string }): (url: string) => string {
  return url => product.hasFile(url) ? product.url(url) : url;
}
export async function atlasFigureSkin(input: unknown, sky: SkyRig, owner: Scope, skinUrl: (url: string) => string = url => url): Promise<THREE.SkinnedMesh> {
  const row = v.parse(FigureAtlasSchema, input);
  if (row.sources.length > row.columns * row.rows || new Set(row.joints).size !== row.joints.length) throw new Error('Invalid figure atlas layout');
  const [mesh, sources] = await Promise.all([FigureSkins.prepared(skinUrl(row.url)), Promise.all(row.sources.map(url => loadRigFile(url)))]);
  owner.own(mesh.geometry); owner.own(mesh.skeleton);
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  if (owner.disposed) throw new Error('Figure left during skin admission');
  if (mesh.skeleton.bones.length !== row.joints.length || mesh.skeleton.bones.some((bone, i) => bone.name !== row.joints[i]))
    throw new Error('Prepared figure joint order differs');
  const canvas = document.createElement('canvas'); canvas.width = row.cell * row.columns; canvas.height = row.cell * row.rows;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Figure atlas canvas unavailable');
  context.imageSmoothingQuality = 'high';
  sources.forEach((source, i) => {
    const object = source.scene.getObjectByProperty('isMesh', true);
    if (!(object instanceof THREE.Mesh)) throw new Error('Missing figure atlas source');
    const material: unknown = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!(material instanceof THREE.MeshStandardMaterial) || material.map === null) throw new Error('Missing figure atlas image');
    context.drawImage(material.map.image as CanvasImageSource, i % row.columns * row.cell, Math.floor(i / row.columns) * row.cell, row.cell, row.cell);
  });
  const map = owner.own(new THREE.CanvasTexture(canvas)); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const material = owner.own(painterlyMaterial(sky, { map, rim: row.rim, bands: row.bands })); material.side = THREE.DoubleSide;
  mesh.material = material; mesh.name = row.name; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  for (const bone of mesh.skeleton.bones) { bone.removeFromParent(); bone.matrixAutoUpdate = false; bone.matrixWorldAutoUpdate = false; }
  bindRig(mesh, [], { skeleton: row.skeleton, clips: [], sockets: [] }, { skeleton: row.skeleton, joints: [row.joints] });
  return mesh;
}
