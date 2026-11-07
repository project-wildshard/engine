import { PaintedAirSchema } from '@wildshard/format/paintedResources';
import { CircleGeometry, Group, InstancedBufferAttribute, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderChunk, Vector2, Vector4, type IUniform, type Object3D, type Texture } from 'three';
import * as v from 'valibot';
import { TIER } from '@wildshard/engine/core/tier';
import { loadCarriedLUT } from '@wildshard/engine/boot/bakedApi';
import { paintedLookFromRow, painterLight, painterLightPatch, type PaintedDressingContext, type PaintedLoad } from '@wildshard/engine/render/dataLook';
import { instancedQuad } from '@wildshard/engine/render/instancedGeometry';
import type { LookStrategy, SkyDressing } from '@wildshard/engine/render/look';
import { addFogUniforms } from '@wildshard/engine/world/Atmosphere';
import { wind } from '@wildshard/engine/world/steppeWind';
import type { Scope } from '@wildshard/engine/app/scope';
import type { GraphIr } from '@wildshard/format/materialGraph';
import { parsePaintedLook } from '@wildshard/format/paintedLook';
import { loadPaintedTexture } from '../plugin/geometry';
import { productClosureFile, type ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { materialGraphIr } from '@wildshard/format/materials';
import { sceneScalar } from '../shardfile/sceneInputs';
import type { LentLooks } from '../shardfile/lentLooks';
import { prepareBinarySources } from '../models/binarySource';

/** Client-only painted presentation. All images, geometry and graph ids come from
 * admitted product rows; renderer construction and lifetime hooks stay here. */
const productImages = new WeakMap<object, ReadonlyMap<string, Texture>[]>();
/** Borrow an image already prepared by the actual product's painted look. */
export function productPaintedImage(product: ShardProduct, id: string): Texture {
  const texture = productImages.get(product.shardfile.files)?.at(-1)?.get(id);
  if (texture === undefined) throw new Error(`Missing prepared painted image: ${id}`); return texture;
}
export async function productPaintedLook(product: ShardProduct): Promise<LookStrategy> {
  const row = parsePaintedLook(product.section('look/painted'));
  const attributeFiles=await prepareBinarySources(product,(row.dressing?.draws??[]).flatMap(draw=>draw.geometry.kind==='plane'
    ?Object.values(draw.geometry.instances??{}).map(attribute=>{
      if(!('file'in attribute))throw new Error('Painted attributes require named binary files');
      return {source:{file:attribute.file},bytes:attribute.count*4};
    }):[]));
  for(const bytes of attributeFiles.values()){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let offset=0;offset<bytes.byteLength;offset+=4)if(!Number.isFinite(view.getFloat32(offset,true)))throw new Error('Painted attribute requires finite float32 values');
  }
  const images = new Map<string, Texture>();
  const required: PaintedLoad = async (...args) => {
    const texture = await loadPaintedTexture(...args);
    if (texture === null) throw new Error(`Missing painted image: ${args[0]}`);
    return texture;
  };
  await Promise.all(Object.entries(row.images).map(async ([id, tiers]) => {
    const image = 'phone' in tiers ? tiers[TIER] : tiers;
    const texture = await loadPaintedTexture(image.url, image.name, image.warn, image.sampler);
    if (texture === null) throw new Error(`Missing painted image: ${image.url}`);
    images.set(id, texture);
  }));
  const prepared = productImages.get(product.shardfile.files) ?? [];
  prepared.push(images); productImages.set(product.shardfile.files, prepared);
  const image = (id: string): Texture => {
    const texture = images.get(id);
    if (texture === undefined) throw new Error(`Missing painted image binding: ${id}`);
    return texture;
  };
  // D74: the catalogue's graph files, read once (their IR is resolved per graph below)
  const graphFiles = new Map<string, Uint8Array>();
  await Promise.all(Object.values(product.shardfile.look.materials).flatMap(entry => entry.family === 'graph' && 'file' in entry ? [entry.file] : [])
    .map(async hash => { graphFiles.set(hash, await productClosureFile(product, hash)); }));
  const graph = (id: string): GraphIr => {
    const entry = product.shardfile.look.materials[id];
    if (entry?.family !== 'graph' || 'preset' in entry) throw new Error(`Missing painted graph: ${id}`);
    const ir = materialGraphIr(entry, hash => graphFiles.get(hash));
    return { ...ir, params: Object.fromEntries(Object.entries(ir.params ?? {}).map(([name, param]) => {
      if (param.type !== 'texture' || param.role !== 'lent') return [name, param];
      const { role: _role, ...resolved } = param; return [name, resolved];
    })) };
  };
  const dome = row.dome, dressing = row.dressing;
  const look = paintedLookFromRow(row.look, { load: required, textures: [...images.values()],
    ...(row.terrain === undefined ? {} : { terrain: { build: async (_terrain, field) => { await field.ready(); } } }),
    ...(row.state === undefined ? {} : { state: sceneScalar(product.slug, row.state) }),
    ...(row.lut === undefined ? {} : { lut: async () => {
      const texture = await loadCarriedLUT(row.lut, `${product.slug}-lut`);
      if (texture === null) throw new Error(`Missing painted LUT: ${row.lut ?? ''}`);
      return texture;
    } }),
    ...(dome === undefined ? {} : { graph: (strip: Texture) => ({ ir: graph(dome.graph[TIER]), textures: (ref: string) => {
      if (ref === 'haze') return strip;
      if (ref === dome.image) return image(dome.image);
      throw new Error(`Missing painted dome texture binding: ${ref}`);
    } }) }),
    ...(dressing === undefined ? {} : { dressing: async (ctx: PaintedDressingContext) => {
      const group = new Group(); group.name = dressing.name;
      const materials = new Map<string, Awaited<ReturnType<typeof ctx.graph>>>();
      for (const draw of dressing.draws) {
        const key = `${draw.graph}:${draw.image ?? ''}`;
        let material = materials.get(key);
        if (material === undefined) {
          const texture = draw.image === undefined ? undefined : image(draw.image);
          material = await ctx.graph(graph(draw.graph), texture === undefined ? undefined : () => texture);
          materials.set(key, material);
        }
        const geometry = draw.geometry;
        const quad = geometry.kind === 'disc' ? new CircleGeometry(geometry.radius, geometry.segments) : new PlaneGeometry(...geometry.size);
        const mesh = new Mesh(geometry.kind === 'plane' && geometry.instances !== undefined
          ? instancedQuad(quad, Object.fromEntries(Object.entries(geometry.instances).map(([name, attribute]) => {
            if(!('file'in attribute))throw new Error('Painted attributes require named binary files');
            const bytes = attributeFiles.get(attribute.file)?.slice();
            if(bytes===undefined)throw new Error('Painted attribute source was not prepared');
            return [name, new InstancedBufferAttribute(new Float32Array(bytes.buffer), attribute.size)];
          }))) : quad, material);
        mesh.name = draw.name; mesh.renderOrder = draw.order; mesh.frustumCulled = false;
        mesh.position.set(...draw.at);
        if (geometry.kind === 'disc') { mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = draw.spin; }
        group.add(mesh);
      }
      return { group, textures: [], update: () => undefined };
    } }),
  });
  return { ...look, dispose: () => {
    const at = prepared.indexOf(images); if (at !== -1) prepared.splice(at, 1);
    if (prepared.length === 0 && productImages.get(product.shardfile.files) === prepared) productImages.delete(product.shardfile.files);
    look.dispose?.();
  }, ...(row.look.lightScope === 'page' ? { lighting: { install: () => { productPainterLight(product, null); } } } : {}) };
}

