import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHUNK_HALF, CHUNK_DEPTH, ROAD_WIDTH } from '../../../shared/engine/core/config';
import { heightAt as terrainHeightAt, waterLevel, pondMask, streamAt } from '../../../shared/engine/world/Heightfield';
import { app } from '../app/runtime';
import type { SkyRig as Sky } from './skyRig';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { TIER_CONFIG } from '../core/tier';

/**
 * The chunk boundary as the Wildshard staging server draws it: cyan light-lines along the
 * four surface edges, the eight corner beacons (which the author plants before uploading),
 * the vertical corner beams down to the slab bottom, and a translucent "no-man's land" gate
 * across each entry road. Purely additive/emissive geometry — no lighting needed.
 * Over an open-water level everything sits on the sea surface instead of the sea floor.
 */
/** the ground, or the water over it: the sea on an open-water level, else the pond inside its basin or running water (a
 *  creek's notch in the slab's edge: the line dips into it with the water, not ~6 m over it at the pond's level, PH-L9) */
function heightAt(x: number, z: number): number {
  const ground = terrainHeightAt(x, z);
  const sea = app.world.water.sea; // the level's open sea, registered at level.data (LevelSpec.ground.water)
  if (sea !== null) return Math.max(ground, sea.level);
  const water = pondMask(x, z) > 0 ? waterLevel() : streamAt(x, z);
  return water === null ? ground : Math.max(ground, water);
}
interface BeaconMats { pole: THREE.Material; head: THREE.Material; beam: THREE.Material }
/** the level's edge: cyan light-lines, corner beacons and beams, and a gate across each entry road */
export class Boundary {
  group: THREE.Group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private beaconLights: THREE.PointLight[] = [];

  private sky: Pick<Sky, 'setupMaterial'>;
  private spec?: LevelSpec['boundary'];
  constructor(sky: Pick<Sky, 'setupMaterial'>, spec?: LevelSpec['boundary']) {
    this.sky = sky;
    this.spec = spec;
  }

