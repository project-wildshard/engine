import * as THREE from 'three';
import { loft, S, type Paint } from './species/loft';
import { attachFogUniforms } from '../world/Atmosphere';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';

/**
 * Low-poly (faceted, flat-shaded, untextured) rendering of the procedural animals — the Driftwood
 * Isle look (`ShardManifest.style === 'toon'`). The skeleton, stations, bone names, dims and every
 * bit of Animal.ts stay the same; only what the loft produces and how it is lit changes:
 *
 *   species/loft.ts: setLowPoly(true) → every loft has 4–6 sides (lowPolySides) and no shag noise
 *   facetGeometry(geo)         de-index + flat per-face normals + a per-face pastel lightness jitter
 *   toonPaint(kind)            the level's flat palette per species (species/loft.ts registerToonPaint; B50)
 *   crestSpikes(...)           the boar's bristle crest as a row of faceted spikes
 *   lowPolyMaterials()         plain flat-shaded MeshStandardMaterials (no fur texture, no fur shells)
 *
 * AnimalFactory switches all of this on with `new AnimalFactory(sky, { style: 'toon' })`; the
 * PBR path is untouched.
 */

/** material groups that keep their exact colour (eyes): no facet jitter */
const NO_JITTER_GROUPS = new Set([2]);

/**
 * Turn the merged indexed model into a faceted one: every triangle gets its own three vertices and a
 * flat normal (`computeVertexNormals` on non-indexed geometry), and each face's colour is nudged a
 * little so neighbouring facets read as separate planes even when they face the same way (the mockup
 * boar's "bristly" surface). Material groups and the skin attributes survive the de-indexing.
 */
export function facetGeometry(geo: THREE.BufferGeometry, jitter = 0.12): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  geo.dispose();
  g.computeVertexNormals();
  const col = g.attributes['color'] as THREE.BufferAttribute;
  const pos = g.attributes['position'] as THREE.BufferAttribute;
  const skip = (v: number): boolean => g.groups.some((gr) => NO_JITTER_GROUPS.has(gr.materialIndex ?? 0) && v >= gr.start && v < gr.start + gr.count);
  // T10 (H4 warm home): plain Float32 storage is read and written directly, as three's accessors would (the same sums in
  // the same order); any other storage keeps the accessors
  const p = plainVectors(pos), c = plainVectors(col);
  for (let v = 0; v < pos.count; v += 3) {
    if (skip(v)) continue;
    // deterministic per-face hash from the centroid so instances of the same model match
    const cx = p === null ? pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2) : (p[v * 3] ?? 0) + (p[v * 3 + 3] ?? 0) + (p[v * 3 + 6] ?? 0);
    const cy = p === null ? pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2) : (p[v * 3 + 1] ?? 0) + (p[v * 3 + 4] ?? 0) + (p[v * 3 + 7] ?? 0);
    const cz = p === null ? pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2) : (p[v * 3 + 2] ?? 0) + (p[v * 3 + 5] ?? 0) + (p[v * 3 + 8] ?? 0);
    const h = Math.sin(cx * 127.1 + cy * 311.7 + cz * 74.7) * 43758.5453;
    const m = 1 + (h - Math.floor(h) - 0.5) * 2 * jitter;
    if (c === null) for (let k = 0; k < 3; k++) col.setXYZ(v + k, col.getX(v + k) * m, col.getY(v + k) * m, col.getZ(v + k) * m);
    else for (let i = v * 3; i < v * 3 + 9; i++) c[i] = (c[i] ?? 0) * m;
  }
  // the bounds from one box pass: three's computeBoundingSphere centres on this same box (no morph targets here) and takes
  // the farthest vertex's distance from it
  g.computeBoundingBox();
  const box = g.boundingBox;
  if (box === null || p === null || g.morphAttributes.position !== undefined) g.computeBoundingSphere();
  else {
    const centre = box.getCenter(new THREE.Vector3());
    let farthest = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = centre.x - (p[i * 3] ?? 0), dy = centre.y - (p[i * 3 + 1] ?? 0), dz = centre.z - (p[i * 3 + 2] ?? 0);
      farthest = Math.max(farthest, dx * dx + dy * dy + dz * dz);
    }
    g.boundingSphere = new THREE.Sphere(centre, Math.sqrt(farthest));
  }
  if (g.boundingSphere !== null) g.boundingSphere.radius += 0.6;
  return g;
}

/** a vec3 attribute's own Float32 array when three's accessors would read and write it unchanged, else null */
function plainVectors(attribute: THREE.BufferAttribute): Float32Array | null {
  return !attribute.normalized && attribute.itemSize === 3 && attribute.array instanceof Float32Array && attribute.array.length >= attribute.count * 3 ? attribute.array : null;
}

