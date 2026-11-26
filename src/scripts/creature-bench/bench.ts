/**
 * ONE-FORMAT CC53: the 30-deer bench page. A herd of one species at one distance, drawn one way, measured over a fixed
 * number of drawn frames. `src/scripts/creature-bench.mjs` builds it, serves it and reads `window.__bench`.
 *
 * Query: `mode` (skinned | baked | sprite), `dist` (m from the camera to the herd's centre), `n` (deer, default 30),
 * `frames` (measured frames, default 180), `warm` (unmeasured frames first, default 60), `dpr` (default 2, the phone tier).
 *
 * `skinned` is today's path: one SkinnedMesh and skeleton per deer, the bones posed on the engine's FC11 cadence
 * (`poseEvery`) and frozen past the animation range, as RowBodies does. The pose is a stand-in gait (each bone swings on
 * its own phase): it costs what writing 20 bones and uploading the bone texture costs, not the engine's IK.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { poseEvery } from '../../shared/engine/entities/poseCadence';
import { BakedHerd, bakeGait } from '../../client/engine/entities/bakedHerd';
import { HerdSprites } from '../../client/engine/entities/herdSprites';
import { bakeSpriteViews } from '../../client/engine/render/spriteViews';

type Mode = 'skinned' | 'baked' | 'sprite';
interface BenchResult {
  mode: Mode; dist: number; n: number; frames: number;
  cpuMs: { p50: number; p95: number; max: number };
  poseMs: { p50: number; p95: number };
  gpuMs: { p50: number; p95: number } | null;
  intervalMs: { p50: number; p95: number; max: number };
  calls: number; triangles: number; programs: number;
  canvas: [number, number]; renderer: string;
}
declare global { interface Window { __bench?: BenchResult | { error: string } } }

const ANIM_LOD = 140; // RowBodies.ts: no pose past it
const GAIT_HZ = 1.6;
const q = new URLSearchParams(location.search);
const mode = (q.get('mode') ?? 'skinned') as Mode;
const dist = Number(q.get('dist') ?? 20), n = Number(q.get('n') ?? 30);
const frames = Number(q.get('frames') ?? 180), warm = Number(q.get('warm') ?? 60), dpr = Number(q.get('dpr') ?? 2);

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0);
};
const round = (x: number): number => Math.round(x * 1000) / 1000;

/** The stand-in gait: every bone but the root swings about its local x on its own phase. */
function poseGait(bones: readonly THREE.Bone[], rest: readonly THREE.Quaternion[], t: number, seed: number): void {
  const e = new THREE.Euler();
  const r = new THREE.Quaternion();
  for (let i = 1; i < bones.length; i++) {
    const b = bones[i], q0 = rest[i];
    if (b === undefined || q0 === undefined) continue;
    e.set(0.35 * Math.sin((t * GAIT_HZ + seed) * Math.PI * 2 + i * 0.7), 0, 0);
    b.quaternion.copy(q0).multiply(r.setFromEuler(e));
  }
}

/** Where deer `i` of the herd stands: a jittered 6-wide block centred `dist` m ahead (−z), facing across the view. */
function herdSpot(i: number): { x: number; z: number; yaw: number; seed: number } {
  const cols = 6, gap = 2.6;
  const c = i % cols, r = Math.floor(i / cols);
  const j = Math.sin(i * 12.9898) * 43758.5453;
  const jit = j - Math.floor(j);
  return { x: (c - (cols - 1) / 2) * gap + (jit - 0.5), z: -dist + (r - 2) * gap + (jit - 0.5) * 0.8, yaw: Math.PI / 2 + (jit - 0.5) * 0.6, seed: jit };
}