/** Prepared relief maps bind the original compiled material before any mapped
 * model copies are made. The look retains image ownership; this scope owns UV clones. */
export function bindPaintedMaterialMaps(product: ShardProduct, scope: Scope, looks: LentLooks): void {
  for (const row of product.section('look/painted').bumps ?? []) {
    const material = looks.materials.get(row.material);
    if (material === undefined || !('bumpMap' in material)) throw new Error(`Missing painted relief material: ${row.material}`);
    const map = scope.own(productPaintedImage(product, row.image).clone()); map.channel = row.channel;
    Object.assign(material, { bumpMap: map, bumpScale: row.scale }); material.needsUpdate = true;
  }
}

/** Apply the product's material-scoped painter to original props/held bodies.
 * The inherited page path and this scoped path use the same numeric light row. */
export function productPainterLight(product: ShardProduct, root: Object3D | null, scope?: Scope): void {
  const row = product.section('look/painted'), seen = new Set<MeshStandardMaterial>();
  const sun = row.materialSun ?? row.look.sun.dir;
  if (root === null) { painterLight(row.look.light, sun).install(); return; }
  if (scope === undefined || scope.disposed) throw new Error('Painted material lighting requires a live scope');
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials: unknown[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || seen.has(material) || row.materialOptOut !== undefined && material.userData[row.materialOptOut] === true) continue;
      seen.add(material); painterLightPatch(material, row.look.light, sun, scope);
    }
  });
}

