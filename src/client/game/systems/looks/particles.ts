import { fogGLSL } from './fogProgram';
import * as THREE from 'three';
import { app } from '@wildshard/engine/app/runtime';
import { SEED } from '@wildshard/engine/core/config';
import { smoothstep } from '@wildshard/engine/core/noise';
import { Rng } from '@wildshard/engine/core/rng';
import { activeLevel } from '@wildshard/engine/level/selection';
import { attachFogUniforms } from '@wildshard/engine/world/Atmosphere';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import { POND, waterLevel } from '@wildshard/engine/world/Heightfield';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';

/**
 * Atmosphere particles: sun-lit dust motes, drifting ground mist and falling pine needles.
 *
 *   const particles = new Particles(sky, forest).build();
 *   scene.add(particles.group);
 *   game.onUpdate((dt) => particles.update(dt, player.position, game.camera));
 *
 *  - motes:   THREE.Points (1500) wrapped in a 24 m box around the camera (mod-wrapped in the vertex
 *             shader → world-static positions, zero CPU), soft round additive sprites, slow drift,
 *             sparkle + edge fade. Fog dims them. At night (PH-L3) one mote in eight near the pond is a
 *             firefly: bigger, warm green, blinking on its own slow beat — the same Points, no draw added.
 *  - mist:    72 large soft billboards (procedural noise-blob texture) parked in the lowest terrain
 *             around the central hollow and over the pond, drifting and slowly turning, depthWrite
 *             off, fading near the camera and when looked at from above so they never read as flat
 *             cards. Tinted towards the fog's sun colour (warm at the sunset HDRI), warmer still when
 *             seen against the sun.
 *  - needles: 200 tumbling pine-needle quads dropping from the crowns of trees within 28 m of the
 *             player (respawn set is rebuilt from `forest.trees` whenever the player moves 8 m).
 * All three are unlit ShaderMaterials with the global exponential height fog applied by hand
 * (same formula as Atmosphere.ts) so they melt into the haze.
 *
 * Public: `group`, `motes`, `mist`, `needles`, `update(dt, playerPos, camera)`, `params`.
 */

const MOTE_COUNT = 1500, MOTE_RANGE = 12;    // half-extent of the wrap box (m)
const MIST_COUNT = 72;
const NEEDLE_COUNT = 200;


export class Particles {
  group: THREE.Group = new THREE.Group();
  motes!: THREE.Points;
  mist!: THREE.InstancedMesh;
  needles!: THREE.InstancedMesh;
  params = { moteIntensity: 1.0, mistOpacity: 1.0 };

  private uTime = { value: 0 };
  private uSunDir = { value: new THREE.Vector3(0, 1, 0) };
  private uSunColor = { value: new THREE.Color(1, 0.9, 0.7) };
  /** the clock's night (0 day … 1 night) and the pond (x, z, radius): where the fireflies are */
  private uNight = { value: 0 };
  private uPond = { value: new THREE.Vector3(POND.x, POND.z, POND.r) };
  private uMote = { value: 1.0 };
  private uMist = { value: 1.0 };
  /** the look loop's daytime mist (ChunkLook.dayMist, PH-L1; 1 without a look layer): × the mist while the sun stands high */
  private dayMist = (() => { const level = activeLevel(); return app.gradeFor({ grade: level.grade, ...(level.lookLayer === undefined ? {} : { look: level.lookLayer }) }).look?.dayMist ?? 1; })();
  private needleOrigin!: THREE.InstancedBufferAttribute;
  private needleInfo!: THREE.InstancedBufferAttribute;
  private lastNeedlePos = new THREE.Vector3(1e9, 0, 0);
  private needleRng = new Rng(SEED + 909);

  constructor(private sky: Sky, private forest: Forest) {}

  /** the key light's intensity at build: the motes / mist / needles follow the live key (a day/night clock) relative to it */
  private baseKeyI = 1;

  build(): this {
    // the sky's own vectors: Pine Hollow's day / night clock moves them in place (the fixed sky never does)
    this.uSunDir.value = this.sky.sunDir;
    this.uSunColor.value = this.sky.sunColor;
    this.baseKeyI = Math.max(1e-3, this.sky.csm.lights[0]?.intensity ?? 1);
    this.motes = this.buildMotes();
    this.mist = this.buildMist();
    this.needles = this.buildNeedles();
    this.group.add(this.motes, this.mist, this.needles);
    return this;
  }

