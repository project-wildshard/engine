/**
 * The practice dummies' own studio light (E285). The arena hangs 900 m over each shard inside that shard's scene, so
 * its sun, hemisphere and clock (night on Driftwood, dusk on Pine Hollow) used to light the figures, and the GLB
 * materials faked the rest with the base map as emissive at 0.55: flat, washed-out armour. Instead each dummy material
 * ignores the scene's lights and takes a fixed key / fill / rim set plus a sky-to-floor ambient and a small
 * prefiltered studio environment (overhead softboxes, the room's cyan floor glow), so the baked PBR maps read the same
 * on every shard at every hour. No scene light is added (no shard-wide shader recompile), no shadow map.
 */
import * as THREE from 'three';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';
import type { Renderer } from '../render/renderer';

/** Shared by every dummy material: one program for all three figures. */
const uniforms = {
  uStudioKeyDir: { value: new THREE.Vector3(-0.55, 0.72, 0.62).normalize() },
  uStudioKeyCol: { value: new THREE.Color(1.0, 0.94, 0.86).multiplyScalar(2.6) },
  uStudioFillDir: { value: new THREE.Vector3(0.8, 0.25, 0.55).normalize() },
  uStudioFillCol: { value: new THREE.Color(0.55, 0.72, 0.95).multiplyScalar(0.95) },
  uStudioRimDir: { value: new THREE.Vector3(0.35, 0.55, -0.85).normalize() },
  uStudioRimCol: { value: new THREE.Color(0.46, 0.85, 1.0).multiplyScalar(2.2) },
  uStudioSky: { value: new THREE.Color(0.42, 0.5, 0.6) },
  uStudioGround: { value: new THREE.Color(0.12, 0.2, 0.28) },
};

const DECLS = `
uniform vec3 uStudioKeyDir; uniform vec3 uStudioKeyCol;
uniform vec3 uStudioFillDir; uniform vec3 uStudioFillCol;
uniform vec3 uStudioRimDir; uniform vec3 uStudioRimCol;
uniform vec3 uStudioSky; uniform vec3 uStudioGround;
`;

const STUDIO = `
IncidentLight directLight;
#ifdef STANDARD
	material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / max( material.dfg.x + material.dfg.y, 1e-3 ) - 1.0 );
#endif
directLight.visible = true;
directLight.direction = normalize( ( viewMatrix * vec4( uStudioKeyDir, 0.0 ) ).xyz );
directLight.color = uStudioKeyCol;
RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
directLight.direction = normalize( ( viewMatrix * vec4( uStudioFillDir, 0.0 ) ).xyz );
directLight.color = uStudioFillCol;
RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
directLight.direction = normalize( ( viewMatrix * vec4( uStudioRimDir, 0.0 ) ).xyz );
directLight.color = uStudioRimCol;
RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 studioN = inverseTransformDirection( geometryNormal, viewMatrix );
	vec3 irradiance = mix( uStudioGround, uStudioSky, 0.5 + 0.5 * studioN.y );
#endif
`;

/** three's lights_fragment_begin with its scene-light loops swapped for the studio set; null if the chunk changed shape */
function studioChunk(): string | null {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const a = chunk.indexOf('IncidentLight directLight;');
  const b = chunk.indexOf('#if defined( RE_IndirectSpecular )');
  if (a === -1 || b < a) return null;
  return chunk.slice(0, a) + STUDIO + chunk.slice(b);
}
let chunkCache: string | null | undefined;

/** A small prefiltered environment: a dark navy box, overhead softboxes, a warm key panel and the cyan floor glow. */
function buildEnv(renderer: Renderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.085, 0.13), side: THREE.BackSide }));
  box.position.y = 4; scene.add(box);
  const panel = (w: number, h: number, color: THREE.Color, x: number, y: number, z: number, rx: number, ry: number): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); scene.add(m);
  };
  const soft = new THREE.Color(1, 0.97, 0.92).multiplyScalar(3.2);
  for (const x of [-3.2, 0, 3.2]) panel(1.4, 9, soft, x, 8.9, 0, Math.PI / 2, 0); // the ceiling softboxes over the lineup
  panel(5, 3.5, new THREE.Color(1, 0.9, 0.78).multiplyScalar(2.2), -6, 5, 7, 0, Math.PI * 0.8); // key, front left
  panel(4, 2.5, new THREE.Color(0.55, 0.75, 1).multiplyScalar(1.1), 7, 2.5, 5, 0, -Math.PI * 0.7); // fill, front right
  const glow = new THREE.Color(0.46, 0.85, 1).multiplyScalar(1.4);
  panel(20, 0.35, glow, 0, 0.2, -9.9, 0, 0); panel(20, 0.35, glow, 0, 0.2, 9.9, 0, Math.PI);
  panel(20, 0.35, glow, -9.9, 0.2, 0, 0, Math.PI / 2); panel(20, 0.35, glow, 9.9, 0.2, 0, 0, -Math.PI / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.13, 0.2) }));
  scene.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 40);
  pmrem.dispose();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry: unknown = o.geometry;
    if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
    const material: unknown = o.material;
    if (material instanceof THREE.Material) material.dispose();
  });
  return target;
}
let envTarget: THREE.WebGLRenderTarget | null = null;

/**
 * Relight every standard material under `root` with the studio set. Returns the materials (the hit flash drives their
 * emissive). The procedural fallback's flat-shaded materials take it too.
 */
export function applyDummyStudio(root: THREE.Object3D, renderer: Renderer): THREE.MeshStandardMaterial[] {
  chunkCache ??= studioChunk();
  const chunk = chunkCache;
  envTarget ??= buildEnv(renderer);
  const env = envTarget.texture;
  const out: THREE.MeshStandardMaterial[] = [];
  const seen = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const source: unknown = part.material;
    if (!(source instanceof THREE.MeshStandardMaterial)) return;
    let material = seen.get(source);
    if (!material) {
      material = source.clone(); // each figure owns its copies: the flash is per dummy
      material.emissive.set(0x000000);
      material.emissiveMap = null;
      material.emissiveIntensity = 1;
      material.envMap = env;
      material.envMapIntensity = 0.85;
      material.fog = false;
      // Driftwood's toon patch (its look's lighting) finds its sun by direction; the studio set has no sun: opt out
      material.defines = { ...material.defines, NO_TOON: '' };
      if (chunk !== null) {
        patchShader(material, 'engine.dummy-studio', PATCH_ORDER.material, (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.fragmentShader = DECLS + shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
        }, { mode: 'replace', key: 'ws-dummy-studio-1' });
      } else {
        material.emissive.setScalar(0.12); // three changed the chunk: keep the figure readable, unlit-ish
      }
      material.needsUpdate = true;
      seen.set(source, material);
      out.push(material);
    }
    part.material = material;
  });
  return out;
}
