import { uiScope } from './ownership';
import { engineString } from '../../../shared/engine/strings';
/**
 * The on-device perf probe (E142, the heavy GPU lane): where a real phone's frame goes, measured ON the phone.
 *
 * The desktop rulers (scripts/pine-hollow-gpu.mjs) time the WebGL frame on the M5 — 1.9 ms at the iPhone's own pixel
 * count, ~37× under Jake's 71 ms, while the A18's GPU is only ~7–9× narrower; the iOS Simulator runs the same frame's
 * JavaScript (Safari's JSC) in 3.8 ms. What the rest is (the GPU under thermal load, iOS compositing, WebKit's WebGL
 * path) can only be read on the device. This does it in ~60 s, from the fps pill's panel (developer mode: tap the pill ▸
 * RUN PROBE) or `?probe=1` (runs 15 s after the world is entered):
 *
 *   as played        the 30 fps cap as it is
 *   uncapped         no 30 fps cap: the frame's real cost (every row below is uncapped too)
 *   no HUD blur      every backdrop-filter off (the HUD glass, the touch discs)
 *   no HUD           the whole DOM HUD hidden (iOS compositing of the overlay)
 *   flat terrain     the ground's splat shader swapped for a flat-coloured lit material (the splat fetches + noise)
 *   no cards         the forest's needle cards hidden (the alpha-tested crown layers)
 *   no cover …       (E189, Driftwood) the ground cover hidden: all of it, its near set, its far set; `no terrain` the island's
 *                    terrain; `no viewmodel` the first-person hands and weapon. A row with nothing to hide on the shard is left out
 *                    (as are `flat terrain` / `no cards` off Pine Hollow).
 *   no shadows       the shadow map not redrawn
 *   no post          the scene straight to the canvas (no colour chain, bloom, god rays, SMAA)
 *   no scene         nothing drawn but the post chain (the floor: JS + post + compositing)
 *
 * Every row renders at the game's own fixed render scale (the phone's 2×): resolution is not a lever (E142, Jake:
 * dynamic resolution is "a complete bullshit hack") — the rows isolate real costs to cut at 2×.
 *
 * Per row: fps, the frame's p50 (ms between drawn frames), the main thread's p50 (input → the frame submitted: all the
 * JavaScript, three's draw submission included), and `wait` = frame − main thread (≈ the GPU / compositor the next frame
 * waited for). A row that drops `wait` a lot names the bottleneck. Nothing is saved: every switch is restored at the end.
 */
import * as THREE from 'three';
import { BlendFunction, type Effect, type Pass } from 'postprocessing';
import type { Game } from '../core/Game';
import { frameProbe } from '../core/tier';

export interface ProbeRow {
  phase: string; fps: number; frameMs: number; jsMs: number; waitMs: number; frames: number;
  /** E189: the frame's p95 / fastest / slowest (ms), and the uncapped as-played frame measured right before the row (the
   *  warm iPhone drifts between a fast and a slow state on its own: a row's saving is its frame against this, not row 1) */
  p95: number; min: number; max: number; base: number | null;
  /** seconds from the probe's start to the row's measuring window */
  at: number;
}

/** every drawn frame the probe saw: seconds from its start, frame ms, main-thread ms, the row (index into the rows, -1 = a
 *  baseline, -2 = a settle) */
export type ProbeSample = [number, number, number, number];

const SETTLE_MS = 1500, MEASURE_MS = 3500;
/** the baseline before each row: uncapped, as played */
const BASE_SETTLE_MS = 1000, BASE_MEASURE_MS = 2500;

/** the last probe's samples (the COPY report's timeline) */
export const probeSamples: ProbeSample[] = [];

interface Phase { name: string; set: (on: boolean) => void; /** false = nothing on this shard to switch: the row is left out */ applies?: () => boolean }

/** the scene's top-level objects named `name` (Driftwood's 'ground-cover', 'blender-island') */
function topNamed(scene: THREE.Object3D, name: string): THREE.Object3D[] { return scene.children.filter((o) => o.name === name); }

/** a pass's effects (postprocessing keeps EffectPass.effects private); [] for a pass without */
function effectsOf(pass: Pass): Effect[] {
  const e: unknown = Reflect.get(pass, 'effects');
  return Array.isArray(e) ? e.filter((x): x is Effect => typeof x === 'object' && x !== null && 'blendMode' in x) : [];
}