/**
 * The boar's dorsal crest as a serrated row of faceted spikes. `pts` are the crest points of species/boar.ts
 * ([z, y, ry, b0, b1, w1], `yOff` added to y); the ridge is resampled every ~8 cm between them so the spikes
 * overlap into a jagged fin, alternating tall / short, leaning back along the spine. Each spike is a 4-sided
 * pyramid skinned like the nearest crest point so it rides the neck / body bones.
 */
export function crestSpikes(pts: [number, number, number, number, number, number][], yOff: number, paint: Paint): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const P = pts.filter((p) => p[2] >= 0.03).sort((a, b) => a[0] - b[0]);   // rear → front
  if (P.length < 2) return out;
  const first = P[0], last = P[P.length - 1];
  if (first === undefined || last === undefined) return out;
  const z0 = first[0], z1 = last[0], step = 0.082;
  const n = Math.max(2, Math.round((z1 - z0) / step));
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    let k = 0;
    while (k < P.length - 2 && (P[k + 1]?.[0] ?? Infinity) < z) k++;
    const a = P[k], b = P[k + 1];
    if (a === undefined || b === undefined) continue;
    const u = THREE.MathUtils.clamp((z - a[0]) / Math.max(1e-4, b[0] - a[0]), 0, 1);
    const y = a[1] + (b[1] - a[1]) * u, ry = a[2] + (b[2] - a[2]) * u;
    const near = u < 0.5 ? a : b;
    // the PBR fin sits mostly inside the back (its fur shells do the work); the spikes start at the skin
    const h = (ry * 1.8 + 0.03) * (i % 2 ? 0.72 : 1) * (0.8 + 0.2 * Math.sin(z * 5 + 1));
    const baseY = y + 0.02 + yOff;
    out.push(loft([
      S(0, baseY - 0.05, z, 0.034, 0.05, near[3], near[4], near[5]),
      S(0, baseY + h * 0.45, z - h * 0.2, 0.02, 0.03, near[3], near[4], near[5]),
      S(0, baseY + h, z - h * 0.55, 0.003, 0.003, near[3], near[4], near[5]),
    ], 4, 'crest', paint, false, false));
  }
  return out;
}

export interface LowPolyMaterials { fur: THREE.MeshStandardMaterial; hard: THREE.MeshStandardMaterial; eye: THREE.MeshPhysicalMaterial }

/** Flat-shaded body / hard-part / eye materials — three per species, shared by every instance (the body is cloned per animal for its tint). */
export function lowPolyMaterials(): LowPolyMaterials {
  const fur = new THREE.MeshStandardMaterial({ flatShading: true, vertexColors: true, roughness: 0.85, metalness: 0, color: new THREE.Color(1, 1, 1), envMapIntensity: 0.7 });
  const hard = new THREE.MeshStandardMaterial({ flatShading: true, vertexColors: true, roughness: 0.7, metalness: 0, color: new THREE.Color(1, 1, 1), envMapIntensity: 0.5 });   // matte: glossy hoof tops mirrored the sky as gold bands
  const eye = new THREE.MeshPhysicalMaterial({ roughness: 0.25, metalness: 0, vertexColors: true, color: new THREE.Color(1, 1, 1), clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.5 });
  return { fur, hard, eye };
}

/**
 * One draw per creature (remaster M3): fold the fur / hard / eye material groups into a single group 0, so a rig is ONE
 * draw (+ its shadow) instead of three — the island's ~35 animals were ~105 main-pass draws. The hard parts and the eyes
 * keep their painted vertex colours; eyes that glow (the drowned sailor's) keep the glow through an `aGlow` vertex
 * attribute read by `patchEyeGlow`. Returns true when the model has glowing eye faces.
 */
export function oneMaterial(geo: THREE.BufferGeometry, glowGroup: number | null): boolean {
  const n = geo.getAttribute('position').count;
  let any = false;
  if (glowGroup !== null) {
    const glow = new Float32Array(n);
    for (const gr of geo.groups) if (gr.materialIndex === glowGroup) for (let v = gr.start; v < Math.min(n, gr.start + gr.count); v++) { glow[v] = 1; any = true; }
    if (any) geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  }
  geo.clearGroups();
  geo.addGroup(0, n, 0);
  return any;
}

/**
 * The body material's eye glow: `totalEmissiveRadiance += colour × aGlow`, a uniform of its own, so the melee hit flash
 * (Animal.hitFlash drives `emissive`) and the glow add up. Call BEFORE `sky.setupMaterial` (which wraps this hook), and
 * again on every clone (Material.clone drops onBeforeCompile).
 */
export function patchEyeGlow(m: THREE.MeshStandardMaterial, color: THREE.Color, intensity: number): void {
  const uEyeGlow = { value: color.clone().multiplyScalar(intensity) };
  patchShader(m, 'engine.eye-glow', PATCH_ORDER.material, (sh) => {
    sh.uniforms['uEyeGlow'] = uEyeGlow;
    attachFogUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vEyeGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEyeGlow;\nvarying float vEyeGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uEyeGlow * vEyeGlow;');
  }, { mode: 'replace', key: 'lowpoly-eyeglow' });
}