/**
 * Painted air (the painterly look host, G478): soft cloud shadows sliding over the ground. The sun's light on every
 * CSM-lit material is multiplied by a drifting cloud-cover field (the sky's cloud fbm, sampled at the fragment's world
 * XZ, one tile every `tile` m): cover past `threshold` (± `softness`) takes `strength` of the light. The field drifts
 * downwind at `drift[0]` × the wind + `drift[1]` m/s, as clouds aloft do. The world paints its own sky (`ownSky`).
 */

const AIR_PARS = /* glsl */`
    #ifdef USE_FOG
      uniform sampler2D fogCloudTex;
      uniform vec4 fogCloud;
      uniform vec2 fogCloudOff;
      #define P_CLOUDS 1
      // the sun's share left by the drifting cloud cover at this fragment (1 = clear sky above)
      float pCloudShadow() {
        vec2 uv = vFogWorldPos.xz * fogCloud.x + fogCloudOff;
        float c = texture2D( fogCloudTex, uv ).r * 0.72 + texture2D( fogCloudTex, uv * 2.3 + vec2( 0.37, 0.61 ) ).r * 0.28;
        return 1.0 - fogCloud.z * smoothstep( fogCloud.y - fogCloud.w, fogCloud.y + fogCloud.w, c );
      }
    #endif`;
/** The painted air from its rows: `install` (with the fog, before anything compiles; idempotent, so a region's re-install
 *  changes nothing), the `sky` dressing that patches the sun loop and drifts the field, and the field's `offset` (uv). */
export function paintedAir(input: unknown): { readonly install: () => void; readonly sky: SkyDressing; readonly offset: Vector2 } {
  const rows = v.parse(PaintedAirSchema, input);
  const field: IUniform<Texture | null> = { value: null }, offset = { value: new Vector2() };
  const uniforms = { fogCloudTex: field, fogCloud: { value: new Vector4(1 / rows.tile, rows.threshold, rows.strength, rows.softness) }, fogCloudOff: offset };
  let installed = false;
  return {
    offset: offset.value,
    install: () => {
      installed = true; addFogUniforms(uniforms);
      if (!ShaderChunk.fog_pars_fragment.includes(AIR_PARS)) ShaderChunk.fog_pars_fragment += AIR_PARS;
    },
    sky: { clouds: false, planet: false, ownSky: true,
      build: (_sky, cloudField) => {
        field.value = cloudField;
        // each directional light's colour, once read, is multiplied by the cover: shadow map, cel bands and grass all see it
        const chunk = ShaderChunk.lights_fragment_begin;
        if (!installed || chunk.includes('pCloudShadow')) return;
        const hook = (call: string): string => `${call}\n\t\t#ifdef P_CLOUDS\n\t\tdirectLight.color *= pCloudShadow();\n\t\t#endif`;
        ShaderChunk.lights_fragment_begin = chunk.replaceAll('getDirectionalLightInfo( directionalLight, directLight );', hook('getDirectionalLightInfo( directionalLight, directLight );'))
          .replaceAll('getDirectionalLightInfo( directionalLights[0], directLight );', hook('getDirectionalLightInfo( directionalLights[0], directLight );'));
      },
      update: dt => {
        const step = (wind.speed * rows.drift[0] + rows.drift[1]) * dt / rows.tile;
        offset.value.x -= wind.dirX * step; offset.value.y -= wind.dirZ * step;
      } },
  };
}
