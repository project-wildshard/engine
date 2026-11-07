import { InstancedMesh, PointLight, Vector3, Object3D, Group, Mesh, MeshStandardMaterial, BufferGeometry, Texture, DataTexture, RGBAFormat, UnsignedByteType, Material } from 'three';
import { parsePrivateScene, parseWorldScene, parseWorldSceneBindings, type WorldSceneBindingKind, parseHeldMeleePhase } from '@wildshard/format/clientChannels';
import type { ColliderDesc } from '@wildshard/engine/world/registry';
import type { ModelFit } from './geometry';

/** Caller-owned private assets; no resource is fetched or globally installed by scene construction. */
export interface ClientScenePorts {
  readonly geometry: ReadonlyMap<string, unknown> | ((id: string) => unknown);
  readonly objects?: ReadonlyMap<string, unknown>;
  readonly textures?: ReadonlyMap<string, unknown>;
  readonly materials?: ReadonlyMap<string, unknown>;
  readonly textureRepeat?: ReadonlyMap<string, unknown>;
  readonly decorators?: ReadonlyMap<string, (material: MeshStandardMaterial) => void>;
}
/** One private hierarchy; only newly created materials belong to its disposal boundary. */
export interface ClientScene {
  readonly root: Object3D;
  readonly parts: ReadonlyMap<string, Object3D>;
  readonly materials: ReadonlyMap<string, Material>;
  group: (id: string) => Group | null;
  mesh: (id: string) => Mesh<BufferGeometry, MeshStandardMaterial> | null;
  standardMaterial: (id: string) => MeshStandardMaterial | null;
  dispose: () => void;
}

/** Borrowed world-bake result, including actual kind objects for native effect owners. */
export interface WorldSceneObject { readonly root: Object3D; readonly colliders: ColliderDesc[]; readonly kinds?: ReadonlyMap<string, Object3D> }
/** Explicit constructors supplied by the owning world; content selects only named, bounded resources. */
export interface WorldScenePorts extends ClientScenePorts {
  readonly model: (name: string, fit: ModelFit) => Object3D | null;
  readonly baked: (piece: string, only?: Readonly<Record<string, string | number | boolean>>, each?: (material: MeshStandardMaterial) => void) => WorldSceneObject;
  readonly materialCollectors?: ReadonlyMap<string, (material: MeshStandardMaterial) => void>;
}
/** One admitted world hierarchy and its borrowed bake metadata. */
export interface WorldScene extends ClientScene { readonly root: Group; readonly baked: ReadonlyMap<string, WorldSceneObject> }
/** Bind resource rows through real model/bake ports, then use the existing private-scene assembler. */
export function createWorldScene(input: unknown, ports: WorldScenePorts): WorldScene {
  const recipe = parseWorldScene(input), objects = new Map<string, unknown>(ports.objects), baked = new Map<string, WorldSceneObject>();
  if (recipe.scene.nodes.find(node => node.id === recipe.scene.root)?.kind !== 'group') throw new Error('World scene requires a group root');
  for (const row of recipe.imports) {
    if (objects.has(row.id)) throw new Error('World import crosses an existing object port');
    if (row.kind === 'baked' && row.materials !== undefined && !ports.materialCollectors?.has(row.materials)) throw new Error('World import requires its material collector');
  }
  for (const row of recipe.imports) {
    if (row.kind === 'model') objects.set(row.id, ports.model(row.model, row.fit));
    else {
      const made = ports.baked(row.piece, row.only, row.materials === undefined ? undefined : ports.materialCollectors?.get(row.materials));
      objects.set(row.id, made.root); baked.set(row.id, made);
    }
  }
  const made = createClientScene(recipe.scene, { ...ports, objects });
  if (!sceneGroup(made.root)) { made.dispose(); throw new Error('World scene lost its group root'); }
  return { ...made, root: made.root, baked };
}
function sceneRepeat(value: unknown): value is readonly [number,number] { return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e5); }
function sceneGroup(value: unknown): value is Group { return value instanceof Group; }
function sceneStandard(value: unknown): value is MeshStandardMaterial { return value instanceof MeshStandardMaterial; }
function sceneMesh(value: unknown): value is Mesh<BufferGeometry, MeshStandardMaterial> { return value instanceof Mesh && sceneGeometry(value.geometry) && sceneStandard(value.material); }
function sceneObject(value: unknown): value is Object3D { return value instanceof Object3D; }
function sceneGeometry(value: unknown): value is BufferGeometry { return value instanceof BufferGeometry; }
function sceneMaterial(value: unknown): value is Material { return value instanceof Material; }
function sceneTexture(value: unknown): value is Texture { return value instanceof Texture; }