  update(dt: number, playerPos: THREE.Vector3, _camera: THREE.Camera): void {
    this.uTime.value += dt;
    // follow the key light (the day/night clock moves / recolours / dims it — sun → moon): the dust glints warm by day,
    // cold and faint by moonlight. A fixed-sun shard never changes it, so its motes stay exactly as they were.
    this.uSunDir.value.copy(this.sky.sunDir);
    this.uSunColor.value.copy(this.sky.sunColor).multiplyScalar((this.sky.csm.lights[0]?.intensity ?? this.baseKeyI) / this.baseKeyI);
    this.uMote.value = this.params.moteIntensity;
    this.uNight.value = this.sky.night;
    const lowSun = this.sky.dayNight?.dusk ?? 1; // 1 at dawn / dusk / night (and on a fixed sky), 0 under a high sun
    this.uMist.value = this.params.mistOpacity * (this.dayMist + (1 - this.dayMist) * lowSun);
    if (playerPos.distanceToSquared(this.lastNeedlePos) > 8 * 8) {
      this.lastNeedlePos.copy(playerPos);
      this.respawnNeedles(playerPos);
    }
  }

  private baseUniforms() {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]) as Record<string, THREE.IUniform>;
    attachFogUniforms({ uniforms: u });
    u['uTime'] = this.uTime; u['uSunDir'] = this.uSunDir; u['uSunColor'] = this.uSunColor;
    return u;
  }

  // ------------------------------------------------------------------ motes
  private buildMotes() {
    const rng = new Rng(SEED + 901);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MOTE_COUNT * 3), seed = new Float32Array(MOTE_COUNT * 4);
    for (let i = 0; i < MOTE_COUNT; i++) {
      pos[i * 3] = rng.next(); pos[i * 3 + 1] = rng.next(); pos[i * 3 + 2] = rng.next();
      seed[i * 4] = rng.next(); seed[i * 4 + 1] = rng.next(); seed[i * 4 + 2] = rng.next(); seed[i * 4 + 3] = rng.range(0.5, 1.5);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const u = this.baseUniforms();
    u['uRange'] = { value: MOTE_RANGE }; u['uIntensity'] = this.uMote; u['uPixelScale'] = { value: 900 * 0.5 };
    u['uSprite'] = { value: makeMoteSprite() };
    u['uNight'] = this.uNight; u['uPond'] = this.uPond;
    const mat = new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: true,
      vertexShader: /* glsl */`
        attribute vec4 seed;
        uniform float uTime; uniform float uRange; uniform float uPixelScale; uniform float uNight; uniform vec3 uPond;
        varying float vAlpha; varying vec3 vWorld; varying float vFly;
        void main() {
          float R = uRange;
          // world-space anchored: slow drift + a little bob, then wrapped into the box around the camera
          vec3 p = position * 2.0 * R;
          p += vec3( 0.12, 0.015, 0.07 ) * uTime * seed.w;
          p += vec3( sin( uTime * 0.31 * seed.w + seed.x * 6.283 ), sin( uTime * 0.23 * seed.w + seed.y * 6.283 ) * 0.5, cos( uTime * 0.27 * seed.w + seed.z * 6.283 ) ) * 0.45;
          vec3 c = cameraPosition + vec3( 0.0, 0.6, 0.0 );
          vec3 w = mod( p - c + R, 2.0 * R ) - R + c;
          vWorld = w;
          vec4 mv = viewMatrix * vec4( w, 1.0 );
          float dist = length( mv.xyz );
          // sparkle + fade at the box edges and very near the camera
          float twinkle = 0.35 + 0.65 * pow( sin( uTime * ( 1.2 + seed.w ) + seed.x * 40.0 ) * 0.5 + 0.5, 3.0 );
          float edge = 1.0 - smoothstep( R * 0.6, R * 0.95, max( max( abs( w.x - c.x ), abs( w.y - c.y ) ), abs( w.z - c.z ) ) );
          float near = smoothstep( 0.25, 1.2, dist );
          // a firefly (PH-L3): at night one mote in three leaves the dust box for a wider, low one — 25 m around the eye, from
          // the ground to head height (the eye is ~1.7 m up) — and glows there if it is within 18 m of the pond's shore
          float cand = step( seed.x, 0.33 ) * step( 0.001, uNight ) * step( 0.5, uPond.z );
          float fly = 0.0;
          if ( cand > 0.5 ) {
            float RF = 25.0;
            vec3 q = vec3( position.x, 0.0, position.z ) * 2.0 * RF + vec3( sin( uTime * 0.21 * seed.w + seed.y * 6.283 ), 0.0, cos( uTime * 0.17 * seed.w + seed.z * 6.283 ) ) * 1.5;
            vec3 f3 = vec3( mod( q.x - cameraPosition.x + RF, 2.0 * RF ) - RF + cameraPosition.x, cameraPosition.y - 1.6 + seed.y * 2.4 + sin( uTime * 0.6 + seed.x * 40.0 ) * 0.25, mod( q.z - cameraPosition.z + RF, 2.0 * RF ) - RF + cameraPosition.z );
            float pondD = length( f3.xz - uPond.xy );
            fly = uNight * ( 1.0 - smoothstep( uPond.z + 6.0, uPond.z + 18.0, pondD ) );
            w = f3; vWorld = w;
            mv = viewMatrix * vec4( w, 1.0 );
            dist = length( mv.xyz );
            edge = 1.0 - smoothstep( RF * 0.7, RF * 0.98, max( abs( w.x - cameraPosition.x ), abs( w.z - cameraPosition.z ) ) );
          }
          float blink = smoothstep( 0.3, 0.85, sin( uTime * ( 0.7 + seed.y * 0.9 ) + seed.z * 31.0 ) );
          vFly = fly;
          // dust only reads in sunlight: it fades out through dusk (in moonlight, additive motes bloomed into cyan orbs indoors)
          float dustLit = 1.0 - smoothstep( 0.2, 0.7, uNight );
          vAlpha = mix( twinkle * edge * near * ( 1.0 - cand ) * dustLit, blink * edge * smoothstep( 0.3, 0.8, dist ), fly );
          gl_PointSize = mix( clamp( ( 1.0 + seed.z * 1.6 ) * uPixelScale / dist, 1.0, 8.0 ), clamp( ( 2.0 + seed.z * 2.0 ) * uPixelScale / dist, 4.0, 26.0 ), fly );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        ${fogGLSL}
        uniform sampler2D uSprite; uniform float uIntensity; uniform vec3 uSunColor;
        varying float vAlpha; varying vec3 vWorld; varying float vFly;
        void main() {
          float a = texture2D( uSprite, gl_PointCoord ).a * vAlpha * uIntensity;
          float f = atmosFogFactor( vWorld );
          // dust reads best backlit: brighter when looking towards the sun
          float back = pow( max( dot( normalize( vWorld - cameraPosition ), fogSunDir ), 0.0 ), 3.0 );
          vec3 col = uSunColor * vec3( 1.0, 0.92, 0.72 ) * ( 0.22 + back * 0.6 );
          col = mix( col, vec3( 1.6, 2.2, 0.55 ), vFly );   // a firefly's own cold-green glow, bright enough to bloom
          gl_FragColor = vec4( col * a * ( 1.0 - f * ( 1.0 - 0.6 * vFly ) ), a );
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    return pts;
  }

  // ------------------------------------------------------------------ mist
  private buildMist() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const spots = pickMistSpots();
    const mesh = new THREE.InstancedMesh(geo, this.mistMaterial(), spots.length);
    const seed = new Float32Array(spots.length * 4);
    const m = new THREE.Matrix4();
    const rng = new Rng(SEED + 902);
    spots.forEach((s, i) => {
      const w = rng.range(16, 28), h = w * rng.range(0.28, 0.4);
      m.makeScale(w, h, 1); m.setPosition(s.x, s.y + h * 0.3, s.z);
      mesh.setMatrixAt(i, m);
      seed[i * 4] = rng.next(); seed[i * 4 + 1] = rng.range(-1, 1); seed[i * 4 + 2] = rng.range(0.6, 1.4); seed[i * 4 + 3] = rng.range(0.7, 1.2);
    });
    geo.setAttribute('mistSeed', new THREE.InstancedBufferAttribute(seed, 4));
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return mesh;
  }

  private mistMaterial() {
    const u = this.baseUniforms();
    u['uTex'] = { value: makeMistTexture() }; u['uOpacity'] = this.uMist;
    return new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: /* glsl */`
        attribute vec4 mistSeed;
        uniform float uTime;
        varying vec2 vUv; varying vec3 vWorld; varying float vFade;
        void main() {
          vec3 centre = instanceMatrix[3].xyz;
          vec3 scale = vec3( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ), 1.0 );
          // slow drift around the anchor
          centre += vec3( sin( uTime * 0.045 * mistSeed.z + mistSeed.x * 6.283 ) * 3.0, sin( uTime * 0.07 + mistSeed.x * 9.0 ) * 0.25, cos( uTime * 0.038 * mistSeed.z + mistSeed.x * 6.283 ) * 3.0 );
          // cylindrical billboard
          vec3 toCam = cameraPosition - centre;
          float dist = length( toCam );
          vec3 fwd = normalize( vec3( toCam.x, 0.0, toCam.z ) + 1e-4 );
          vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fwd ) );
          vec3 w = centre + right * position.x * scale.x + vec3( 0.0, position.y * scale.y, 0.0 );
          vWorld = w;
          // rotate the texture slowly; fade when close or seen from above
          float ang = uTime * 0.02 * mistSeed.y;
          vec2 c = uv - 0.5;
          vUv = vec2( c.x * cos( ang ) - c.y * sin( ang ), c.x * sin( ang ) + c.y * cos( ang ) ) + 0.5;
          float down = abs( normalize( toCam ).y );
          vFade = smoothstep( 5.0, 18.0, dist ) * ( 1.0 - smoothstep( 0.45, 0.8, down ) ) * mistSeed.w;
          vFade *= 0.8 + 0.2 * sin( uTime * 0.09 + mistSeed.x * 20.0 );
          gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        ${fogGLSL}
        uniform sampler2D uTex; uniform float uOpacity; uniform vec3 uSunColor;
        varying vec2 vUv; varying vec3 vWorld; varying float vFade;
        void main() {
          float a = texture2D( uTex, vUv ).a * vFade * 0.34 * uOpacity;
          float sunAmt = max( dot( normalize( vWorld - cameraPosition ), fogSunDir ), 0.0 );
          vec3 col = mix( fogColor, fogSunColor, 0.3 + 0.45 * pow( sunAmt, 3.0 ) ) * 0.95;
          float f = atmosFogFactor( vWorld );
          col = mix( col, atmosFogColor( vWorld ), f );
          gl_FragColor = vec4( col, a );
        }`,
    });
  }

  // ------------------------------------------------------------------ needles
  private buildNeedles() {
    const geo = new THREE.PlaneGeometry(0.2, 0.05);
    const origin = new Float32Array(NEEDLE_COUNT * 3), info = new Float32Array(NEEDLE_COUNT * 4);
    this.needleOrigin = new THREE.InstancedBufferAttribute(origin, 3).setUsage(THREE.DynamicDrawUsage);
    this.needleInfo = new THREE.InstancedBufferAttribute(info, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('nOrigin', this.needleOrigin);
    geo.setAttribute('nInfo', this.needleInfo);
    const u = this.baseUniforms();
    u['uTex'] = { value: makeNeedleTexture() };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, side: THREE.DoubleSide, fog: true, transparent: false, alphaTest: 0.5,
      vertexShader: /* glsl */`
        attribute vec3 nOrigin; attribute vec4 nInfo;   // info: fall distance, period, phase, seed
        uniform float uTime;
        varying vec2 vUv; varying vec3 vWorld; varying float vAlpha; varying float vShade;
        mat3 rotXYZ( vec3 a ) {
          vec3 s = sin( a ), c = cos( a );
          mat3 rx = mat3( 1, 0, 0, 0, c.x, s.x, 0, -s.x, c.x );
          mat3 ry = mat3( c.y, 0, -s.y, 0, 1, 0, s.y, 0, c.y );
          mat3 rz = mat3( c.z, s.z, 0, -s.z, c.z, 0, 0, 0, 1 );
          return rz * ry * rx;
        }
        void main() {
          float period = nInfo.y;
          float t = mod( uTime + nInfo.z, period );
          float fallT = nInfo.x / 0.55;                    // seconds to reach the ground at 0.55 m/s
          float vis = t < fallT ? 1.0 : 0.0;
          float y = nOrigin.y - t * 0.55;
          vec2 sway = vec2( sin( t * 1.1 + nInfo.w * 6.283 ), cos( t * 0.9 + nInfo.w * 4.0 ) ) * 0.35 + vec2( 0.12, 0.07 ) * t;
          vec3 centre = vec3( nOrigin.x + sway.x, y, nOrigin.z + sway.y );
          mat3 R = rotXYZ( vec3( t * 2.3 + nInfo.w * 6.0, t * 1.7 + nInfo.w * 3.0, t * 1.1 ) );
          vec3 w = centre + R * position * vis;
          vWorld = w;
          vUv = uv;
          vShade = 0.6 + 0.4 * abs( ( R * vec3( 0.0, 0.0, 1.0 ) ).y );
          float dist = distance( w, cameraPosition );
          vAlpha = vis * ( 1.0 - smoothstep( 22.0, 32.0, dist ) ) * smoothstep( 0.0, 0.6, t ) * smoothstep( fallT, fallT - 0.5, t );
          gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        ${fogGLSL}
        uniform sampler2D uTex; uniform vec3 uSunColor;
        varying vec2 vUv; varying vec3 vWorld; varying float vAlpha; varying float vShade;
        void main() {
          vec4 tex = texture2D( uTex, vUv );
          if ( tex.a * vAlpha < 0.5 ) discard;
          vec3 col = tex.rgb * vShade * ( 0.35 + 0.65 * uSunColor );
          float f = atmosFogFactor( vWorld );
          col = mix( col, atmosFogColor( vWorld ), f );
          gl_FragColor = vec4( col, 1.0 );
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, NEEDLE_COUNT);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  private respawnNeedles(p: THREE.Vector3) {
    const near = this.forest.trees.filter((t) => (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < 28 * 28);
    if (near.length === 0) { this.needles.count = 0; return; }
    const rng = this.needleRng;
    const o = this.needleOrigin.array as Float32Array, inf = this.needleInfo.array as Float32Array;
    for (let i = 0; i < NEEDLE_COUNT; i++) {
      const t = rng.pick(near);
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.3, t.height * 0.16);
      const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      const top = t.y + t.height * rng.range(0.4, 0.85);
      const ground = heightAt(x, z);
      const fall = Math.max(1, top - ground + 0.05);
      o[i * 3] = x; o[i * 3 + 1] = top; o[i * 3 + 2] = z;
      inf[i * 4] = fall; inf[i * 4 + 1] = fall / 0.55 + rng.range(2, 14); inf[i * 4 + 2] = rng.range(0, 60); inf[i * 4 + 3] = rng.next();
    }
    this.needleOrigin.needsUpdate = true; this.needleInfo.needsUpdate = true;
    this.needles.count = NEEDLE_COUNT;
  }
}