async function main(): Promise<void> {
  const canvas = document.querySelector('canvas');
  if (canvas === null) throw new Error('no canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.info.autoReset = false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = dbg === null ? 'unknown' : String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb8c8);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3b2a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0x5d6b3a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1500);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 0.9, -dist);

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/deer.glb');
  const proto = gltf.scene;
  let skinnedProto: THREE.SkinnedMesh | null = null;
  proto.traverse((o) => { if (skinnedProto === null && o instanceof THREE.SkinnedMesh) skinnedProto = o; });
  if (skinnedProto === null) throw new Error('deer.glb has no skinned mesh');
  const deerMesh: THREE.SkinnedMesh = skinnedProto;

  const spots = Array.from({ length: n }, (_, i) => herdSpot(i));
  const near = dist < ANIM_LOD;
  const every = poseEvery(dist * dist);
  let tick: (t: number) => void = () => undefined;

  if (mode === 'skinned') {
    const herd = spots.map((s) => {
      const root = cloneSkinned(proto);
      root.position.set(s.x, 0, s.z);
      root.rotation.y = s.yaw;
      scene.add(root);
      let mesh: THREE.SkinnedMesh | null = null;
      root.traverse((o) => { if (mesh === null && o instanceof THREE.SkinnedMesh) mesh = o; });
      if (mesh === null) throw new Error('clone lost its skin');
      const bones = (mesh as THREE.SkinnedMesh).skeleton.bones;
      return { bones, rest: bones.map((b) => b.quaternion.clone()), seed: s.seed, phase: Math.floor(s.seed * 8) };
    });
    let frame = 0;
    tick = (t) => {
      frame++;
      if (!near) return;
      for (const d of herd) if ((frame + d.phase) % every === 0) poseGait(d.bones, d.rest, t, d.seed);
    };
  } else if (mode === 'baked') {
    const bake = bakeGait(deerMesh, (bones, rest, t) => { poseGait(bones, rest, t, 0); }, { frames: 32, seconds: 1 / GAIT_HZ });
    const herd = new BakedHerd(deerMesh.geometry, bake, n, (deerMesh.material as THREE.Material).clone());
    spots.forEach((s, i) => { herd.place(i, new THREE.Vector3(s.x, 0, s.z), s.yaw, 1, s.seed); });
    scene.add(herd.mesh);
    tick = (t) => { herd.update(t); };
  } else {
    const sprites = new HerdSprites(bakeSpriteViews(renderer, proto, { views: 8, size: 128 }), n);
    spots.forEach((s, i) => { sprites.place(i, new THREE.Vector3(s.x, 0, s.z), s.yaw, 1); });
    scene.add(sprites.mesh);
    tick = () => { sprites.update(); };
  }

  const cpu: number[] = [], pose: number[] = [], gpu: number[] = [], interval: number[] = [];
  const pending: WebGLQuery[] = [];
  let calls = 0, triangles = 0, done = 0, last = 0;
  const drain = (disjoint: number): void => {
    for (let head = pending[0]; head !== undefined; head = pending[0]) {
      if (!(gl.getQueryParameter(head, gl.QUERY_RESULT_AVAILABLE) as boolean)) return;
      if (!(gl.getParameter(disjoint) as boolean)) gpu.push((gl.getQueryParameter(head, gl.QUERY_RESULT) as number) / 1e6);
      gl.deleteQuery(head);
      pending.shift();
    }
  };
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = (now: number): void => {
      const measured = done >= warm;
      if (measured && last > 0) interval.push(now - last);
      last = now;
      const a = performance.now();
      tick((now - t0) / 1000);
      const b = performance.now();
      renderer.info.reset();
      let query: WebGLQuery | null = null;
      if (timer !== null && measured) { query = gl.createQuery(); if (query !== null) gl.beginQuery(timer.TIME_ELAPSED_EXT, query); }
      renderer.render(scene, camera);
      if (query !== null && timer !== null) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push(query); }
      const c = performance.now();
      if (measured) { cpu.push(c - a); pose.push(b - a); calls = renderer.info.render.calls; triangles = renderer.info.render.triangles; }
      if (timer !== null) drain(timer.GPU_DISJOINT_EXT);
      done++;
      if (done >= warm + frames) resolve(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  window.__bench = {
    mode, dist, n, frames,
    cpuMs: { p50: round(pct(cpu, 0.5)), p95: round(pct(cpu, 0.95)), max: round(Math.max(...cpu)) },
    poseMs: { p50: round(pct(pose, 0.5)), p95: round(pct(pose, 0.95)) },
    gpuMs: gpu.length === 0 ? null : { p50: round(pct(gpu, 0.5)), p95: round(pct(gpu, 0.95)) },
    intervalMs: { p50: round(pct(interval, 0.5)), p95: round(pct(interval, 0.95)), max: round(Math.max(...interval)) },
    calls, triangles, programs: renderer.info.programs?.length ?? 0,
    canvas: [canvas.width, canvas.height], renderer: rendererName,
  };
}

main().catch((e: unknown) => { window.__bench = { error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) }; });