/**
 * A row that leaves the post chain's effects matching `pick` out (E189: the warm iPhone's grass frame is 48 ms with the post
 * chain, 17 without, and only 40–44 with any one scene system off — which effect is it?). The effect leaves the fused shader
 * (BlendFunction.SKIP: the pass recompiles once, in the row's settle) and its own passes stop (its `update`: bloom's mip
 * chain, the god rays' light pass and blur).
 */
function effectRow(name: string, passes: readonly Pass[], pick: (e: Effect) => boolean): Phase {
  // an effect's own `update` (the god rays' off-screen skip sets one), else the prototype's: put back exactly what was there
  const saved: { e: Effect; bf: BlendFunction; own: boolean; update: unknown }[] = [];
  const targets = (): Effect[] => passes.flatMap(effectsOf).filter(pick);
  return {
    name, applies: () => targets().length > 0,
    set: (on) => {
      if (on) {
        for (const e of targets()) {
          saved.push({ e, bf: e.blendMode.blendFunction, own: Object.hasOwn(e, 'update'), update: Reflect.get(e, 'update') });
          Reflect.set(e, 'update', () => undefined);
          e.blendMode.blendFunction = BlendFunction.SKIP;
        }
      } else {
        for (const x of saved) {
          if (x.own) Reflect.set(x.e, 'update', x.update); else Reflect.deleteProperty(x.e, 'update');
          x.e.blendMode.blendFunction = x.bf;
        }
        saved.length = 0;
      }
    },
  };
}

/** a row that switches the last pass off (SMAA) and hands the screen to the pass before it */
function lastPassRow(name: string, passes: readonly Pass[], pick: (p: Pass) => boolean): Phase {
  const last = (): Pass | undefined => passes[passes.length - 1];
  return {
    name, applies: () => { const l = last(); return l !== undefined && passes.length > 1 && pick(l); },
    set: (on) => {
      const l = last(), prev = passes[passes.length - 2];
      if (l === undefined || prev === undefined) return;
      l.enabled = !on; prev.renderToScreen = on; l.renderToScreen = !on;
    },
  };
}

/** a row that hides `targets()` while it runs (E189: the Driftwood rows) */
function hideRow(name: string, targets: () => THREE.Object3D[]): Phase {
  const hidden: THREE.Object3D[] = [];
  return {
    name, applies: () => targets().length > 0,
    set: (on) => {
      if (on) { for (const o of targets()) { if (o.visible) { o.visible = false; hidden.push(o); } } }
      else { for (const o of hidden) o.visible = true; hidden.length = 0; }
    },
  };
}

/** the scene's visible meshes whose material's program key passes `key` (the terrain's 'terrain-splat*', the forest's 'needles*') */
function meshesByProgram(scene: THREE.Object3D, key: (k: string) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as Partial<THREE.Mesh>).isMesh === true;
  scene.traverse((o) => {
    if (!isMesh(o)) return;
    const m: unknown = o.material;
    if (m instanceof THREE.Material && key(m.customProgramCacheKey())) out.push(o);
  });
  return out;
}


let running = false;