// ------------------------------------------------------------------ placement helpers

/** Lowest, most enclosed spots near the central hollow and the pond: score = local depression + bias. */
function pickMistSpots() {
  const rng = new Rng(SEED + 903);
  const cands: { x: number; y: number; z: number; s: number }[] = [];
  const wl = waterLevel();
  for (let i = 0; i < 1300; i++) {
    let x: number, z: number;
    if (i % 4 === 0) { const a = rng.range(0, Math.PI * 2), d = rng.range(0, POND.r + 14); x = POND.x + Math.cos(a) * d; z = POND.z + Math.sin(a) * d; }
    else { x = rng.range(-170, 170); z = rng.range(-170, 170); }
    const h = Math.max(heightAt(x, z), wl - 0.3);   // over the pond sit on the water, not the basin floor
    let ring = 0;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ring += heightAt(x + Math.cos(a) * 22, z + Math.sin(a) * 22); }
    const lowness = ring / 8 - h;
    const bowl = smoothstep(170, 40, Math.hypot(x, z + 10)) * 3.0;
    const pond = smoothstep(POND.r + 30, POND.r * 0.5, Math.hypot(x - POND.x, z - POND.z)) * 3.0;
    cands.push({ x, y: h, z, s: lowness + bowl + pond + rng.range(0, 0.4) });
  }
  cands.sort((a, b) => b.s - a.s);
  const out: { x: number; y: number; z: number }[] = [];
  for (const c of cands) {
    if (out.length >= MIST_COUNT) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 9)) continue;
    out.push(c);
  }
  return out;
}

// ------------------------------------------------------------------ textures

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('[particles] no 2d canvas context');
  return g;
}

function makeMoteSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = ctx2d(c);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.7)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.15)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

/** Soft noise blob: many faint overlapping discs inside a radial falloff, alpha only. */
function makeMistTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = ctx2d(c);
  const rng = new Rng(SEED + 904);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 140; i++) {
    const r = rng.range(14, 48);
    const ang = rng.range(0, Math.PI * 2), rad = Math.sqrt(rng.next()) * (S * 0.42);
    const x = S / 2 + Math.cos(ang) * rad * 1.15, y = S / 2 + Math.sin(ang) * rad * 0.8;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.09)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // radial + bottom falloff so the quad edges never show
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.75, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearMipmapLinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

function makeNeedleTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16;
  const g = ctx2d(c);
  g.lineCap = 'round';
  g.strokeStyle = 'rgb(112,70,30)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(4, 9); g.lineTo(60, 5); g.stroke();
  g.strokeStyle = 'rgb(90,56,24)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(4, 9); g.lineTo(58, 12); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
