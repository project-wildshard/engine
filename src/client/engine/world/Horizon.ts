import * as THREE from 'three';
import { CHUNK_DEPTH } from '../../../shared/engine/core/config';
import { Noise2D } from '../../../shared/engine/core/noise';
import { attachFogUniforms, fogUniforms } from './Atmosphere';
import { PaintedHorizon, levelHorizonStrips } from './HorizonMatte';
import type { SkyRig as Sky } from './skyRig';
import { activeLevel } from '../../../shared/engine/level/selection';
import type { HorizonSpec } from '../../../shared/engine/level/data';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';

/**
 * The far light, shared by every ring and the cloud sea: the fixed skies keep these values; Pine Hollow's day / night clock
 * (PineDayNight.ts) turns them with the hour (uniform objects, so no program changes).
 */
export const horizonLight: { uHazeCol: { value: THREE.Color; }; uSeaSky: { value: THREE.Color; }; uSeaSun: { value: THREE.Color; }; uSeaSunDir: { value: THREE.Vector3; }; } = {
  uHazeCol: { value: new THREE.Color(0.5, 0.58, 0.74) },
  uSeaSky: { value: new THREE.Color(0.55, 0.62, 0.75) },
  uSeaSun: { value: new THREE.Color(1.0, 0.75, 0.45) },
  uSeaSunDir: { value: new THREE.Vector3(0, 1, 0) },
};

/**
 * What a level declares beyond its chunk, moving with the camera on XZ so it never parallaxes wrong up close: its own
 * compass-banded ridge rings and, when it asks, a sea of clouds far below the slab (`LevelSpec.horizon`), or a painted
 * strip at infinity (`horizonStrips`, a dry world). A level that declares neither draws nothing out there (G552, Jake
 * 2026-10-21: the engine's default ridge rings at 1.5 / 2.6 / 4.2 km and its cloud sea stood inside the 5x5 grid and
 * crossed its outer cells); an open-water world's sea runs to the horizon (its painted band is `HorizonMatte`).
 */
export class Horizon {
  group: THREE.Group = new THREE.Group();
  /** Pine Hollow's painted horizon (PH-L5), in place of the rings and the cloud sea */
  painted: PaintedHorizon | null = null;
  private cloudSea!: THREE.Mesh;
  private cloudU = { uTime: { value: 0 } };

  private sky: Pick<Sky, 'setupMaterial' | 'sunDir' | 'night'>;
  constructor(sky: Pick<Sky, 'setupMaterial' | 'sunDir' | 'night'>) {
    this.sky = sky;
  }

  /** `level`: the spec the world boots (a grid cell's yields its own horizon, G99); omitted = the selected level */
  build(level: LevelSpec = activeLevel()): this {
    const own = level.horizon;
    if (own) { // a level's own compass-banded ranges (its manifest's `horizon` data)
      this.buildBands(own, level.sky.painted);
      if (own.cloudSea) this.buildCloudSea();
      return this;
    }
    const ocean = (level.ground.water ?? []).some((body) => body.id === 'sea'); // an open-water level (its registered sea)
    // Pine Hollow (PH-L5): the photoreal painting at infinity (from the lookout a flat white cloud sheet read as paper);
    // the slab's edge thickens into the painting's haze (Atmosphere fogEdge). On open water the strips are HorizonMatte's.
    const strips = ocean ? null : levelHorizonStrips(level);
    if (strips) {
      const painted = new PaintedHorizon(strips).build();
      if (painted.mesh) this.group.add(painted.mesh);
      this.painted = painted;
      fogUniforms.fogEdge.value.x = 0.4; // aerial perspective on the slab's last metres and cliffs, not a white-out
      // its paintings are level content: the composition root loads them with the level (DL17), never after boot
    }
    return this;
  }