  build(): this {
    // Drawing only: the physics edge walls are registered independently.
    if (this.spec?.visible === false) return this;
    const H = CHUNK_HALF;
    // ---- surface edge lines (follow the terrain)
    const segs = 200;
    const pts: number[] = [];
    const corners: [number, number][] = [[-H, -H], [H, -H], [H, H], [-H, H]];
    for (let s = 0; s < 4; s++) {
      const a = corners[s], b = corners[(s + 1) % 4];
      if (a === undefined || b === undefined) continue;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0;
        const x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1;
        pts.push(x0, heightAt(x0, z0) + 0.35, z0, x1, heightAt(x1, z1) + 0.35, z1);
      }
    }
    // vertical corner beams
    for (const [x, z] of corners) {
      const top = heightAt(x, z) + 0.35;
      pts.push(x, top, z, x, -CHUNK_DEPTH, z);
      pts.push(x, top, z, x, top + 60, z);
    }
    // bottom rectangle
    for (let s = 0; s < 4; s++) {
      const a = corners[s], b = corners[(s + 1) % 4];
      if (a === undefined || b === undefined) continue;
      pts.push(a[0], -CHUNK_DEPTH, a[1], b[0], -CHUNK_DEPTH, b[1]);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.35, 0.95, 1.2), transparent: true, opacity: 0.85, fog: false, toneMapped: false });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    this.group.add(lines);

    // ---- glowing ribbon walls along the edges (soft, fades with height) — the "you are leaving the chunk" veil
    const ribbonMat = this.veilMaterial();
    const ribbons: THREE.BufferGeometry[] = [];
    for (let s = 0; s < 4; s++) {
      const a = corners[s], b = corners[(s + 1) % 4];
      if (a === undefined || b === undefined) continue;
      const geo = new THREE.PlaneGeometry(1, 1, segs, 1);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getX(i) + 0.5, up = pos.getY(i) + 0.5;
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const g = heightAt(x, z);
        pos.setXYZ(i, x, g + up * 14, z);
      }
      geo.computeVertexNormals();
      ribbons.push(geo);
    }
    // one draw call for the four ribbons (they were 4 never-culled meshes)
    const ribbon = new THREE.Mesh(mergeGeometries(ribbons, false), ribbonMat);
    ribbon.frustumCulled = false;
    this.group.add(ribbon);

    // ---- corner + edge-midpoint beacons (the 8 flags planted before upload) and the centre beacon
    const off = ROAD_WIDTH / 2 + 4;
    const beaconPts: [number, number][] = [...corners, [-off, -H], [H, -off], [off, H], [-H, off]];
    for (const [x, z] of beaconPts) this.group.add(this.beacon(x, z, heightAt(x, z)));
    this.mergeBeacons();

    // ---- road gates: translucent cyan portal across each entry road at the boundary
    const gateMat = this.gateMaterial();
    const gates: { x: number; z: number; rot: number }[] = [
      { x: 0, z: -H, rot: 0 }, { x: 0, z: H, rot: 0 }, { x: -H, z: 0, rot: Math.PI / 2 }, { x: H, z: 0, rot: Math.PI / 2 },
    ];
    // the four gates and their eight posts: one mesh each (one material, one draw call)
    const gateGeos: THREE.BufferGeometry[] = [], postGeos: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    for (const g of gates) {
      gateGeos.push(new THREE.PlaneGeometry(ROAD_WIDTH + 2, 7).applyMatrix4(m.makeRotationY(g.rot).setPosition(g.x, heightAt(g.x, g.z) + 3.5, g.z)));
      for (const side of [-1, 1]) {
        const px = g.x + Math.cos(g.rot) * side * (ROAD_WIDTH / 2 + 1), pz = g.z - Math.sin(g.rot) * side * (ROAD_WIDTH / 2 + 1);
        postGeos.push(new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8).translate(px, heightAt(px, pz) + 3.6, pz));
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(gateGeos, false), gateMat));
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.5, metalness: 0.8, emissive: new THREE.Color(0.1, 0.5, 0.7), emissiveIntensity: 0.6 });
    this.sky.setupMaterial(postMat);
    this.group.add(new THREE.Mesh(mergeGeometries(postGeos, false), postMat));
    return this;
  }

  private beaconParts: { pole: THREE.BufferGeometry[]; head: THREE.BufferGeometry[]; beam: THREE.BufferGeometry[] } = { pole: [], head: [], beam: [] };
  private beaconMats: BeaconMats | undefined;

  /** the 9 beacons' poles, heads and beams as three meshes instead of 27 (halos stay sprites, lights stay lights) */
  private mergeBeacons() {
    const P = this.beaconParts, M = this.beaconMaterials();
    const pole = new THREE.Mesh(mergeGeometries(P.pole, false), M.pole); pole.castShadow = true;
    const head = new THREE.Mesh(mergeGeometries(P.head, false), M.head);
    const beam = new THREE.Mesh(mergeGeometries(P.beam, false), M.beam);
    this.group.add(pole, head, beam);
  }

  private beaconMaterials(): BeaconMats {
    if (this.beaconMats === undefined) {
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1d232b, roughness: 0.45, metalness: 0.85 });
      this.sky.setupMaterial(poleMat);
      this.beaconMats = {
        pole: poleMat,
        head: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.4, 1.8), toneMapped: false, fog: false }),
        // additive + no depth write: back / front order cannot matter, so one pass instead of three's two for a transparent DoubleSide
        beam: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 1.0), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false }),
      };
    }
    return this.beaconMats;
  }

  private beacon(x: number, z: number, y: number) {
    const g = new THREE.Group();
    // geometry goes to the merged beacon meshes (world space); only the halo sprite (and light) live in this group
    this.beaconParts.pole.push(new THREE.CylinderGeometry(0.06, 0.09, 2.6, 8).translate(x, y + 1.3, z));
    this.beaconParts.head.push(new THREE.OctahedronGeometry(0.28, 0).translate(x, y + 2.85, z));
    this.beaconParts.beam.push(new THREE.CylinderGeometry(0.08, 0.02, 40, 8, 1, true).translate(x, y + 2.85 + 20, z));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: new THREE.Color(0.4, 0.9, 1.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8 }));
    halo.scale.set(2.2, 2.2, 1); halo.position.y = 2.85;
    g.add(halo);
    if (TIER_CONFIG.beaconLights) {
      // 8 more point lights in every lit shader: desktop only (the phone tier runs 4 shared cabin lights)
      const light = new THREE.PointLight(new THREE.Color(0.4, 0.9, 1.0), 6, 12, 2);
      light.position.y = 2.85;
      this.beaconLights.push(light);
      g.add(light);
    }
    g.position.set(x, y, z);
    return g;
  }

  private veilMaterial() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv; varying vec3 vW;
        void main() {
          float h = vUv.y;
          float grid = max(smoothstep(0.96, 1.0, fract(vW.x * 0.1)) + smoothstep(0.04, 0.0, fract(vW.x * 0.1)),
                           smoothstep(0.96, 1.0, fract(vW.z * 0.1)) + smoothstep(0.04, 0.0, fract(vW.z * 0.1)));
          float hgrid = smoothstep(0.96, 1.0, fract(vW.y * 0.5)) + smoothstep(0.04, 0.0, fract(vW.y * 0.5));
          float scan = 0.5 + 0.5 * sin(vW.y * 6.0 - uTime * 2.0);
          float a = (1.0 - h) * (1.0 - h) * 0.05 + max(grid, hgrid) * (1.0 - h) * 0.16 * (0.6 + 0.4 * scan);
          vec3 col = vec3(0.35, 0.85, 1.0);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mats.push(mat);
    return mat;
  }

  private gateMaterial() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float edge = smoothstep(0.5, 0.42, abs(p.x)) * smoothstep(0.5, 0.42, abs(p.y));
          float hex = abs(sin(vUv.x * 60.0 + sin(vUv.y * 40.0 + uTime))) * 0.5;
          float ring = smoothstep(0.02, 0.0, abs(fract(vUv.y * 4.0 - uTime * 0.3) - 0.5) - 0.45);
          float a = (0.06 + hex * 0.05 + ring * 0.12) * (1.0 - edge * 0.5) + (1.0 - edge) * 0.35;
          gl_FragColor = vec4(vec3(0.4, 0.9, 1.0) * a, a);
        }`,
    });
    this.mats.push(mat);
    return mat;
  }

  update(_dt: number, t: number): void {
    for (const m of this.mats) { const u = m.uniforms['uTime']; if (u !== undefined) u.value = t; }
    for (let i = 0; i < this.beaconLights.length; i++) { const light = this.beaconLights[i]; if (light !== undefined) light.intensity = 5 + Math.sin(t * 2.2 + i) * 1.5; }
  }
}

let _halo: THREE.Texture | null = null;
function haloTexture() {
  if (_halo) return _halo;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g === null) throw new Error('Boundary: no 2d canvas context');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.2, 'rgba(180,240,255,0.7)'); grad.addColorStop(1, 'rgba(0,120,200,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  _halo = new THREE.CanvasTexture(c);
  return _halo;
}