/** run the probe; `progress` gets a line per step, the promise the rows */
export async function runPerfProbe(game: Game, progress: (line: string) => void): Promise<ProbeRow[]> {
  if (running) return [];
  running = true;
  const scope = uiScope('perfProbe');
  const active = (): boolean => !scope.disposed;
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const forget = scope.capture('disposers', resolve);
    scope.timeout(ms, () => { forget(); resolve(); });
  });
  const r = game.renderer, composer = game.composer, hud = document.getElementById('hud');
  const style = document.createElement('style');
  document.head.append(style); scope.capture('nodes', () => { style.remove(); });
  const passes = composer.passes;
  const first = passes[0];
  // the terrain's stand-in: lit like the ground (PBR, rough), no splat fetches, no noise
  const plain = new THREE.MeshStandardMaterial({ color: 0x5a5040, roughness: 1, metalness: 0 });
  const swapped = new Map<THREE.Mesh, THREE.Mesh['material']>(), hiddenCards: THREE.Mesh[] = [];
  const phases: Phase[] = [
    { name: 'as played', set: () => undefined },
    { name: 'uncapped', set: () => undefined },
    { name: 'no HUD blur', set: (on) => { style.textContent = on ? engineString('s_aaff11a4961f') : ''; } },
    { name: 'no HUD', set: (on) => { if (hud) hud.style.visibility = on ? 'hidden' : ''; } },
    {
      name: 'flat terrain', applies: () => meshesByProgram(game.scene, (k) => k.startsWith('terrain-splat')).length > 0, set: (on) => {
        if (on) {
          for (const m of meshesByProgram(game.scene, (k) => k.startsWith('terrain-splat'))) { swapped.set(m, m.material); m.material = plain; }
        } else { for (const [m, mat] of swapped) m.material = mat; swapped.clear(); }
      },
    },
    {
      name: 'no cards', applies: () => meshesByProgram(game.scene, (k) => k.startsWith('needles')).length > 0, set: (on) => {
        if (on) { for (const m of meshesByProgram(game.scene, (k) => k.startsWith('needles'))) { if (m.visible) { m.visible = false; hiddenCards.push(m); } } }
        else { for (const m of hiddenCards) m.visible = true; hiddenCards.length = 0; }
      },
    },
    // E189 (Driftwood, the warm phone's grass frame): the ground cover, its near and far sets, the island's terrain, the viewmodel
    hideRow('no cover', () => topNamed(game.scene, 'ground-cover')),
    hideRow('no near cover', () => topNamed(game.scene, 'ground-cover').flatMap((g) => g.children.filter((o) => o.name.startsWith('ground-cover-') && !o.name.endsWith('-far') && o.userData['coverProp'] !== true))),
    hideRow('no far cover', () => topNamed(game.scene, 'ground-cover').flatMap((g) => g.children.filter((o) => o.name.endsWith('-far')))),
    hideRow('no terrain', () => topNamed(game.scene, 'blender-island')),
    hideRow('no viewmodel', () => [...game.camera.children]),
    { name: 'no shadows', set: (on) => { r.shadowMap.autoUpdate = !on; } },
    // E189: the post chain one part at a time (the effects by their class names, as the bundle keeps them)
    lastPassRow('no SMAA', passes, (p) => effectsOf(p).some((e) => e.name === 'SMAAEffect')),
    effectRow('no bloom', passes, (e) => e.name === 'BloomEffect'),
    effectRow('no god rays', passes, (e) => e.name === 'GodRaysEffect'),
    effectRow('no grade', passes, (e) => ['ToneMappingEffect', 'HueSaturationEffect', 'BrightnessContrastEffect', 'VignetteEffect', 'LUT3DEffect', 'GradeEffect'].includes(e.name)),
    {
      name: 'no post', set: (on) => {
        for (const p of passes) if (p !== first) p.enabled = !on;
        if (first) first.renderToScreen = on;
      },
    },
    { name: 'no scene', set: (on) => { game.scene.visible = !on; } },
  ];
  const rows: ProbeRow[] = [];
  // every drawn frame, tagged with what was switched at the time (E189: the COPY report's timeline)
  probeSamples.length = 0;
  const start = performance.now();
  let tag = -2, seen = game.frameCount, sampling = true;
  const sample = (): void => {
    if (!sampling) return;
    if (game.frameCount !== seen) {
      seen = game.frameCount;
      const k = (game.frameI - 1 + game.frameMs.length) % game.frameMs.length;
      probeSamples.push([(performance.now() - start) / 1000, game.frameMs[k] ?? 0, game.workMs[k] ?? 0, tag]);
    }
    scope.raf(sample);
  };
  scope.raf(sample);
  const pct = (v: number[], q: number): number => { const a = [...v].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * q))] ?? 0; };
  /** measure `ms` under tag `t`: the frames' stats */
  const measure = async (t: number, ms: number): Promise<{ fps: number; frameMs: number; jsMs: number; p95: number; min: number; max: number; frames: number; at: number }> => {
    const from = probeSamples.length, t0 = performance.now();
    tag = t;
    await sleep(ms);
    tag = -2;
    const got = probeSamples.slice(from), f = got.map((x) => x[1]), j = got.map((x) => x[2]);
    const secs = (performance.now() - t0) / 1000;
    return { fps: got.length / secs, frameMs: pct(f, 0.5), jsMs: pct(j, 0.5), p95: pct(f, 0.95), min: f.length > 0 ? Math.min(...f) : 0, max: f.length > 0 ? Math.max(...f) : 0, frames: got.length, at: (t0 - start) / 1000 };
  };
  const live = phases.filter((x) => x.applies?.() ?? true);
  try {
    for (const [i, ph] of live.entries()) {
      if (!active()) break;
      // row 0 as played; every other row uncapped, after a baseline of its own (rows 0 and 1 are the baselines themselves)
      frameProbe.uncapped = i !== 0;
      let base: number | null = null;
      if (i >= 2) {
        progress(`${i + 1}/${live.length} baseline…`);
        await sleep(BASE_SETTLE_MS);
        base = (await measure(-1, BASE_MEASURE_MS)).frameMs;
      }
      if (!active()) break;
      ph.set(true);
      progress(`${i + 1}/${live.length} ${ph.name}…`);
      await sleep(SETTLE_MS);
      const m = await measure(i, MEASURE_MS);
      rows.push({ phase: ph.name, ...m, waitMs: Math.max(0, m.frameMs - m.jsMs), base });
      ph.set(false);
    }
  } finally {
    sampling = false;
    scope.dispose();
    for (const ph of phases) ph.set(false);
    frameProbe.uncapped = false;
    style.remove();
    plain.dispose();
    running = false;
  }
  return rows;
}