  /**
   * `ShardManifest.horizon` (Nalati): each ring's height profile is shaped by compass bands — the snow range big and white
   * across the south, the plateau rolling on as low green hills at slab height, the valley opening flat to the west,
   * a gorge in the east — instead of one noise profile the same all the way round. A ring is a three-row strip
   * (hidden foot · a shoulder at 55 % · the ridge line) with a colour ramp foot → `color` → `top`, snow above
   * `snowLine` of the ring's tallest point, and an aerial-perspective haze into the sky's horizon colour.
   * One draw call per ring, one shared program.
   */
  private buildBands(H: HorizonSpec, P: LevelSpec['sky']['painted']) {
    const noise = new Noise2D(4242);
    const r2d = 180 / Math.PI;
    H.rings.forEach((ring, ri) => {
      const seg = ring.r > 1800 ? 960 : 540; // the snow ranges get ~15 m columns: jagged crests, not cones
      const profile: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const cx = Math.cos(a), sz = Math.sin(a);
        const az = ((Math.atan2(-cx, sz) * r2d) + 360) % 360; // compass bearing of this point (0 = +Z north, 90 = −X east)
        // ridged multifractal round the circle (peaks) and a smooth roll (hills)
        // base frequency grows with the radius so a peak is ~1 km across at any ring (mountains, not spikes)
        let rid = 0, amp = 1, f = 1.3 + ring.r / 1300, norm = 0;
        for (let o = 0; o < 6; o++) { const nv = 1 - Math.abs(noise.get(cx * f + ri * 9.1, sz * f + ri * 3.7)); rid += nv * nv * amp; norm += amp; amp *= 0.5; f *= 2.05; }
        rid /= norm;
        const roll = 0.62 + 0.26 * noise.get(cx * 3.1 + ri * 5, sz * 3.1) + 0.14 * noise.get(cx * 11 + ri, sz * 11) + 0.05 * noise.get(cx * 37, sz * 37 + ri);
        let h = 0;
        for (const b of ring.bands) {
          let dAz = Math.abs(az - b.azimuth) % 360; if (dAz > 180) dAz = 360 - dAz;
          if (dAz >= b.spread) continue;
          const w = Math.cos((dAz / b.spread) * Math.PI * 0.5) ** 2;
          h = Math.max(h, b.height * w * (roll * (1 - b.rough) + (0.5 + rid * 0.7) * b.rough));
        }
        profile.push(h);
      }
      const maxH = Math.max(1, ...profile);
      const pos: number[] = [], col: number[] = [], nrm: number[] = [], idx: number[] = [];
      const foot = new THREE.Color(...ring.color).multiplyScalar(0.85), body = new THREE.Color(...ring.color), top = new THREE.Color(...ring.top);
      const snowC = new THREE.Color(0.9, 0.93, 1.0), c = new THREE.Color();
      // rows up each column (fraction of the column's height): a hidden foot, then a sloped face stepping toward the
      // camera as it drops, so the ring reads as hills / mountains and not a wall; snow by absolute height → crisp caps
      const ROWS = [0.3, 0.55, 0.75, 0.9, 1];
      const per = ROWS.length + 1;
      const snowY0 = ring.base + maxH * ring.snowLine;
      const segLen = (2 * Math.PI * ring.r) / seg;
      const smooth = (k: number): number => { let v = 0; for (let d = -1; d <= 1; d++) v += profile[(k + d + seg) % seg] ?? 0; return v / 3; };
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const cx = Math.cos(a), sz = Math.sin(a);
        const h = profile[i] ?? 0;
        // the face's lean along the ridge (its real slope): each peak gets a sunlit flank and a blue shaded one
        const tilt = Math.max(-1.6, Math.min(1.6, ((smooth(i - 1) - smooth(i + 1)) / (2 * segLen)) * (ring.snowLine > 1 ? 0.35 : 0.9)));
        // the snow line rises and falls along the range: snowfields down the couloirs, bare rock on the ribs
        const snowY = snowY0 + maxH * (noise.get(cx * 14 + ri * 3, sz * 14) * 0.1 + noise.get(cx * 47, sz * 47 + ri) * 0.05);
        const nx = -cx + sz * tilt, nz = -sz - cx * tilt;
        const kf = 1 - (h * 1.2 + 80) / ring.r;
        pos.push(cx * ring.r * kf, ring.floor - 600, sz * ring.r * kf); nrm.push(nx, 0.5, nz);
        c.copy(foot); col.push(c.r, c.g, c.b);
        for (const t of ROWS) {
          const y = ring.base + h * t, k = 1 - ((1 - t) * h * 1.1) / ring.r;
          pos.push(cx * ring.r * k, y, sz * ring.r * k);
          nrm.push(nx * (1.1 - t * 0.6), 0.7 + t * 1.3, nz * (1.1 - t * 0.6)); // tipping up toward the crest: the tops catch the sun
          c.copy(body).lerp(top, t * t);
          c.lerp(snowC, THREE.MathUtils.smoothstep(y, snowY - 6, snowY + 18) * (0.8 + 0.2 * t));
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < seg; i++) {
        for (let r = 0; r < per - 1; r++) { const a = i * per + r, b = a + per; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      // the haze is the sky's own horizon colour (`ChunkSky.painted`), so the far range dissolves into that sky
      const mesh = new THREE.Mesh(geo, this.ridgeMaterial(ri, ring.haze, P ? new THREE.Color(...P.horizon) : new THREE.Color(0.5, 0.58, 0.74)));
      mesh.frustumCulled = false;
      this.group.add(mesh);
    });
  }

  /** the ridge rings' material: Lambert + vertex colour, fogged, then dissolved into a cool haze (warmer toward the sun) */
  private ridgeMaterial(ri: number, haze: number, hazeColor: THREE.Color): THREE.MeshLambertMaterial {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    patchShader(mat, 'engine.horizon-ridge-painted', PATCH_ORDER.material, (shader) => {
      attachFogUniforms(shader);
      shader.uniforms['uHaze'] = { value: haze }; // per ring as a uniform, so the rings share one program
      shader.uniforms['uHazeCol'] = { value: hazeColor };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uHaze;\nuniform vec3 uHazeCol;')
        .replace('#include <fog_fragment>', `
          {
            vec3 ray = normalize(vFogWorldPos - cameraPosition);
            float sunAmt = max(dot(ray, fogSunDir), 0.0);
            // the live fog colour (the day/night clock and the storms drive it), so the ranges dim and redden with the sky
            vec3 hazeCol = mix(mix(uHazeCol, fogColor, 0.85), fogSunColor * 0.9, pow(sunAmt, 3.0) * 0.7);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, uHaze);
            // the hills rise out of the cloud sea: their feet wrap in cloud, so from any height (a lookout, the rim, a
            // hoverboard) the ring reads as land over clouds, not a green curtain hanging down to nothing
            float wrap = smoothstep(-45.0, -190.0, vFogWorldPos.y);
            vec3 cloudCol = mix(vec3(0.82, 0.83, 0.88), fogSunColor, 0.2 + 0.3 * sunAmt) * mix(1.0, 0.8, smoothstep(-190.0, -260.0, vFogWorldPos.y));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, cloudCol, wrap * 0.92);
          }`);
    }, { mode: 'replace', key: 'ridge-painted' });
    mat.name = `ridge${ri}`;
    this.sky.setupMaterial(mat);
    return mat;
  }

  private buildCloudSea() {
    const size = 12000;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const tex = cloudNoise();
    horizonLight.uSeaSunDir.value.copy(this.sky.sunDir);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.cloudU, tNoise: { value: tex }, uSun: horizonLight.uSeaSunDir, uSunColor: horizonLight.uSeaSun, uSky: horizonLight.uSeaSky },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vW;
        void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tNoise; uniform float uTime; uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSky;
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz * 0.00035 + vec2(uTime * 0.0006, uTime * 0.0003);
          float a = texture2D(tNoise, p).r;
          float b = texture2D(tNoise, p * 3.7 + 0.3).r;
          float c = texture2D(tNoise, p * 11.0 - 0.2).r;
          float d = a * 0.6 + b * 0.28 + c * 0.12;
          float cover = smoothstep(0.42, 0.7, d);
          // fake lighting: sun-facing slopes of the noise field catch the low sun
          float dx = texture2D(tNoise, p + vec2(0.004, 0.0)).r - a;
          float lit = clamp(0.5 + dx * 40.0 * uSun.x, 0.0, 1.0);
          vec3 col = mix(uSky * 0.8, mix(vec3(0.72, 0.74, 0.8), uSunColor * 1.2, lit), cover);
          float dist = length(vW.xz - cameraPosition.xz);
          float fade = smoothstep(9000.0, 2000.0, dist);
          gl_FragColor = vec4(col, (0.55 + 0.45 * cover) * fade);
        }`,
    });
    this.cloudSea = new THREE.Mesh(geo, mat);
    this.cloudSea.position.y = -CHUNK_DEPTH - 140;
    this.cloudSea.frustumCulled = false;
    this.cloudSea.renderOrder = -5;
    this.cloudSea.name = 'cloud-sea'; // a level's look may restyle it (found by this name)
    this.group.add(this.cloudSea);
  }

  update(dt: number, camera: THREE.Camera): void {
    const fog = (this.group.parent as THREE.Scene | null)?.fog;
    if (this.painted && fog instanceof THREE.Fog) this.painted.update(dt, fog.color, this.sky.night, horizonLight.uHazeCol.value, horizonLight.uSeaSun.value);
    this.cloudU.uTime.value += dt;
    this.group.position.x = camera.position.x;
    this.group.position.z = camera.position.z;
  }
}

function cloudNoise() {
  const N = 256;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  if (!g) throw new Error('[horizon] no 2d canvas context');
  const img = g.createImageData(N, N);
  const n = new Noise2D(31);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // tileable by sampling on a torus
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    const px = Math.cos(u) * 2, py = Math.sin(u) * 2, pz = Math.cos(v) * 2, pw = Math.sin(v) * 2;
    let s = 0, amp = 0.5;
    for (let o = 0; o < 4; o++) { s += (n.get(px * 2 ** o + pz * 1.3 * 2 ** o, py * 2 ** o + pw * 0.7 * 2 ** o) * 0.5 + 0.5) * amp; amp *= 0.5; }
    const i = (y * N + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = s * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