/** Admit and assemble an exact ordered private hierarchy, using only the caller's owned visual ports. */
export function createClientScene(input: unknown, ports: ClientScenePorts): ClientScene {
  const row = parsePrivateScene(input), definitions = new Map(row.nodes.map(node => [node.id, node]));
  const sources = new Map<string, Object3D | null>(), geometry = new Map<string, BufferGeometry | null>();
  const externalMaterials = new Map<string, Material | null>(), textures = new Map<string, Texture | null>();
  const imported = new Set<Object3D>(), decodedTextures: Texture[] = [], repeats = new Map<string, readonly [number, number]>();
  for (const texture of row.textures) {
    if (texture.kind === 'rgba') {
      const repeat: unknown = 'port' in texture.repeat ? ports.textureRepeat?.get(texture.repeat.port) : texture.repeat;
      if (!sceneRepeat(repeat)) throw new Error('Private texture repeat unavailable');
      repeats.set(texture.id,[repeat[0],repeat[1]]);
    }
    const value: unknown = ports.textures?.get(texture.source);
    if (texture.kind === 'port') {
      if (value !== null && !sceneTexture(value)) throw new Error('Private texture port differs from declaration');
      textures.set(texture.id,value);
    } else {
      if (value !== null && !(value instanceof Uint8Array)) throw new Error('Private RGBA port differs from declaration');
      if (value !== null && value.byteLength !== texture.bytes) throw new Error('Private RGBA byte extent differs');
      // Decode only after all references and active subtrees are validated.
      textures.set(texture.id,null);
    }
  }
  const sourceObject = (id: string): Object3D | null => {
    if (sources.has(id)) return sources.get(id) ?? null;
    if (ports.objects?.has(id) !== true) throw new Error(`Missing declared private object ${id}`);
    const object = ports.objects.get(id);
    if (object !== null && !sceneObject(object)) throw new Error('Private object port differs from its declaration');
    sources.set(id, object); return object;
  };
  for (const node of row.nodes) {
    if ('when' in node) sourceObject(node.when.object);
    if ('visibleWhen' in node) sourceObject(node.visibleWhen.object);
    if (node.kind === 'object') {
      const object = sourceObject(node.source);
      if (object !== null) { if (imported.has(object)) throw new Error('Private object port repeated'); imported.add(object); }
      else if (node.missing === 'refuse') throw new Error('Required private object unavailable');
    }
  }

  const parents = new Map<string, string>();
  for (const node of row.nodes) {
    for (const child of node.children) parents.set(child, node.id);
    if (node.kind === 'anchor') parents.set(node.id, node.source);
  }
  const active = new Map<string, boolean>();
  const enabled = (id: string): boolean => {
    const prior = active.get(id); if (prior !== undefined) return prior;
    const node = definitions.get(id); if (node === undefined) throw new Error('Private scene node missing');
    const parent = parents.get(id);
    let on = parent === undefined || enabled(parent);
    if ('whenTexture' in node) {
      const condition = node.whenTexture;
      const texture = row.textures.find(entry => entry.id === condition.texture);
      const available = texture !== undefined && ports.textures?.get(texture.source) !== null;
      on &&= available === node.whenTexture.present;
    }
    if ('when' in node) on &&= (sourceObject(node.when.object) !== null) === node.when.present;
    if (node.kind === 'object') on &&= sourceObject(node.source) !== null;
    if (node.kind === 'anchor') {
      const source = definitions.get(node.source); if (source?.kind !== 'object') throw new Error('Crossed private anchor');
      let target = sourceObject(source.source); for (const index of node.path) target = target?.children[index] ?? null;
      if (target === null && node.missing === 'refuse') throw new Error('Required private anchor unavailable');
      on &&= target !== null;
    }
    if (node.kind === 'mesh' && on) {
      const value: unknown = typeof ports.geometry === 'function' ? ports.geometry(node.geometry) : ports.geometry.get(node.geometry);
      if (value !== null && !sceneGeometry(value)) throw new Error('Private geometry port differs from its declaration');
      geometry.set(id, value);
      if (value === null && node.missing === 'omit') on = false;
    }
    active.set(id, on); return on;
  };
  for (const node of row.nodes) enabled(node.id);
  if (!enabled(row.root)) throw new Error('Private scene root unavailable');
  const used = new Set(row.nodes.filter(node => node.kind === 'mesh' && enabled(node.id) && !(geometry.get(node.id) === null && node.missing === 'group')).map(node => node.kind === 'mesh' ? node.material : ''));

  for (const material of row.materials) {
    if (!used.has(material.id)) continue;
    if (material.kind === 'port') {
      if (ports.materials?.has(material.source) !== true) throw new Error(`Missing private material ${material.source}`);
      const value = ports.materials.get(material.source);
      if (!sceneMaterial(value)) throw new Error('Private material port differs from its declaration');
      externalMaterials.set(material.id, value);
    } else {
      if (material.decorate !== undefined && !ports.decorators?.has(material.decorate)) throw new Error('Missing private material decorator');
      for (const id of Object.values(material.maps ?? {})) {
      if (textures.has(id)) continue;
      if (ports.textures?.has(id) !== true) throw new Error(`Missing private texture ${id}`);
      const value = ports.textures.get(id);
      if (value !== null && !sceneTexture(value)) throw new Error('Private texture port differs from its declaration');
      textures.set(id, value);
      }
    }
  }
  // Required anchors are checked before touching caller-owned objects.
  for (const node of row.nodes) if (node.kind === 'anchor' && node.missing === 'refuse') {
    const source = definitions.get(node.source); if (source?.kind !== 'object') throw new Error('Crossed private anchor');
    let target = sourceObject(source.source); for (const index of node.path) target = target?.children[index] ?? null;
    if (target === null) throw new Error('Required private anchor unavailable');
  }
  const materials = new Map<string, Material>(), created: Material[] = [], emptyGeometry: BufferGeometry[] = [], parts = new Map<string, Object3D>();
  try {
    const usedTextures = new Set(row.materials.flatMap(material => material.kind === 'standard' && used.has(material.id) ? Object.values(material.maps ?? {}) : []));
    for (const texture of row.textures) {
      if (texture.kind !== 'rgba' || !usedTextures.has(texture.id)) continue;
      const value: unknown = ports.textures?.get(texture.source); if (value === null) continue;
      if (!(value instanceof Uint8Array)) throw new Error('Private RGBA backing unavailable');
      const data = new DataTexture(value.subarray(texture.offset,texture.offset + texture.width * texture.height * 4),texture.width,texture.height,RGBAFormat,UnsignedByteType);
      data.wrapS=texture.wrapS;data.wrapT=texture.wrapT;data.magFilter=texture.magFilter;data.minFilter=texture.minFilter;
      data.generateMipmaps=texture.mipmaps;data.anisotropy=texture.anisotropy;data.colorSpace=texture.colorSpace;
      const repeat = repeats.get(texture.id); if (repeat === undefined) throw new Error('Private texture repeat disappeared');
      data.repeat.set(...repeat);data.needsUpdate=true;decodedTextures.push(data);textures.set(texture.id,data);
    }
    for (const material of row.materials) {
    if (!used.has(material.id)) continue;
      if (material.kind === 'port') {
        const value = externalMaterials.get(material.id); if (value === undefined) throw new Error('Private material disappeared'); if (value !== null) materials.set(material.id, value);
      } else {
        const { normalScale, ...properties } = material.properties;
        const value = new MeshStandardMaterial({ ...properties,
          ...(material.maps?.map === undefined ? {} : { map: textures.get(material.maps.map) ?? null }),
          ...(material.maps?.normalMap === undefined ? {} : { normalMap: textures.get(material.maps.normalMap) ?? null }),
          ...(material.maps?.roughnessMap === undefined ? {} : { roughnessMap: textures.get(material.maps.roughnessMap) ?? null }),
        });
        if (normalScale !== undefined) value.normalScale.set(...normalScale);
        if (material.userData !== undefined) Object.assign(value.userData, material.userData);
        created.push(value);
        if (material.decorate !== undefined) { const decorate=ports.decorators?.get(material.decorate); if (decorate === undefined) throw new Error('Private decorator unavailable'); decorate(value); }
        materials.set(material.id, value);
      }
    }
    for (const node of row.nodes) {
      if (!enabled(node.id)) continue;
      let object: Object3D | null;
      if (node.kind === 'group') object = new Group();
      else if (node.kind === 'object') object = sourceObject(node.source);
      else if (node.kind === 'anchor') {
        const source = definitions.get(node.source);
        if (source?.kind !== 'object') throw new Error('Crossed private anchor source');
        object = sourceObject(source.source);
        for (const index of node.path) object = object?.children[index] ?? null;
        if (object === null && node.missing === 'refuse') throw new Error('Required private anchor unavailable');
      } else {
        const source = geometry.get(node.id) ?? null, material = materials.get(node.material);
        if (source === null && node.missing === 'group') { object = new Group(); }
        else {
        if (material === undefined) throw new Error('Private mesh material disappeared');
        let backing = source;
        if (backing === null && node.missing === 'empty') { backing = new BufferGeometry(); emptyGeometry.push(backing); }
        if (backing === null) object = null;
        else if (node.instances === undefined) object = new Mesh(backing, material);
        else {
          const mesh = new InstancedMesh(backing, material, node.instances);
          if (node.matrices !== undefined) { mesh.instanceMatrix.array.set(node.matrices); mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
          object = mesh;
        }
        }
      }
      if (object === null) continue;
      if (node.kind !== 'anchor') {
        if (node.name !== undefined) object.name = node.name;
        if (node.position !== undefined) object.position.set(...node.position);
        if (node.rotation !== undefined) object.rotation.set(...node.rotation, node.order ?? object.rotation.order);
        if (node.scale !== undefined) object.scale.set(...node.scale);
        if (node.visible !== undefined) object.visible = node.visible;
        if (node.visibleWhen !== undefined) object.visible = (sourceObject(node.visibleWhen.object) !== null) === node.visibleWhen.present;
        if (node.castShadow !== undefined) object.castShadow = node.castShadow;
        if (node.receiveShadow !== undefined) object.receiveShadow = node.receiveShadow;
        if (node.frustumCulled !== undefined) object.frustumCulled = node.frustumCulled;
        if (node.renderOrder !== undefined) object.renderOrder = node.renderOrder;
      }
      parts.set(node.id, object);
    }
    // Attach only after all declarations exist: child order, not declaration order, owns each original source draw.
    for (const node of row.nodes) {
      const parent = parts.get(node.id); if (parent === undefined) continue;
      for (const id of node.children) { const child = parts.get(id); if (child !== undefined) parent.add(child); }
    }
    const root = parts.get(row.root); if (root === undefined) throw new Error('Private scene root unavailable');
    return ownedClientScene(root,parts,materials,created,emptyGeometry,decodedTextures);
  } catch (error) { for (const material of created) material.dispose(); for (const empty of emptyGeometry) empty.dispose(); for (const texture of decodedTextures) texture.dispose(); throw error; }
}

// Returned closures have a separate scope: they never retain transport ports, source Maps or decoder callbacks.
function ownedClientScene(root: Object3D, parts: Map<string,Object3D>, materials: Map<string,Material>, created: readonly Material[], emptyGeometry: readonly BufferGeometry[], decodedTextures: readonly Texture[]): ClientScene {
  let disposed = false;
  return Object.freeze({ root, parts, materials, group: (id: string) => { const value = parts.get(id); return sceneGroup(value) ? value : null; },
      mesh: (id: string) => { const value = parts.get(id); return sceneMesh(value) ? value : null; },
      standardMaterial: (id: string) => { const value = materials.get(id); return sceneStandard(value) ? value : null; }, dispose: () => { if (disposed) return; disposed = true; root.removeFromParent(); for (const material of created) material.dispose(); for (const empty of emptyGeometry) empty.dispose(); for (const texture of decodedTextures) texture.dispose(); } });
}


/** Resolve an admitted melee schedule against its existing private scene parts before any input is installed. */
export function createHeldMeleeBinding(input: unknown, parts: ReadonlyMap<string, unknown>): {
  readonly row: ReturnType<typeof parseHeldMeleePhase>;
  readonly phases: ReadonlyMap<string, ReturnType<typeof parseHeldMeleePhase>['phases'][number]>;
  readonly moving: Object3D | null; readonly resting: Object3D | null; readonly deformation: Object3D | null;
} {
  const row = parseHeldMeleePhase(input);
  const phases = new Map(row.phases.map(phase => [phase.id, phase]));
  if (row.mode === 'immediate') { phases.set(row.secondary.phase.id, row.secondary.phase); return { row, phases, moving: null, resting: null, deformation: null }; }
  const isNode = (value: unknown): value is Object3D => value instanceof Object3D;
  const node = (id: string): Object3D => { const value = parts.get(id); if (!isNode(value)) throw new Error('Held phase requires its owned scene part'); return value; };
  return { row, phases, moving: node(row.bindings.moving), resting: node(row.bindings.resting), deformation: node(row.bindings.deformation) };
}

/** Native identities and copied anchors selected from one admitted scene. */
export type WorldSceneBoundParts<K extends Readonly<Record<string,WorldSceneBindingKind>>> = K extends Readonly<Record<string,WorldSceneBindingKind>> ? {
  readonly [P in keyof K]: K[P] extends 'group' ? Group : K[P] extends 'mesh' ? Mesh<BufferGeometry,MeshStandardMaterial> :
  K[P] extends 'object' ? Object3D : K[P] extends 'point-light' ? PointLight : K[P] extends 'standard-material' ? MeshStandardMaterial :
  K[P] extends 'vector' ? Vector3 : K[P] extends 'number' ? number : ColliderDesc[];
} : never;
/** Bind a typed native contract without cloning owned scene parts, changing poses or registering collision. */
export function bindWorldSceneParts<K extends Readonly<Record<string,WorldSceneBindingKind>>>(made:ClientScene & Partial<Pick<WorldScene,'baked'>>,kinds:K,input:unknown):WorldSceneBoundParts<K> {
  const rows=parseWorldSceneBindings(input), out:Record<string,Object3D|MeshStandardMaterial|Vector3|number|ColliderDesc[]>={};
  if(Object.keys(kinds).length!==Object.keys(rows).length)throw new Error('World scene binding contract differs');
  for(const [key,row] of Object.entries(rows)) {
    if(!Object.hasOwn(kinds,key)||kinds[key]!==row.kind)throw new Error(`World scene binding kind differs: ${key}`);
    const value=row.kind==='vector'?new Vector3(...row.value):row.kind==='number'?row.value:row.kind==='colliders'?made.baked?.get(row.part)?.colliders:
      row.kind==='standard-material'?made.standardMaterial(row.part):row.kind==='group'?made.group(row.part):row.kind==='mesh'?made.mesh(row.part):made.parts.get(row.part);
    if(value===null||value===undefined||(row.kind==='point-light'&&!(value instanceof PointLight)))throw new Error(`Missing world scene binding: ${key}`);
    out[key]=value;
  }
  // Every requested key and kind was validated against its actual native value above.
  return out as WorldSceneBoundParts<K>;
}