/** the rows as fixed-width lines for the panel / console; `base` = the as-played frame measured just before the row */
export function probeLines(rows: readonly ProbeRow[], header: string): string[] {
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const n = (v: number | null, w: number) => (v === null ? '—' : v.toFixed(1)).padStart(w);
  return [header, `${pad('', 14)}  fps  frame   js  wait  base`, ...rows.map((x) => `${pad(x.phase, 14)} ${x.fps.toFixed(0).padStart(4)} ${n(x.frameMs, 6)} ${n(x.jsMs, 4)} ${n(x.waitMs, 5)} ${n(x.base, 5)}`)];
}

/**
 * E189 (Jake: "you need a copy button after running this probe … I like lots and lots of data"): the whole probe as text —
 * `header` (build, device, settings, where), every row with its full stats and its saving against its own baseline, then
 * the run second by second (mean / max frame ms and what was switched), so a drift of the phone's own state shows.
 */
export function probeReport(rows: readonly ProbeRow[], samples: readonly ProbeSample[], header: readonly string[]): string {
  const f = (v: number | null) => (v === null ? '—' : v.toFixed(1));
  const out = [...header, '', 'ROWS  (ms; save = base − frame: what the row takes off the as-played frame measured just before it)',
    'row             at s   fps  frame   p95   min    max    js  wait   base  save  frames'];
  for (const r of rows) {
    out.push(`${r.phase.padEnd(14)} ${r.at.toFixed(0).padStart(5)} ${r.fps.toFixed(1).padStart(5)} ${f(r.frameMs).padStart(6)} ${f(r.p95).padStart(5)} ${f(r.min).padStart(5)} ${f(r.max).padStart(6)} ${f(r.jsMs).padStart(5)} ${f(r.waitMs).padStart(5)} ${f(r.base).padStart(6)} ${(r.base === null ? '—' : (r.base - r.frameMs).toFixed(1)).padStart(5)} ${String(r.frames).padStart(6)}`);
  }
  out.push('', 'TIMELINE  (per second: frames, mean / max frame ms, mean js ms, what was measured: a row, "base", or "-" settling)');
  const bySec = new Map<number, ProbeSample[]>();
  for (const x of samples) { const k = Math.floor(x[0]); const l = bySec.get(k) ?? []; l.push(x); bySec.set(k, l); }
  for (const [sec, l] of [...bySec.entries()].sort((a, b) => a[0] - b[0])) {
    const fr = l.map((x) => x[1]), js = l.map((x) => x[2]), mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const t = l[l.length - 1]?.[3] ?? -2, what = t >= 0 ? (rows[t]?.phase ?? String(t)) : t === -1 ? 'base' : '-';
    out.push(`${String(sec).padStart(4)}s ${String(l.length).padStart(3)} fr  ${mean(fr).toFixed(1).padStart(5)} / ${Math.max(...fr).toFixed(1).padStart(5)}  js ${mean(js).toFixed(1).padStart(4)}  ${what}`);
  }
  return out.join('\n');
}
