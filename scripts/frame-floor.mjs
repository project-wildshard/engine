#!/usr/bin/env node
// SF0: live drawn-frame baseline. Explicit Chromium CPU profiles never earn official floor credit.
// node scripts/frame-floor.mjs [--shards=a,b] [--surface=desktop|sim|both] [--frames=120] [--device=<name>] [--rev=<sha>] [--setting=key=value] [--device-save=key=value]
// --shards=grid: INFINITE WILDSHARD, entered the way a player does (the title's grid entry tapped, Developer on; no URL
// switch), measured at the home cell's spawn and the heaviest of its parity cameras plus three highway-deck views.
// --grid-scenario=cell --grid-cell=<slug|instance> [--grid-cell-pose=x,y,z,yawDeg[,pitchDeg]] [--road-approach] [--devserver]: also enter that cell from
// the road at its home-side edge and measure travel, its interior and (optionally) a pose in its local frame; --devserver
// builds the pinned preview in DEVSERVER mode, whose grid holds the DEVSERVER-only cells (op-frame22).
// Owns a clean, pinned HEAD preview, browser/simulator lanes and their cleanup. Exit 2 = floor misses;
// exit 3 = incomplete measurement. --regrade=<baseline> reapplies current floor policy without rerendering.
// --surface=sim --quiet: the official worker holds bounded quiet only while reading, after the build.
// --standing-file=<json>: exactly the measured shards, each with 1–8 {name,x,y,z,yaw,pitch} world poses (radians).
// EP10 CI reporting: --surface=desktop --chromium-phone --chromium-cpu=4 --draw-budget-report-only
// On Linux add explicit --chromium-angle=swiftshader (report-only, never official floor credit).
// Bounded Linux delivery: --software-draw-census --frames=4 uses CSS201x437 at 2x,
// native spawn only, with no phone-budget credit. Full phone/floor rows remain unchanged.
// --shards=nine-dragon-stack,pine-hollow,driftwood-isle --serve-base=<same-SHA prepare server> --rev=<SHA>
// keeps existing floor verdicts; budget misses/coverage remain in paired raw rows plus sibling
// *-draw-budget.json / .md and GITHUB_STEP_SUMMARY. No new blocking CI gate or official floor credit.
// --webkit-timeline=<existing scratch directory>: raw per-drive Inspector records; diagnostic only, no GL timers.
// Long-frame gate (Jake: 60-120 fps desktop / 30-60 fps Simulator "at all moments"): every row FAILS
// when a frame exceeds 100 ms desktop / 200 ms Simulator. Whole drives include every build still running
// after arrival, so a freeze that p95 never sees cannot pass.
// Results: --output-dir=<scratch dir> (default progress/frame-floor)/<measured-short-sha>-<run-id>.json.
// --desktop-dpr=<1..3>: the desktop surface's device scale factor (default 2) on its 1440x900 viewport.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { createHash } from 'node:crypto';
import { frameFloorStanding } from './frame-floor-standing.mjs';
import { frameFloorPending } from './frame-floor-pending.mjs';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fixtureStorageCode, saveFixtureCode } from './debug-settings.mjs';
import { frameFloorSettingsCode, assertFrameFloorFixture, frameFloorBootstrapHtml, frameFloorGameNavigationCode, traceFrameFloorFixtureWrites } from './frame-floor-settings.mjs';
import { startFloorNative } from './frame-floor-native.mjs';
import { validateFrameFloorArgs, parseSafariWindow, frameFloorChromiumCpuRate, frameFloorDrawBudgetMode, frameFloorChromiumAngle, frameFloorSoftwareCensus } from './frame-floor-args.mjs';
import { frameFloorCpuPhase, assertFrameFloorRenderer } from './frame-floor-report-phase.mjs';
import { frameFloorShards } from './frame-floor-inventory.mjs';
import { handoffFloorGridNavigation, FLOOR_GRID_TAP } from './frame-floor-navigation.mjs';
import { selectFloorGridPlans, gridFloorPoses, gridFloorPlans, floorGridPortalPlan, readFloorGridEntryways, stageFloorGrid, driveFloorGrid, gridFloorWitnessFailures, installFloorGridProgress, gridFloorRuntimeFailure, gridFloorDocumentIdentity } from './frame-floor-grid.mjs';
import { GL_INIT } from './parity/glbytes.mjs';
import { GL_TIMING_SCRIPT } from './frame-floor-gl-time.mjs';
import { TASK_CLOCK_SCRIPT } from './frame-floor-task-clock.mjs';
import { startScriptProfile, startPrefixScriptProfile, startDriveWindowScriptProfile, STEADY_SCRIPT_WINDOW, STEADY_TIMELINE_WINDOW } from './frame-floor-script-profile.mjs';
import { TimelineRecordingError, timelineLongFrames } from './frame-floor-webkit-timeline.mjs';
import { createWebKitTimelineSession } from './frame-floor-timeline-session.ts';
import { assessDrawBudget } from '../src/client/engine/core/drawBudget.ts';
import { frameFloorDrawReport, frameFloorDrawMarkdown, frameFloorDrawConsole, writeFrameFloorDrawReport } from './frame-floor-draw-report.mjs';
import { BUFFER_PRESSURE_SCRIPT } from './frame-floor-buffer-pressure.mjs';
import { ABLATION_NORMAL, ablationPhases, refreshAblationInspector } from './frame-floor-pause-ablation.mjs';
import { startJscGcLog, jscGcProcessIds } from './frame-floor-jsc-gc.mjs';
import { NATIVE_PRESSURE_SCRIPT } from './frame-floor-native-pressure.mjs';
import { WASM_CONSTRUCTORS_SCRIPT, SCRIPT_MEMORY_POOL } from './frame-floor-wasm-constructors.mjs';
import { runWasmMemoryProbe } from './frame-floor-wasm-probe.mjs';
import { gpuBisect, settleTrace } from './frame-floor-gpu-bisect.mjs';
import { publicGridIntentCode, publicGridPlans, readPublicGridWitness, publicGridWitnessFailures } from './public-grid.mjs';

const ROOT = resolvePath(import.meta.dirname, '..');
const SCRIPT = import.meta.filename;
const ALL = frameFloorShards(ROOT);
const args = process.argv.slice(2);
validateFrameFloorArgs(args);
const drawBudgetMode = frameFloorDrawBudgetMode(args);
const softwareCensus = frameFloorSoftwareCensus(args);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const shards = flag('shards', ALL.join(',')).split(',');
const surface = flag('surface', 'both');
const quietSample = args.includes('--quiet');
const wasmMemoryProbe = args.includes('--wasm-memory-probe');
const nativeDirectory = flag('native-memory', '');
if (nativeDirectory !== '' && (surface !== 'sim' || !existsSync(nativeDirectory))) throw new Error('--native-memory requires Simulator and an existing scratch directory');
const frames = Number(flag('frames', '120'));
const settleMs = Number(flag('settle', '2')) * 1000;
const standingPoses = flag('standing-poses', '').split(',').filter(Boolean);
const standingFile = flag('standing-file', '');
const standingBytes = standingFile === '' ? null : readFileSync(resolvePath(ROOT, standingFile));
const suppliedStanding = standingBytes === null ? null : frameFloorStanding(JSON.parse(standingBytes.toString('utf8')), shards);
const standingSource = standingBytes === null ? null : {file: standingFile, sha256: createHash('sha256').update(standingBytes).digest('hex'), poses: suppliedStanding};
if (suppliedStanding !== null && standingPoses.length > 0) throw new Error('Choose standing-file or standing-poses');
if (standingPoses.length > 8 || new Set(standingPoses).size !== standingPoses.length || standingPoses.some(name => !/^[a-zA-Z0-9_.-]{1,128}$/u.test(name))) throw new Error('--standing-poses requires up to eight unique authored camera names');
const device = flag('device', 'frame-floor-iphone-17-pro');
const developer = flag('developer', 'on');
if (!['on', 'off'].includes(developer)) throw new Error('Developer must be on or off');
const publicGrid = developer === 'off' && shards.includes('grid');
if (publicGrid && shards.length !== 1) throw new Error('Public grid requires its own floor run');
const gridScenario = flag('grid-scenario', 'baseline');
const gridRoutes = flag('grid-routes', '').split(',').filter(Boolean);
if (gridRoutes.length > 0 && (publicGrid || gridScenario === 'baseline')) throw new Error('--grid-routes selects Developer drive routes only');
const devserverBuild = args.includes('--devserver');
const gridCell = flag('grid-cell', '');
const roadApproach = args.includes('--road-approach');
const entrySocket = args.includes('--entry-socket');
const risingIslet = flag('rising-islet', '');
if (risingIslet !== '' && (!['cell', 'cold'].includes(gridScenario) || !['north', 'east', 'south', 'west'].includes(risingIslet))) throw new Error('--rising-islet=<north|east|south|west> requires a cell with an authored lift');
if (entrySocket && !['cell', 'cold'].includes(gridScenario)) throw new Error('--entry-socket requires the cell scenario');
if (roadApproach && !['cell', 'cold'].includes(gridScenario)) throw new Error('--road-approach requires the cell scenario');
const gridCellPoseArg = flag('grid-cell-pose', '');
if (['cell', 'cold'].includes(gridScenario) !== (gridCell !== '') || (gridCellPoseArg !== '' && !['cell', 'cold'].includes(gridScenario))) throw new Error('--grid-scenario=cell takes --grid-cell=<slug|instance> (and optionally --grid-cell-pose); neither goes with another scenario');
if (publicGrid && gridScenario === 'cell') throw new Error('The cell scenario needs Developer mode');
/** a pose in the entered cell's local frame (metres, degrees), measured standing after the entry */
const gridCellPose = gridCellPoseArg === '' ? null : (() => {
  const v = gridCellPoseArg.split(',').map(Number);
  if ((v.length !== 4 && v.length !== 5) || !v.every(Number.isFinite)) throw new Error('--grid-cell-pose=x,y,z,yawDeg[,pitchDeg]');
  return { name: `grid-${gridCell}-pose`, x: v[0], y: v[1], z: v[2], yaw: v[3] * Math.PI / 180, pitch: (v[4] ?? 0) * Math.PI / 180 };
})();
// The opt-in standing observer is sampled; full per-draw label diagnostics never belong to a floor.
const glObserver = flag('gl-observer', args.includes('--draw-budget') || args.includes('--draw-budget-report-only') || gridScenario === 'baseline' ? 'off' : 'on');
if (!['off', 'on'].includes(glObserver)) throw new Error('GL observer must be off or on');
const travelGl = glObserver === 'on' ? GL_INIT : '';
// op-hitch23: opt-in desktop CPU attribution of each grid travel leg (CDP sampling profiler + Long Task entries); the raw
// .cpuprofile goes to the named scratch folder, a per-long-task inclusive summary goes in the row. Diagnostic: no timing credit.
const cpuProfileDir = flag('cpu-profile', '');
if (cpuProfileDir !== '' && (surface !== 'desktop' || (gridScenario === 'baseline' && shards.includes('grid')) || !existsSync(cpuProfileDir))) throw new Error('--cpu-profile=<existing dir> profiles desktop grid travel legs and standalone standing poses only');
const safariProfileDir = flag('safari-profile', '');
const safariSteadyPose = flag('safari-steady', '');
const safariDrive = flag('safari-drive', '');
const safariPrefix = flag('safari-prefix', '');
const safariWindow = parseSafariWindow(flag('safari-window', ''));
if (safariProfileDir !== '' && (surface !== 'sim' || (gridScenario === 'baseline' && shards.includes('grid')) || !existsSync(safariProfileDir))) throw new Error('--safari-profile=<existing dir> samples Simulator standing and whole-drive windows (diagnostic, no timing credit)');
const jscGcDirectory = flag('jsc-gc-log', '');
const jscRamSize = Number(flag('jsc-ram-size', '0'));
if (jscGcDirectory !== '' && !existsSync(jscGcDirectory)) throw new Error('--jsc-gc-log requires an existing directory');
const webkitTimelineDir = flag('webkit-timeline', '');
const webkitSteadyPose = flag('webkit-steady', '');
const webkitSteadyPoses = webkitSteadyPose === '' ? [] : webkitSteadyPose.split(',');
const pauseAblation = args.includes('--pause-ablation');
const bufferAblation = args.includes('--buffer-ablation');
const ablationSelected = [pauseAblation, bufferAblation].includes(true);
const nativePressureDir = flag('native-pressure', '');
if (nativePressureDir !== '' && !existsSync(nativePressureDir)) throw new Error('--native-pressure requires an existing directory');
const NATIVE_PRESSURE = nativePressureDir === '' ? '' : NATIVE_PRESSURE_SCRIPT;
if (webkitTimelineDir !== '' && (surface !== 'sim' || gridScenario === 'baseline' && !wasmMemoryProbe || !existsSync(webkitTimelineDir))) throw new Error('--webkit-timeline=<existing dir> captures Simulator grid drives only (diagnostic, no timing credit)');
const wasmConstructorsDir = flag('wasm-constructors', '');
if (wasmConstructorsDir !== '' && (surface !== 'sim' || gridScenario === 'baseline' && !wasmMemoryProbe || !existsSync(wasmConstructorsDir))) throw new Error('--wasm-constructors=<existing dir> observes native Simulator constructors (diagnostic, no timing credit)');
const WASM_CONSTRUCTORS = wasmConstructorsDir === '' ? '' : WASM_CONSTRUCTORS_SCRIPT;
// sp-o3: `--gpu-bisect` measures each grid route's interior again with one post pass, the shadow update or one heavy
// scene subtree switched off at a time (scripts/frame-floor-gpu-bisect.mjs): a render-shaped standing miss attributed
// without GPU timer queries, which WebKit lacks. Diagnostic only, no timing credit; the graded interior row is taken first.
// sp-o276: a standalone shard's worst standing pose gets the same bisect (plus a GL census of draws, programs, uniform
// uploads), after a settle trace: 240 frames straight after a teleport, each with its GL calls, render passes and draw owners.
const gpuBisectOn = args.includes('--gpu-bisect');
// sp-o276: a standalone shard's worst standing pose is bisected too (grid routes keep their interiors).
// op-hitch27: opt-in GL-call timing on BOTH surfaces (`--gl-time`): the heavy WebGL calls (uploads, shader compile / link
// queries, draws) are timed per frame, and each long frame of a whole-drive row carries its GL split, so a Simulator
// long frame says whether it was an image upload, a program link, a synchronous readback/query or a first draw. Diagnostic: no timing credit.
// op-hitch32: an image upload of 3 ms or more also counts under `slow <call> <source type> <width>x<height>` (a typed
// array's byte length in place of the width), so a long upload frame names what it uploaded.
const glTime = args.includes('--gl-time');
// G386: the textures are harness pins, never a setting, Debug row or URL switch (the GPU textures row is retired).
// `--textures=ktx2|img` pins the mode; `--ktx2-probe=skip` (Simulator, measurement only) skips the KTX2 capability probe,
// which vetoes KTX2 on the iOS Simulator alone (its Safari samples the lower mips of sRGB ASTC / ETC2 as zero), so the
// floor times the KTX2 path a real iPhone runs. Its Simulator pixels are wrong: a timing and memory reading, never a look.
const texturesPin = flag('textures', '');
if (!['', 'ktx2', 'img'].includes(texturesPin)) throw new Error('--textures=ktx2|img');
const ktx2ProbePin = flag('ktx2-probe', '');
if (!['', 'skip'].includes(ktx2ProbePin)) throw new Error('--ktx2-probe=skip');
// G717 A diagnostic: `--entry-settle` pins the phone entry's program settle (game/client/session/settlePrograms.ts) until it ships
const entrySettle = args.includes('--entry-settle');
const HARNESS_PINS = JSON.stringify({ seed: 357, capture: null, ...(texturesPin === '' ? {} : { textures: texturesPin }), ...(ktx2ProbePin === '' ? {} : { ktx2Probe: ktx2ProbePin }), ...(entrySettle ? { entrySettle: true } : {}) });
// Optional bounded clock/ring reads, without wrapping rAF or changing the frame gate.
// A sampler callback is not an entire rAF batch: its delay cannot partition tasks, idle or GPU waits.
const frameTimeline = args.includes('--frame-timeline');
// sp-o13: opt-in task clock (`--task-clock`, both surfaces, diagnostic only): each page task's span during a grid drive
// (exact callback time, bounded total with its microtasks, the stack that scheduled it), in the drive row's `tasks`, so a
// long frame reads as busy, unavailable or display scheduling (scripts/frame-floor-task-clock.mjs).
const taskClock = args.includes('--task-clock');
if (taskClock && gridScenario === 'baseline') throw new Error('--task-clock attributes grid drives only');
const TASK_CLOCK = taskClock ? TASK_CLOCK_SCRIPT : '';
if (glTime && gridScenario === 'baseline') throw new Error('--gl-time attributes grid drive long frames only');
const GL_TIME_SCRIPT = glTime ? GL_TIMING_SCRIPT : '';
// op-hitch47: opt-in desktop Chrome trace of each grid drive (`--gpu-trace=<existing scratch dir>`): the GPU process's
// own events (command buffer, shader compile / link, texture uploads, swap), so a long frame with an idle main thread says
// what the GPU process was doing. Writes <plan>-<time>.json (Chrome trace) and <plan>-<time>.frames.json (the drive's long
// frames on the page clock plus the trace-clock anchor) for scripts/gpu-trace-frames.mjs. Diagnostic: no timing credit.
const gpuTraceDir = flag('gpu-trace', '');
if (gpuTraceDir !== '' && (surface !== 'desktop' || gridScenario === 'baseline' || !existsSync(gpuTraceDir))) throw new Error('--gpu-trace=<existing dir> traces desktop grid drives only');
const GPU_TRACE_CATEGORIES = ['toplevel', 'gpu', 'gpu.service', 'gpu.decoder', 'gpu.angle', 'gpu.capture', 'viz', 'cc', 'blink', 'blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-gpu.service', 'disabled-by-default-gpu.device', 'disabled-by-default-gpu.decoder', 'disabled-by-default-gpu_cmd_queue', 'disabled-by-default-skia.gpu', 'v8.execute', 'scheduler', 'disabled-by-default-v8.cpu_profiler'];
const LONGTASK_SCRIPT = cpuProfileDir === '' ? '' : `window.__frameFloorLongTasks=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__frameFloorLongTasks.push([e.startTime,e.duration]);}).observe({type:'longtask',buffered:true});}catch{}`;
if (!['baseline', 'template', 'runtime-travel', 'sun-entry', 'cell', 'all', 'milestone', 'reentry', 'outer-road', 'cold', 'nine-return', 'sky-cycle'].includes(gridScenario) || (gridScenario !== 'baseline' && !shards.includes('grid'))) throw new Error('Invalid grid scenario');
if (publicGrid && (gridScenario === 'milestone' || gridScenario === 'reentry')) throw new Error('Milestone and re-entry floors require Developer mode');
if (publicGrid && gridScenario === 'sun-entry') throw new Error('Signal Dunes entered floor requires Developer mode');
if (args.includes('--help')) {
  console.log('node scripts/frame-floor.mjs [--shards=a,b] [--surface=desktop|sim|both] [--developer=on|off] [--frames=120] [--settle=2] [--standing-poses=name,...] [--device=<name>] [--rev=<sha>] [--setting=key=value] [--device-save=key=value] [--textures=ktx2|img] [--ktx2-probe=skip] [--gl-observer=off|on] [--grid-scenario=baseline|template|runtime-travel|sun-entry|all|milestone|reentry|outer-road|cell --grid-cell=<slug|instance> [--grid-cell-pose=x,y,z,yawDeg[,pitchDeg]] [--road-approach] [--entry-socket] [--rising-islet=north|east|south|west]] [--devserver] [--grid-routes=route-name,...] [--cpu-profile=<scratch dir>] [--chromium-phone --chromium-cpu=4 --draw-budget|--draw-budget-report-only --chromium-angle=metal|swiftshader] [--gpu-trace=<scratch dir>] [--safari-profile=<scratch dir>] [--safari-steady=<grid-interior-pose>] [--safari-drive=<grid-route>] [--safari-prefix=<grid-route>] [--safari-window=<route:start:end seconds>] [--gl-time] [--frame-timeline] [--wasm-constructors=<scratch dir>] [--wasm-memory-probe] [--task-clock] [--gpu-bisect] [--scratch-dir=<owned workspace>] [--serve-shard=<slug>] [--serve-base=<served preview url of --rev>]\nRuns an isolated clean pinned export; desktop uncapped at 1440×900/2×, Safari iPhone 17 Pro phone tier/2×. Grid scenarios drive actual input and require frame/interior/residency witnesses. Public grid seeds only the existing tap intent; admission remains hard. Owns its lanes. Exit 2: floor miss, 3: incomplete.');
  process.exit(0);
}
if (shards.length === 0 || shards.some((s) => !ALL.includes(s)) || new Set(shards).size !== shards.length || !['desktop', 'sim', 'both'].includes(surface) || !Number.isInteger(frames) || (softwareCensus === null ? frames < 30 || frames > 600 : frames !== softwareCensus.frames) || !Number.isFinite(settleMs) || settleMs < 1000 || settleMs > 10000) throw new Error('Invalid shards, surface, frames (30–600; software census exactly 4) or settle (1–10 seconds)');

const ERROR_SCRIPT = `window.__frameFloorErrors=[];window.addEventListener('error',e=>window.__frameFloorErrors.push(String(e.message).slice(0,240)));window.addEventListener('unhandledrejection',e=>window.__frameFloorErrors.push(String(e.reason).slice(0,240)));`;
const CONSOLE_SCRIPT = `window.__frameFloorConsole=[];for(const level of ['log','info','warn','error']){const original=console[level].bind(console);console[level]=(...args)=>{window.__frameFloorConsole.push({level,text:args.map(value=>String(value)).join(' ').slice(0,1000)});if(window.__frameFloorConsole.length>100)window.__frameFloorConsole.shift();original(...args);};}`;
const settingArgs = args.filter((arg) => arg.startsWith('--setting='));
const picks = Object.fromEntries(settingArgs.map((arg) => {
  const match = /^--setting=([a-zA-Z][a-zA-Z0-9.]*)=([^=]+)$/u.exec(arg);
  if (!match || ['tier', 'fps'].includes(match[1])) throw new Error('Invalid Debug setting; tier and fps belong to the floor protocol');
  return [match[1], match[2]];
}));
// G717 diagnostic: the phone tier on the Chromium surface (iPhone 17 Pro portrait, render scale 2), graded at the
// Simulator's 30 fps floor; a profile proxy for a Simulator miss, never a floor reading
const chromiumPhone = args.includes('--chromium-phone');
const chromiumCpuRate = frameFloorChromiumCpuRate(args);
const chromiumBackend = frameFloorChromiumAngle(args), chromiumAngle = chromiumBackend.angle;
const desktopDpr = Number(flag('desktop-dpr', '2'));
if (!Number.isFinite(desktopDpr) || desktopDpr < 1 || desktopDpr > 3) throw new Error('--desktop-dpr=<1..3>');
const drawBudgetOn = ['--draw-budget', '--draw-budget-report-only'].some(arg => args.includes(arg));
const postReadyCpu = drawBudgetOn && drawBudgetMode === 'report-only' && chromiumCpuRate !== 1;
const settings = { ...picks, tier: surface === 'sim' || chromiumPhone ? 'phone' : 'desktop', fps: 'auto' };
const deviceSaveArgs = args.filter((arg) => arg.startsWith('--device-save='));
const deviceSaves = Object.fromEntries(deviceSaveArgs.map((arg) => {
  const match = /^--device-save=([a-zA-Z][a-zA-Z0-9._-]*)=(.+)$/u.exec(arg);
  if (!match) throw new Error('Invalid device save; expected key=value');
  return [match[1], match[2]];
}));
const systemArgs = args.filter((arg) => arg.startsWith('--expect-system='));
const expectedSystems = systemArgs.map((arg) => {
  const match = /^--expect-system=([a-zA-Z0-9_-]+):([a-zA-Z0-9._-]+)=(on|off)$/u.exec(arg);
  if (!match || !shards.includes(match[1])) throw new Error('Expected system must name a measured shard:system=on|off');
  return { shard: match[1], id: match[2], present: match[3] === 'on' };
});
// Every row is a cold launch: the driver ends the previous row's page without a pagehide, and since G895 (b86ad9da1e) a
// stale alive beat resumes that shard instead of opening the title, so the grid row's title never showed INFINITE WILDSHARD
const coldLaunchCode = `try{${fixtureStorageCode('session')}.removeItem('life.alive');${fixtureStorageCode('device')}.removeItem('life.alive.once');}catch{}`;
const fixture = (tier) => [
  coldLaunchCode,
  frameFloorSettingsCode({ ...settings, tier }),
  saveFixtureCode({ scope: 'global', key: 'gfx', data: { dpr: '2', aa: 'auto' } }),
  saveFixtureCode({ scope: 'device', key: 'devMode', data: developer === 'on' }),
  ...Object.entries(deviceSaves).map(([key, data]) => saveFixtureCode({ scope: 'device', key, data })),
  ...(publicGrid ? [publicGridIntentCode({instance:'driftwood-isle',slug:'driftwood-isle'})] : []),
].join(';');
const fixtureCheck = `(${assertFrameFloorFixture.toString()})(${JSON.stringify({ ...settings, tier: 'phone' })},${developer === 'on'},${JSON.stringify(deviceSaves)})`;
const query = (shard) => (shard === 'grid' && !publicGrid ? '?mute=1&nolock=1&sw=0' : `?chunk=${encodeURIComponent(shard === 'grid' ? 'driftwood-isle' : shard)}&mute=1&skipintro=1&nolock=1&sw=0`); // the public pre-release probe seeds only the existing intent
const errorText = (e) => e instanceof Error ? e.message : String(e);

// Jake's SF0 clarification (2026-10-04): allow vsync quantization, retain the original strict verdict.
function assess(result, measuredOn, drawContext) {
  const context = drawContext ?? { tier: chromiumPhone || measuredOn === 'sim' ? 'phone' : 'desktop', cpuRate: chromiumCpuRate, drawBudgetMode };
  const surfaceName = measuredOn === 'desktop' && context.tier === 'phone' ? 'chromium-phone' : measuredOn;
  const floorFps = surfaceName === 'desktop' ? 60 : 30;
  // The milestone gates every observed frame, including spawn, short travel and interiors.
  const maxFrameLimitMs = surfaceName === 'desktop' ? 100 : 200;
  const maxFramePass = Number.isFinite(result.maxMs) && result.maxMs <= maxFrameLimitMs;
  const strictMs = surfaceName === 'desktop' ? 16.7 : 33.3;
  const limitMs = surfaceName === 'desktop' ? 17.5 : 35;
  const medianFpsRounded = Math.round(result.medianFps);
  const cpuLimitMs = 1000 / floorFps / 4;
  const cpuPass = result.cpu?.enabled === true && result.cpu.frames === result.frames && result.cpu.owners.length > 0 && result.cpu.owners.every(owner => Number.isFinite(owner.p95Ms) && owner.p95Ms <= cpuLimitMs);
  const valid = result.skipped === 0 && result.contextLost === false;
  const drawBudget = assessDrawBudget(result.drawSamples, result.frames, softwareCensus === null ? context : {...context, tier: 'software-diagnostic'});
  const drawPass = context.drawBudgetMode === 'report-only' || drawBudget.pass;
  const pass = drawPass && valid && cpuPass && maxFramePass && medianFpsRounded >= floorFps && result.p95Ms <= limitMs;
  const strictP95Pass = result.p95Ms <= strictMs;
  const strictPass = drawPass && valid && maxFramePass && medianFpsRounded >= floorFps && strictP95Pass;
  const miss = pass ? null : (context.drawBudgetMode === 'report-only' ? null : drawBudget.miss) ?? (!valid ? 'invalid measurement' : !cpuPass ? 'content CPU share / missing ownership measurement' : !maxFramePass ? `long frame: max ${result.maxMs} ms > ${maxFrameLimitMs} ms` : result.p95Ms > limitMs || result.medianFps < floorFps * 0.95 || result.workP95Ms > 1000 / floorFps ? 'frame cost / scheduling' : 'timing quantization');
  return { drawBudget, floorFps, medianFpsRounded, strictMs, limitMs, cpuLimitMs, cpuPass, maxFrameLimitMs, maxFramePass, pass, strictP95Pass, strictPass, miss };
}
function grade(record) {
  record.criteria = { medianFps: 'Integer-rounded median >= 60 desktop / >= 30 Simulator; raw medianFps retained', p95Ms: '<= 17.5 desktop / <= 35.0 Simulator; 1.05 times the nominal frame period', strictP95Ms: '<= 16.7 desktop / <= 33.3 Simulator', drawBudget: record.softwareCensus === undefined ? `${record.drawBudgetMode === 'report-only' ? 'Report-only' : 'Enforced'}. Phone: every observed frame <=150 draws including shadow/post/held; paired render CPU <=30 us/draw only at measured Chromium 4x; no extrapolation` : 'Software diagnostic spawn census only: no phone-budget or official timing credit; actual resolution and paired samples retained', cpu: 'Each trusted content owner p95 <= one quarter frame: 4.167 ms desktop / 8.333 ms Simulator; shell and harness observers excluded', maxFrameMs: 'Every observed row: max <= 100 ms desktop / <= 200 ms Simulator' };
  for (const result of record.results) for (const shard of result.rows) {
    for (const row of shard.rows ?? []) Object.assign(row, assess(row, result.surface, { tier: record.softwareCensus === undefined ? shard.metadata?.settings?.tier ?? record.settings?.tier ?? (result.surface === 'sim' ? 'phone' : 'desktop') : 'software-diagnostic', cpuRate: result.surface === 'desktop' ? record.chromiumCpuRate ?? 1 : 1, drawBudgetMode: record.drawBudgetMode ?? 'enforce' }));
    if (shard.complete) shard.pass = !shard.runtimeFailure && (shard.rows ?? []).every((row) => row.pass) && shard.errors.length === 0;
  }
  record.complete = record.results.every((result) => result.rows.every((shard) => shard.complete));
  record.pass = record.complete && record.underTenMinutes && record.results.every((result) => result.rows.every((shard) => shard.pass));
  return record;
}
function printVerdict(record) {
  for (const surfaceResult of record.results) for (const shard of surfaceResult.rows) {
    const misses = (shard.rows ?? []).filter((row) => !row.pass).map((row) => `${row.pose.name}: ${row.medianFps} fps / p95 ${row.p95Ms} ms (${row.miss})`);
    console.log(`${surfaceResult.surface} ${shard.shard}: ${shard.pass ? 'PASS' : 'FAIL'}${misses.length > 0 ? ` — ${misses.join('; ')}` : shard.error ? ` — ${shard.error}` : ''}`);
  }
}

// All browser-side helpers execute identically in Chromium and Mobile Safari, with real time and live gameplay.
function status() {
  const w = window.__wildshard?.world;
  // A boot failure renders the shell's load-failure screen (src/client/engine/ui/errorScreen.ts) without a game: fail fast with its message.
  const failure = document.querySelector('.ws-load-error');
  return { ready: Boolean(w?.game && !document.querySelector('.ws-load')), error: document.querySelector('#wserr .msg')?.textContent ?? (failure ? `Load failure: ${[...failure.querySelectorAll('h1,p')].map(node => node.textContent).join(' — ')}` : undefined),
    level: w?.game.level.id, clock: w?.game.app.clock.mode, entered: w?.hud?.entered };
}
function metadata() {
  const w = window.__wildshard.world, g = w.game, gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const saved = JSON.parse(localStorage.getItem('wildshard.save.v2@1.global') ?? '{}');
  const deviceSaved = JSON.parse(localStorage.getItem('wildshard.save.v2@1.device') ?? '{}');
  return { renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    entrySettle: performance.getEntriesByName('wildshard.entry.programs-settled')[0]?.detail ?? null, entryControls: performance.getEntriesByName('wildshard.grid.entry-policy')[0]?.startTime ?? null,
    viewport: [innerWidth, innerHeight], devicePixelRatio, renderScale: g.renderer.getPixelRatio(), canvas: [g.canvas.width, g.canvas.height], developer: Object.hasOwn(document.documentElement.dataset,'dev'),
    settings: saved.keys?.settings?.data, effectiveDebugSettings: window.__wildshard.debugSettings?.() ?? null, settingsReset: 'replace-settings-and-clear-debug-overrides', gfx: saved.keys?.gfx?.data, deviceSaves: Object.fromEntries(Object.entries(deviceSaved.keys ?? {}).map(([key, value]) => [key, value.data])), clock: g.app.clock.mode,
    fixtureWrites: window.__frameFloorFixtureWrites?.finish() ?? null,
    bootTrace: deviceSaved.keys?.['boot.trace']?.data, console: window.__frameFloorConsole ?? [],
    textures: window.__wildshard.textures?.() ?? null,
    systems: Object.values(g.app.systemsByPhase()).flat().map((system) => system.id),
    spawn: { name: 'spawn', x: w.player.position.x, y: w.player.position.y, z: w.player.position.z, yaw: w.player.yaw, pitch: w.player.pitch }, userAgent: navigator.userAgent };
}
async function cameras() {
  const authored = await window.__wildshard.world.game.level.capturePoses?.() ?? {};
  return Object.entries(authored).flatMap(([name, c]) => c.probe ? [{ ...c.probe, name: c.probe.name ?? name }] : c.feet ? [{ name, x: c.feet[0], y: c.feet[1], z: c.feet[2], yaw: -c.yaw * Math.PI / 180, pitch: c.pitch * Math.PI / 180 }] : []);
}
/** `n` drawn frames; n = 0: every frame until `window.__frameFloorDriveDone` is set and no runtime hook is running
 *  (the whole drive, then whatever its cells still build after it: Pine's afterKit outlived the 120-frame travel row). */
function sample(n, timeline = false) {
  const g = window.__wildshard.world.game, meter = g.app?.cpu;
  const whole = n === 0;
  if (!meter) return Promise.reject(new Error('Content CPU meter unavailable; use an SF62-capable pin'));
  meter.enabled = true;
  return new Promise((resolve, reject) => {
    const drawSamples = [];
    const interval = [], longAt = [], slowAt = [], glAt = [], glUploadAt = [], callbackInterval = [], ring = [], work = [], calls = [], triangles = [], cpuOwners = new Map();
    const timelineFrames = [], timelineLimit = 8000;
    let idleChecks = 0, checkedAt = -1, glPrevious = null;
    const finished = () => {
      if (!whole) return interval.length >= n;
      if (window.__frameFloorDriveDone !== true || interval.length === checkedAt || interval.length % 30 !== 0) return false;
      checkedAt = interval.length;
      const current = window.__wildshard.shard.grid?.state().live.runtimeTiming?.current ?? null;
      idleChecks = current === null ? idleChecks + 1 : 0;
      return idleChecks >= 2;
    };
    let cpuFrames = 0, cpuFrame = -1;
    let count = g.frameCount, last = 0, lastCallback = 0, skipped = 0, first = true, firstTimestamp = 0;
    let raf = 0;
    const timeout = setTimeout(() => { cancelAnimationFrame(raf); reject(new Error(`Drawn-frame sampler stalled (${interval.length}/${n})`)); }, whole ? 240000 : 30000);
    const tick = (timestamp) => {
      const now = performance.now();
      if (g.frameCount !== count) {
        // Only the whole drive drains GL counters: the simultaneous short sampler must not steal calls.
        const delta = g.frameCount - count, glFrame = whole ? window.__frameFloorGlTake?.() ?? null : null;
        // GL is taken at the END of each interval; a long interval's own cause is usually the frame drawn at its START
        // (its render ran before the next vsync could come), so a long frame also keeps that start frame's take.
        const glStart = glPrevious; glPrevious = glFrame;
        const uploads = whole ? window.__frameFloorGlUploadsTake?.() ?? null : null;
        if (uploads !== null && !first && glUploadAt.length < 8000) glUploadAt.push([Math.round(last), uploads]);
        if (glFrame !== null && !first && glAt.length < 8000) glAt.push([Math.round(last), glFrame]);
        if (!first) {
          // rAF's shared vsync timestamp grades drawn cadence; callback time also includes preceding game work.
          interval.push(timestamp - last); if (whole && timestamp - last > 35 && slowAt.length < 2000) slowAt.push([Math.round(last), Math.round(timestamp - last)]); if (timestamp - last > 50 && longAt.length < 400) longAt.push(glFrame === null ? [Math.round(last), Math.round(timestamp - last)] : [Math.round(last), Math.round(timestamp - last), glFrame, glStart ?? {}]); callbackInterval.push(now - lastCallback); skipped += Math.max(0, delta - 1);
          const i = (g.frameI + g.frameMs.length - 1) % g.frameMs.length;
          ring.push(g.frameMs[i]); work.push(g.workMs[i]); calls.push(g.lastFrame.calls); triangles.push(g.lastFrame.triangles);
          drawSamples.push({ drawnFrame: g.frameCount, draws: g.lastFrame.calls, renderMs: g.renderMs[i] });
          if (timeline && timelineFrames.length < timelineLimit) timelineFrames.push({
            // These are completed-draw identities at the interval's two ends,
            // not array indices: a skipped draw must not shift diagnostic joins.
            drawnFrame: g.frameCount, priorDrawnFrame: count,
            startMs: last, endMs: timestamp, intervalMs: timestamp - last,
            callbackAtMs: now, callbackDelayMs: now - timestamp, callbackIntervalMs: now - lastCallback,
            gameRafMs: g.frameRafTime, frameDelta: delta,
            updateMs: g.updateMs[i], renderMs: g.renderMs[i], workMs: g.workMs[i],
          });
          const cpu = meter.snapshot();
          if (cpu.enabled && cpu.frame > cpuFrame && cpu.owners.length > 0) {
            cpuFrame = cpu.frame; cpuFrames++;
            for (const owner of cpu.owners) {
              if (!cpuOwners.has(owner.id)) cpuOwners.set(owner.id, { ms: [], calls: 0 });
              const row = cpuOwners.get(owner.id); row.ms.push(owner.ms); row.calls += owner.calls;
            }
          }
        }
        if (first) firstTimestamp = timestamp;
        first = false; count = g.frameCount; last = timestamp; lastCallback = now;
      }
      if (!finished()) { raf = requestAnimationFrame(tick); return; }
      clearTimeout(timeout);
      const pct = (v, p) => { const sorted = [...v].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]; };
      const round = (v) => Math.round(v * 1000) / 1000;
      resolve({ drawSamples, sampleRange: { startMs: round(firstTimestamp), endMs: round(last) }, frames: interval.length, skipped, medianFps: round(1000 / pct(interval, 0.5)), p50Ms: round(pct(interval, 0.5)),
        p95Ms: round(pct(interval, 0.95)), p99Ms: round(pct(interval, 0.99)), maxMs: round(pct(interval, 1)),
        // Retain the tail only after the sample ends; no additional frame observer or metric is needed.
        worstFrameMs: [...interval].sort((a, b) => b - a).slice(0, 6).map(round),
        callbackP95Ms: round(pct(callbackInterval, 0.95)), callbackP99Ms: round(pct(callbackInterval, 0.99)), callbackMaxMs: round(pct(callbackInterval, 1)),
        // a freeze is one frame of thousands: p95 / p99 never see it, so a long window also counts its long frames
        longFrames: { over50Ms: interval.filter((ms) => ms > 50).length, over100Ms: interval.filter((ms) => ms > 100).length, at: longAt }, ...(whole ? { slowFrames: slowAt } : {}), ...(glAt.length === 0 ? {} : { glFrames: glAt }),
        ...(glUploadAt.length === 0 ? {} : { glUploadFrames: glUploadAt }),
        gameP95Ms: round(pct(ring, 0.95)), workP95Ms: round(pct(work, 0.95)), calls: pct(calls, 0.5), triangles: pct(triangles, 0.5),
        position: { x: window.__wildshard.world.player.position.x, y: window.__wildshard.world.player.position.y, z: window.__wildshard.world.player.position.z },
        cpu: { enabled: meter.snapshot().enabled, frames: cpuFrames, owners: [...cpuOwners].map(([id, row]) => ({ id, samples: row.ms.length, p95Ms: pct(row.ms, 0.95), maxMs: pct(row.ms, 1), calls: row.calls })) },
        ...(timeline ? { frameTimeline: { limit: timelineLimit, droppedFrames: interval.length - timelineFrames.length,
          clock: 'Page performance milliseconds; callback is the sampler, not the whole rAF batch. Update/render/work belong to the latest Game frame; frameDelta > 1 omits intermediate work.',
          frames: timelineFrames } } : {}),
        contextLost: g.renderer.getContext().isContextLost() });
    };
    raf = requestAnimationFrame(tick);
  });
}

/** the whole-drive sampler's expression (`sample(0)`) */
const SAMPLE_WHOLE = `(${sample.toString()})(0,${frameTimeline})`;

// Runtime.evaluate on Safari does not await JavaScript promises. Poll an explicit result envelope;
// Target.* multiplexing is supported; a new document invalidates the measurement rather than replaying it.
let evalSequence = 0;
let evaluationOriginDriftMaxMs = 0;
function evaluator(raw, observe = () => undefined) {
  return async (expression, timeout = 35000) => {
    const key = `__frameFloorEval${++evalSequence}`;
    const origin = JSON.parse(await raw(`globalThis[${JSON.stringify(key)}] = {done:false}; Promise.resolve().then(() => (${expression})).then(value => {globalThis[${JSON.stringify(key)}] = {done:true,value};}, error => {globalThis[${JSON.stringify(key)}] = {done:true,error:String(error)};}); JSON.stringify((${gridFloorDocumentIdentity.toString()})())`));
    const start = Date.now();
    let progressCursor = null;
    try {
      while (Date.now() - start < timeout) {
        // The ledger already samples once a second, but serializing its unchanged
        // claims on every 100 ms result poll creates avoidable diagnostic garbage.
        const value = await raw(`(() => { const progress=window.__frameFloorGridProgress?.() ?? null, previous=${JSON.stringify(progressCursor)};
          const unchanged=progress !== null && previous !== null && progress.sampledAt === previous.sampledAt
            && (progress.stop?.leg ?? null) === previous.leg && (progress.stop?.phase ?? null) === previous.phase;
          return JSON.stringify({identity:(${gridFloorDocumentIdentity.toString()})(),state:globalThis[${JSON.stringify(key)}] ?? null,progress:unchanged ? null : progress}); })()`);
        const envelope = typeof value === 'string' ? JSON.parse(value) : null;
        if (envelope?.identity?.token !== origin.token) throw Object.assign(new Error('Frame floor document changed during evaluation (navigation or graphics recovery); measurement cannot continue'), { documentOrigin: envelope?.identity?.timeOrigin });
        evaluationOriginDriftMaxMs = Math.max(evaluationOriginDriftMaxMs, Math.abs(envelope.identity.timeOrigin - origin.timeOrigin));
        if (envelope.progress) {
          observe(envelope.progress);
          progressCursor = {sampledAt: envelope.progress.sampledAt, leg: envelope.progress.stop?.leg ?? null, phase: envelope.progress.stop?.phase ?? null};
        }
        const state = envelope.state;
        if (state?.done) { if (state.error) throw new Error(state.error); return state.value; }
        await sleep(100);
      }
      throw new Error(`Browser evaluation timed out: ${expression.slice(0, 80)}`);
    } finally { await raw(`delete globalThis[${JSON.stringify(key)}]`).catch(() => { /* A navigated page may have dropped the evaluation envelope. */ }); }
  };
}
async function waitReady(evaluate) {
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const state = await evaluate(`(${status.toString()})()`);
    if (state.error) throw new Error(state.error);
    if (state.ready) return;
    await sleep(200);
  }
  throw new Error('Game loading did not finish within 90 seconds');
}
/** The title's INFINITE WILDSHARD tap (shown with Developer on), then the grid page: its session readout and the world entered. */
async function enterGrid(driver) {
  const start = Date.now();
  if (publicGrid) {
    while (Date.now() - start < 240000) {
      const state = await driver.evaluate(`(() => { const s = (${status.toString()})(); return { ...s, grid: window.__wildshard?.shard?.grid !== undefined }; })()`);
      if (state.error) throw new Error(state.error);
      if (state.ready && state.grid) { await driver.evaluate('(window.__wildshard.world.hud.enterNow(), true)'); return; }
      await sleep(300);
    }
    throw new Error('Public grid did not finish loading within 240 seconds');
  }
  while (!(await driver.evaluate("Boolean(document.querySelector('.ws-main-grid'))").catch(() => false))) {
    if (Date.now() - start > 90000) throw new Error('The title never showed INFINITE WILDSHARD');
    await sleep(300);
  }
  await sleep(800);
  await handoffFloorGridNavigation(driver);
  const entryReadFailures = [];
  while (Date.now() - start < 240000) {
    const state = await driver.evaluate(`(() => { const s = (${status.toString()})(); return { ...s, grid: window.__wildshard?.shard?.grid !== undefined }; })()`).catch(error => {
      entryReadFailures.push({ elapsedMs: Date.now() - start, error: errorText(error), ...(error?.cause === undefined ? {} : { cause: errorText(error.cause) }) });
      return null; // mid-navigation; retain Inspector failures separately from game readiness
    });
    if (state?.error) throw new Error(state.error);
    if (state?.ready && state.grid) { await driver.evaluate('(window.__wildshard.world.hud.enterNow(), true)'); return; }
    await sleep(300);
  }
  throw Object.assign(new Error('The grid did not finish loading within 240 seconds'), { entryReadFailures });
}
/** Reject a standing row displaced by a readiness wall or recovery after camera scans. */
function assertStandingPosition(pose, result) {
  const distance = Math.hypot(result.position.x - pose.x, result.position.z - pose.z);
  if (!Number.isFinite(distance) || distance > 2) throw new Error(`Standing pose ${pose.name} moved from (${pose.x}, ${pose.z}) to (${result.position.x}, ${result.position.z})`);
}

/** Profile the exact standing window on either surface, with no timing credit for diagnostics. */
async function standingSample(driver, pose) {
  if (taskClock) await driver.evaluate('(window.__frameFloorTaskTake?.(), true)');
  const started = driver.profile ? await driver.profile.start() : null;
  const traceAnchor = driver.trace ? await driver.trace.start(pose.name) : null;
  const stopScript = driver.scriptProfile && safariWindow === null && safariSteadyPose === '' && safariDrive === '' && safariPrefix === '' ? await driver.scriptProfile.start() : undefined;
  let result, raw, script;
  try { result = await driver.evaluate(`(${sample.toString()})(${frames},${frameTimeline})`); }
  finally {
    if (stopScript !== undefined) script = await stopScript();
    if (driver.profile && started !== null) raw = await driver.profile.stop();
    if (driver.trace && traceAnchor !== null) await driver.trace.stop(traceAnchor, result?.longFrames?.at ?? [], []);
  }
  if (taskClock) result.taskClock = await driver.evaluate('window.__frameFloorTaskTake?.() ?? null');
  assertStandingPosition(pose, result);
  if (raw !== undefined) { await saveProfileMaps(raw); writeFileSync(join(cpuProfileDir, `${pose.name}-${Date.now()}.cpuprofile`), JSON.stringify(raw)); }
  const cpuProfile = raw === undefined ? undefined : summarizeTravelProfile(raw, started, await driver.evaluate('window.__frameFloorLongTasks ?? []'), pose.name);
  const scriptProfile = script === undefined ? undefined : await saveSafariProfile(pose.name, script, result.sampleRange);
  const { glFrames, ...value } = result;
  // Detached logical pool capacity after timing, never a physical-residency
  // estimate. Older app pins remain null; no constructor observer is needed.
  const scriptMemoryPool = await driver.evaluate(SCRIPT_MEMORY_POOL);
  // Fixed grid poses retain the actual assembly after timing, so a junction
  // reading can prove its pitch/neighbours without another browser or scene walk.
  const gridContext = suppliedStanding === null ? undefined : await driver.evaluate(`(() => {
    const grid = window.__wildshard.shard.grid?.state();
    if (grid === undefined) return null;
    const live = grid.live?.live;
    return { pitch: grid.pitch, home: grid.home, cells: grid.cells,
      current: live?.current ?? null, residents: live?.residents ?? [], pending: live?.pending ?? [],
      pendingWork: live?.pendingWork, worldFeet: live?.worldFeet, gameplayReady: live?.gameplayReady,
      crossing: grid.live?.crossing?.phase ?? null };
  })()`);
  if (gridContext !== undefined && gridContext !== null) Object.assign(gridContext, frameFloorPending(gridContext));
  const assessed = assess(value, surface);
  // The caller-fixed junction bar does not treat the initial spawn's ordinary
  // neighbour warm-up as a settled junction. Every later world/unknown request
  // still refuses; only G872's evidenced optional metadata is listed apart.
  const pendingPass = pose.name === 'spawn' || gridContext === undefined || gridContext === null || gridContext.pendingWorld.length === 0;
  return { pose, ...value, ...assessed, pass: assessed.pass && pendingPass, scriptMemoryPool, ...(glFrames === undefined ? {} : { glByHook: glByHook(glFrames, []) }),
    ...(gridContext === undefined ? {} : {gridContext}),
    ...(cpuProfile === undefined ? {} : { cpuProfile }), ...(scriptProfile === undefined ? {} : { scriptProfile }) };
}

/** Keep Safari's untimed samples and their exact caller window, never inventing per-task durations. */
async function saveSafariProfile(name, profile, pageRange, file = join(safariProfileDir, `${name}-${Date.now()}.scriptprofile.json`)) {
  writeFileSync(file, JSON.stringify({ profile, pageRange }));
  const urls = new Set((profile.samples?.stackTraces ?? []).flatMap(trace => trace.stackFrames.map(frame => frame.url)).filter(url => /^https?:.*\.js$/u.test(url)));
  await saveScriptMaps(urls, safariProfileDir);
  return { file, note: 'Diagnostic Safari samples in the caller-delimited page window. Proxy timestamps may be zero; no per-task timing or floor credit.' };
}

async function measureShard(driver, shard, deadline) {
  const start = Date.now(), floorMs = surface === 'sim' ? 33.3 : 16.7;
  const rows = [], scenarios = [];
  let meta, measurement;
  try {
    await driver.load(shard);
    if (shard === 'grid') await enterGrid(driver);
    await waitReady(driver.evaluate);
    await driver.beginMeasurement?.();
    const documentOrigin = await driver.evaluate(`(${gridFloorDocumentIdentity.toString()})()`);
    if (shard === 'grid' && gridScenario !== 'baseline') await driver.evaluate(`(${installFloorGridProgress.toString()})()`);
    await sleep(settleMs);
    meta = await driver.evaluate(`(${metadata.toString()})()`);
    if (meta.developer !== (developer === 'on') || meta.deviceSaves.devMode !== (developer === 'on') || meta.clock !== 'live' || meta.renderScale !== (surface === 'desktop' && !chromiumPhone ? Math.min(desktopDpr, 2) : 2) || meta.settings.tier !== settings.tier || meta.settings.fps !== 'auto' || Object.entries(picks).some(([key, value]) => meta.settings[key] !== value) || Object.entries(deviceSaves).some(([key, value]) => meta.deviceSaves[key] !== value)) throw new Error(`Invalid measurement configuration: ${JSON.stringify(meta)}`);
    for (const expected of expectedSystems.filter((row) => row.shard === shard)) if (meta.systems.includes(expected.id) !== expected.present) throw new Error(`Activation witness failed: ${expected.id} expected ${expected.present ? 'on' : 'off'}; installed ${meta.systems.join(', ')}`);
    if (surface === 'sim' && (meta.viewport[0] >= meta.viewport[1] || !meta.userAgent.includes('iPhone'))) throw new Error('Simulator must be portrait iPhone Safari');
    if (surface === 'desktop') assertFrameFloorRenderer(meta.renderer, { ...chromiumBackend, reportOnly: drawBudgetOn && drawBudgetMode === 'report-only', platform: process.platform });
    if (publicGrid) {
      meta.publicGrid = await driver.evaluate(`(${readPublicGridWitness.toString()})()`);
      const failures = publicGridWitnessFailures(meta.publicGrid, false);
      if (failures.length > 0) throw new Error(failures.join('; '));
    }
    // Measure the actual boot spawn before camera scans can retire its cell. A later teleport into
    // an unloaded home is refused/recovered onto the road; labelling that row 'spawn' hid the wrong view.
    // G823: give this pose its own post-boot settle, just as each standing pose gets after placement.
    await sleep(settleMs);
    const spawnRow = await standingSample(driver, meta.spawn); rows.push(spawnRow);
    console.log(`${surface} ${shard} spawn: ${spawnRow.medianFps} fps, p95 ${spawnRow.p95Ms} ms, p99 ${spawnRow.p99Ms} ms — ${spawnRow.pass ? 'PASS' : 'FAIL'}`);
    if (drawBudgetOn) console.log(frameFloorDrawConsole(shard, 'spawn', spawnRow.frames, spawnRow.drawBudget, meta.renderer));
    if (softwareCensus !== null) {
      if (meta.viewport[0] !== 201 || meta.viewport[1] !== 437 || meta.canvas[0] !== 402 || meta.canvas[1] !== 874)
        throw new Error('Software census diagnostic resolution differs');
      console.log(`Software census ${shard}: CSS ${meta.viewport.join('x')}; canvas ${meta.canvas.join('x')}; ${frames} native spawn frames; no phone-budget or official timing credit`);
      const errors = await driver.errors();
      return {shard, complete: true, pass: rows.every(row => row.pass) && errors.length === 0, seconds: (Date.now() - start) / 1000,
        floorMs, evaluationOriginDriftMaxMs, cpuPhase: driver.cpuPhase?.() ?? null, metadata: meta,
        cameraSource: 'software diagnostic native spawn only', scan: [], rows, scenarios, lastRoute: driver.progress(), errors};
    }
    // O11: the outer road starts with no inner cell admitted; deck-east stands on Nine's boulevard and admits it. O17: a
    // cold entry likewise approaches its cell with no standing pose beside it first
    const gridPoses = shard === 'grid' && !['outer-road', 'cold', 'nine-return', 'sky-cycle'].includes(gridScenario)
      ? gridFloorPoses(await driver.evaluate('(() => { const pitch = window.__wildshard.shard.grid.state().pitch; return pitch === undefined ? 555 : pitch; })()')) : [];
    const declared = suppliedStanding?.[shard] ?? [...await driver.evaluate(`(${cameras.toString()})()`), ...gridPoses];
    const candidates = declared.length > 0 ? declared : [{ ...meta.spawn, name: 'spawn-reverse', yaw: meta.spawn.yaw + Math.PI }];
    const scan = [];
    for (const pose of candidates) {
      if (Date.now() > deadline) throw new Error('Ten-minute run budget exhausted');
      await driver.evaluate(`window.__wildshard.pose(${JSON.stringify(pose)})`);
      await sleep(500);
      const result = await driver.evaluate(`(${sample.toString()})(24,${frameTimeline})`);
      scan.push({ pose, p95Ms: result.p95Ms, workP95Ms: result.workP95Ms, calls: result.calls, triangles: result.triangles });
    }
    // Rank authored standing parity cameras on the surface itself; no shard-name camera table to go stale.
    const heaviest = suppliedStanding !== null ? scan : standingPoses.length === 0 ? [...scan].sort((a, b) => b.p95Ms - a.p95Ms || b.workP95Ms - a.workP95Ms || b.triangles - a.triangles).slice(0, 2)
      : standingPoses.map(name => { const row = scan.find(candidate => candidate.pose.name === name); if (row === undefined) throw new Error(`Missing authored standing pose: ${name}`); return row; });
    for (const pose of heaviest.map((r) => r.pose)) {
      if (Date.now() > deadline) throw new Error('Ten-minute run budget exhausted');
      await driver.evaluate(`window.__wildshard.pose(${JSON.stringify(pose)})`);
      await sleep(settleMs);
      const result = await standingSample(driver, pose);
      rows.push(result);
      console.log(`${surface} ${shard} ${pose.name}: ${result.medianFps} fps, p95 ${result.p95Ms} ms, p99 ${result.p99Ms} ms — ${rows.at(-1).pass ? 'PASS' : 'FAIL'}`);
      if (drawBudgetOn) console.log(frameFloorDrawConsole(shard, pose.name, result.frames, result.drawBudget, meta.renderer));
    }
    if (gpuBisectOn && shard !== 'grid') {
      const worst = [...rows].sort((a, b) => b.p95Ms - a.p95Ms)[0];
      const pose = worst === spawnRow ? meta.spawn : heaviest.find((r) => r.pose.name === worst.pose?.name)?.pose ?? meta.spawn;
      const away = heaviest.find((r) => r.pose.name !== pose.name)?.pose;
      if (away !== undefined) { await driver.evaluate(`window.__wildshard.pose(${JSON.stringify(away)})`); await sleep(settleMs); }
      await driver.evaluate(`window.__wildshard.pose(${JSON.stringify(pose)})`);
      worst.settleTrace = await driver.evaluate(`(${settleTrace.toString()})(240)`, 120000);
      const slow = worst.settleTrace.map((r, i) => ({ i, ...r })).filter((r) => r.ms > 36);
      console.log(`  settle: ${worst.settleTrace.length} frames, ${slow.length} over 36 ms; last slow at frame ${slow.at(-1)?.i ?? -1}`);
      for (const r of slow.slice(0, 30)) console.log(`   #${r.i} ${r.ms} ms work ${r.work} calls ${r.calls} buf ${r.bufferBytes} ${JSON.stringify(r.gl)}\n     passes ${r.passes.join(' ')}\n     owners ${JSON.stringify(r.owners)}`);
      const calm = worst.settleTrace.find((r) => r.ms < 34);
      if (calm !== undefined) console.log(`   calm ${calm.ms} ms calls ${calm.calls}\n     passes ${calm.passes.join(' ')}\n     owners ${JSON.stringify(calm.owners)}`);
      worst.gpuBisect = await driver.evaluate(`(${gpuBisect.toString()})(60)`, 240000);
      for (const v of worst.gpuBisect) console.log(`  bisect ${v.variant}: p50 ${v.p50Ms} p95 ${v.p95Ms} work ${v.workP95Ms} calls ${v.calls}${v.census ? ` ${JSON.stringify(v.census)}` : ''}`);
    }
    if (shard === 'grid' && gridScenario !== 'baseline') {
      // Standing camera probes did not cross: reset only the initial source pose, then use real input at every seam.
      const state = await driver.evaluate('window.__wildshard.shard.grid.state()');
      for (let plan of selectFloorGridPlans(publicGrid ? publicGridPlans(state) : gridFloorPlans(state, gridScenario, { cell: gridCell, roadApproach, entrySocket, ...(risingIslet === '' ? {} : { risingIslet }) }), gridRoutes)) {
        if (Date.now() > deadline) throw new Error('Ten-minute run budget exhausted');
        // nine-return also leaves Nine by its declared portal (a plan from a cell to the road)
        if ((['milestone', 'reentry', 'cell', 'cold', 'sky-cycle'].includes(gridScenario) && plan.from === null) || (gridScenario === 'nine-return' && (plan.from === null || plan.to === null))) {
          const cell = state.cells.find(row => row.instance === (plan.from ?? plan.to));
          if (!cell) throw new Error('Floor entry cell missing');
          const path = `/shardfiles/${encodeURIComponent(cell.slug)}/shard.json`;
          const entries = await driver.evaluate(`(${readFloorGridEntryways.toString()})(${JSON.stringify(path)})`);
          plan = floorGridPortalPlan(plan, cell, entries, state.pitch === undefined ? 555 : state.pitch);
        }
        // Camera probes can leave the owned shell on the road. Finish source admission before measuring motion.
        await driver.evaluate(`(${stageFloorGrid.toString()})(${JSON.stringify(plan)},${JSON.stringify(documentOrigin)},(${driveFloorGrid.toString()}))`, 130000);
        const profileStart = driver.profile ? await driver.profile.start() : null;
        const traceAnchor = driver.trace ? await driver.trace.start(plan.name) : null;
        const stopScriptProfile = driver.scriptProfile && safariWindow === null && safariPrefix === '' && (safariSteadyPose === '' || safariDrive !== '') && (safariDrive === '' || safariDrive === plan.name) ? await driver.scriptProfile.start() : undefined;
        // Some Simulator Inspector targets time out on Timeline.start. Keep the
        // independent GL/task clocks, and mark the missing partition explicitly.
        let stopTimeline, timelineFailure;
        if (driver.timeline && webkitSteadyPose === '') {
          try { stopTimeline = await driver.timeline.start(); }
          catch (error) {
            timelineFailure = { valid: false, invalid: [errorText(error)], frames: [] };
            if (webkitTimelineDir !== '') {
              if (error instanceof TimelineRecordingError) writeFileSync(join(webkitTimelineDir, `${encodeURIComponent(plan.name)}.json`),
                JSON.stringify({ plan, timeline: error.timeline, failure: errorText(error), diagnostic: true }));
              throw error;
            }
          }
        }
        const prefixFile = join(safariProfileDir, `${plan.name}-prefix20s-${Date.now()}.scriptprofile.json`);
        const stopPrefix = driver.scriptProfile && safariPrefix === plan.name ? await driver.scriptProfile.prefix(capture => writeFileSync(prefixFile, JSON.stringify(capture))) : undefined;
        const windowSelected = safariWindow !== null && safariWindow.route === plan.name;
        const scriptMemoryBefore = await driver.evaluate(`(window.__frameFloorDriveDone = false, window.__frameFloorDriveFrom = performance.now(), ${windowSelected ? 'window.__frameFloorDriveFrom' : wasmConstructorsDir === '' ? 'true' : SCRIPT_MEMORY_POOL})`);
        const windowFile = join(safariProfileDir, `${plan.name}-window-${Date.now()}.scriptprofile.json`);
        const stopWindow = driver.scriptProfile && windowSelected ? await driver.scriptProfile.window(scriptMemoryBefore, safariWindow,
          capture => writeFileSync(windowFile, JSON.stringify(capture))) : undefined;
        if (taskClock) await driver.evaluate('(window.__frameFloorTaskTake?.(), true)');
        // the whole drive, and every runtime hook still building once it has arrived (the 120-frame travel row ends early)
        const wholeDrive = (async () => {
          try { return { value: await driver.evaluate(SAMPLE_WHOLE, 260000) }; }
          catch (error) { return { error: error instanceof Error ? error : new Error('Whole-drive sampler failed', { cause: error }) }; }
        })();
        const moving = (async () => {
          try { return { value: await driver.evaluate(`(${driveFloorGrid.toString()})(${JSON.stringify(plan)},${JSON.stringify(documentOrigin)})`, 160000) }; }
          catch (error) { return { error: error instanceof Error ? error : new Error('Grid floor drive failed', { cause: error }) }; }
        })();
        await sleep(1000);
        let motion, driven, whole, profile, timeline, earlyPlay, prefixRange, scriptMemoryAfter, timelineDriveFailure;
        try {
          motion = await driver.evaluate(`(${sample.toString()})(${frames},${frameTimeline})`);
          driven = await moving; if (driven.error) throw driven.error;
          scriptMemoryAfter = await driver.evaluate(`(window.__frameFloorDriveDone = true, ${wasmConstructorsDir === '' ? 'true' : SCRIPT_MEMORY_POOL})`);
          whole = await wholeDrive; if (whole.error) throw whole.error;
          // A drive-only selection extends through twenty entered-play seconds.
          // A matching steady selection instead starts its own later profile.
          if (stopScriptProfile !== undefined && safariDrive === plan.name && safariSteadyPose === '')
            earlyPlay = await driver.evaluate(STEADY_SCRIPT_WINDOW, 35000);
        } catch (error) { timelineDriveFailure = errorText(error); throw error; }
        finally {
          try {
            if (stopWindow !== undefined) {
              const selected = await stopWindow();
              if (selected !== undefined) { profile = selected.profile; prefixRange = selected.pageRange; }
            } else if (stopPrefix !== undefined) { const prefix = await stopPrefix(); profile = prefix.profile; prefixRange = prefix.pageRange; }
            else if (stopScriptProfile !== undefined) profile = await stopScriptProfile();
          } finally {
            if (stopTimeline !== undefined) {
              timeline = await stopTimeline();
              if (webkitTimelineDir !== '') writeFileSync(join(webkitTimelineDir, `${encodeURIComponent(plan.name)}.json`), JSON.stringify({
                plan, timeline, frames: whole?.value?.longFrames?.at ?? [], sampleRange: whole?.value?.sampleRange,
                ...(timelineDriveFailure === undefined ? {} : { failure: timelineDriveFailure }), diagnostic: true,
              }));
            }
          }
        }
        const scriptProfile = profile === undefined ? undefined : await saveSafariProfile(plan.name, profile,
          prefixRange ?? (earlyPlay === undefined ? whole.value.sampleRange : { drive: whole.value.sampleRange, earlyPlay }),
          prefixRange === undefined ? undefined : windowSelected ? windowFile : prefixFile);
        const rawProfile = driver.profile && profileStart !== null ? await driver.profile.stop() : null;
        if (driver.trace && traceAnchor !== null) await driver.trace.stop(traceAnchor, whole.value.longFrames.at, await driver.evaluate('window.__wildshard.shard.grid.state().live.runtimeTiming?.completed ?? []'));
        if (rawProfile !== null) await saveProfileMaps(rawProfile);
        const cpuProfile = rawProfile === null ? null : summarizeTravelProfile(rawProfile, profileStart, await driver.evaluate('window.__frameFloorLongTasks ?? []'), plan.name);
        const witness = driven.value, failures = gridFloorWitnessFailures(witness);
        if (failures.length > 0) throw new Error(`${plan.name}: ${failures.join('; ')}`);
        scenarios.push(witness);
        // --gl-time on Safari: WebKit's own main-thread split of each long frame (idle / rendering update after rAF / tasks)
        const travelTimeline = timeline === undefined ? timelineFailure : timelineLongFrames(timeline, motion.longFrames.at);
        rows.push({ pose: { name: `grid-${plan.name}-travel` }, ...motion, ...assess(motion, surface), ...(travelTimeline === undefined ? {} : { webkitTimeline: travelTimeline }) });
        const hookTimes = await driver.evaluate('window.__wildshard.shard.grid.state().live.runtimeTiming?.completed ?? []');
        if (webkitTimelineDir !== '' && webkitSteadyPose === '') writeFileSync(join(webkitTimelineDir, `${encodeURIComponent(plan.name)}.json`), JSON.stringify({
          plan, timeline: timeline ?? timelineFailure, frames: whole.value.longFrames.at, hookTimes,
          sampleRange: whole.value.sampleRange, diagnostic: true,
        }));
        const { glFrames, ...wholeValue } = whole.value;
        const driveRow = { pose: { name: `grid-${plan.name}-drive` }, window: 'whole-drive', ...wholeValue, longFrameHooks: longFrameHooks(whole.value.longFrames.at, hookTimes),
          ...(wasmConstructorsDir === '' ? {} : { scriptMemoryPool: { before: scriptMemoryBefore, after: scriptMemoryAfter } }),
          over35Hooks: longFrameHooks(whole.value.slowFrames, hookTimes).map((row) => ({ hook: row.hook, frames: row.frames, maxMs: row.maxMs, totalMs: row.totalMs })),
          hookTimes: hookTimes.map((t) => ({ hook: `${t.instance}:${t.hook}`, start: Math.round(t.start), end: Math.round(t.end) })),
          ...(glFrames === undefined ? {} : { glByHook: glByHook(glFrames, hookTimes) }), ...(cpuProfile === null ? {} : { cpuProfile }), ...(scriptProfile === undefined ? {} : { scriptProfile }),
          ...(glTime && frameTimeline && glFrames !== undefined ? { glFrames } : {}),
          ...(timeline === undefined ? (timelineFailure === undefined ? {} : { webkitTimeline: timelineFailure }) : { webkitTimeline: timelineLongFrames(timeline, whole.value.longFrames.at) }),
          ...(glTime ? { entryPreparation: await driver.evaluate('window.__wildshard.world.game.entryPreparation') } : {}),
          ...(taskClock ? { tasks: await driver.evaluate('window.__frameFloorTaskTake?.() ?? []') } : {}) };
        rows.push(Object.assign(driveRow, assess(driveRow, surface)));
        await sleep(settleMs);
        const standing = await driver.evaluate(`(${sample.toString()})(${frames},${frameTimeline})`);
        witness.standingMemory = await driver.evaluate(`(() => { const grid = window.__wildshard.shard.grid, state = grid.state(), residency = grid.residency(); return {
          playingMB: state.playingMB, accountedBytes: state.accountedBytes, cost: residency.cost,
          l0: residency.claims.filter(claim => claim.category === 'l0').map(({ id, owner, accountedBytes }) => ({ id, owner, accountedBytes })),
          current: state.live.live.current, ringsRefused: state.rings.refused, issues: state.live.live.issues }; })()`);
        rows.push({ pose: { name: `grid-${plan.name}` }, ...standing, ...assess(standing, surface) });
        if (safariSteadyPose === `grid-${plan.name}`) {
          if (!driver.scriptProfile || rows.some(row => row.steadyScriptProfile)) throw new Error('Steady profile requires exactly one selected window');
          const stopSteady = await driver.scriptProfile.start();
          let steadyWindow, steadyProfile;
          try { steadyWindow = await driver.evaluate(STEADY_SCRIPT_WINDOW, 35000); }
          finally { steadyProfile = await stopSteady(); }
          rows.at(-1).steadyScriptProfile = await saveSafariProfile(`${safariSteadyPose}-steady20s`, steadyProfile, steadyWindow);
        }
        if (webkitSteadyPoses.includes(`grid-${plan.name}`)) {
          if (!driver.timeline || rows.some(row => row.pose.name === `grid-${plan.name}` && row.steadyTimeline)) throw new Error('Steady Timeline requires distinct selected windows');
          const reattach = ablationSelected ? await refreshAblationInspector(driver.refreshInspector, documentOrigin) : undefined;
          const stop = await driver.timeline.start();
          let window, steadyTimeline;
          try { window = await driver.evaluate(ablationSelected ? ABLATION_NORMAL : STEADY_TIMELINE_WINDOW, 35000); if (reattach !== undefined) window.inspectorReattach = reattach; }
          finally { steadyTimeline = await stop(); }
          const longIntervals = window.intervals.filter(([, ms]) => ms > 40);
          const file = join(webkitTimelineDir, `${encodeURIComponent(plan.name)}-steady20s.json`);
          writeFileSync(file, JSON.stringify({ diagnostic: true, plan, window, timeline: steadyTimeline, frames: longIntervals }));
          if (nativePressureDir !== '') {
            writeFileSync(join(nativePressureDir, `${encodeURIComponent(plan.name)}.json`), JSON.stringify({ window, probe: window.nativePressure }));
            if (!window.nativePressure || window.nativePressure.dropped !== 0 || window.nativePressure.observerErrors !== 0
              || window.nativePressure.support.some(row => row.available && !row.wrapped)) throw new Error('Native pressure observer is missing or incomplete');
          }
          if (window.dropped > 0 || ablationSelected && window.missedDraws !== 0) throw new Error('Steady Timeline frame intervals were truncated');
          rows.at(-1).steadyTimeline = { file, window, summary: timelineLongFrames(steadyTimeline, longIntervals) };
          if (ablationSelected) {
            const windows = [{mode: 'normal', file, window}];
            for (const phase of ablationPhases(pauseAblation)) {
              const { mode } = phase;
              if (phase.action !== null) await driver.evaluate(phase.action);
              await sleep(2000);
              const stopAblation = await driver.timeline.start();
              let captured, ablationTimeline;
              try { captured = await driver.evaluate(phase.expression, 35000); }
              finally { ablationTimeline = await stopAblation(); }
              const ablationFile = join(webkitTimelineDir, `${encodeURIComponent(plan.name)}-${mode}20s.json`);
              writeFileSync(ablationFile, JSON.stringify({diagnostic: true, plan, window: captured, timeline: ablationTimeline}));
              if (captured.dropped !== 0 || captured.missedDraws !== 0) throw new Error('Ablation interval capture incomplete');
              if (mode === 'paused' && (captured.frames !== 0 || captured.before.tick !== captured.after.tick)) throw new Error('Pause unexpectedly ticked or rendered');
              if (mode === 'buffers' && (!captured.allocation || captured.allocation.errors !== 0 || captured.allocation.dropped !== 0
                || captured.allocation.support.some(row => row.available && !row.wrapped))) throw new Error('Buffer probe incomplete');
              windows.push({mode, file: ablationFile, window: captured});
            }
            rows.at(-1)[pauseAblation ? 'pauseAblation' : 'bufferAblation'] = windows;
          }
        }
        if (jscGcDirectory !== '' && plan.name === 'nalati-interior') {
          const pidsBefore = jscGcProcessIds(process.env.SIM_UDID);
          const window = await driver.evaluate(STEADY_TIMELINE_WINDOW, 35000);
          const pidsAfter = jscGcProcessIds(process.env.SIM_UDID);
          const file = join(jscGcDirectory, 'settled20s.json');
          writeFileSync(file, JSON.stringify({diagnostic: true, plan, window, pidsBefore, pidsAfter,
            pageTimeOrigin: documentOrigin.timeOrigin, wallStartMs: documentOrigin.timeOrigin + window.startMs,
            wallEndMs: documentOrigin.timeOrigin + window.endMs, inspectorHeapEnabled: false}));
          if (window.dropped !== 0) throw new Error('Native GC window intervals truncated');
          rows.at(-1).nativeGcLog = {file, window, pidsBefore, pidsAfter};
        }
        if (gpuBisectOn) rows.at(-1).gpuBisect = await driver.evaluate(`(${gpuBisect.toString()})(60)`, 240000);
        console.log(`${surface} grid ${plan.name}: travel ${motion.medianFps} fps / ${motion.p95Ms} ms; whole drive ${whole.value.frames} frames, ${whole.value.medianFps} fps / p95 ${whole.value.p95Ms} / p99 ${whole.value.p99Ms} / max ${whole.value.maxMs} ms, ${whole.value.longFrames.over50Ms} frames > 50 ms (${driveRow.longFrameHooks.map((h) => `${h.hook} ${h.frames}×, max ${h.maxMs}`).join('; ')}); interior ${standing.medianFps} fps / ${standing.p95Ms} ms; residents=${witness.after.live.live.residents.join(',')}`);
      }
      if (gridCellPose !== null) {
        // the entered cell's own pose (its local frame), held standing once its runtime is ready again
        await driver.evaluate(`window.__wildshard.pose(${JSON.stringify(gridCellPose)})`);
        await driver.evaluate(`(async () => { const t = performance.now() + 120000; for (;;) { const l = window.__wildshard.shard.grid.state().live.live; if (l.current !== null && l.gameplayReady && l.pending.length === 0) return true; if (performance.now() > t) throw new Error('Grid cell pose never settled'); await new Promise((r) => { setTimeout(r, 100); }); } })()`, 130000);
        await sleep(settleMs);
        const posed = await driver.evaluate(`(${sample.toString()})(${frames},${frameTimeline})`);
        rows.push({ pose: gridCellPose, ...posed, ...assess(posed, surface) });
        console.log(`${surface} grid ${gridCellPose.name}: ${posed.medianFps} fps, p95 ${posed.p95Ms} ms — ${rows.at(-1).pass ? 'PASS' : 'FAIL'}`);
      }
    }
    if (publicGrid) {
      meta.publicGridFinal = await driver.evaluate(`(${readPublicGridWitness.toString()})()`);
      const failures = publicGridWitnessFailures(meta.publicGridFinal, true);
      if (failures.length > 0) throw new Error(failures.join('; '));
    }
    if (jscGcDirectory !== '' && !rows.some(row => row.nativeGcLog)) throw new Error('Native JSC GC settled Nalati window was not reached');
    if (webkitSteadyPoses.some(pose => !rows.some(row => row.pose.name === pose && row.steadyTimeline))) throw new Error(`Selected steady Timeline pose was not reached: ${webkitSteadyPose}`);
    if (safariSteadyPose !== '' && !rows.some(row => row.steadyScriptProfile)) throw new Error(`Selected steady profile pose was not reached: ${safariSteadyPose}`);
    if (safariDrive !== '' && !rows.some(row => row.pose.name === `grid-${safariDrive}-drive` && row.scriptProfile)) throw new Error(`Selected profile drive was not reached: ${safariDrive}`);
    if (safariPrefix !== '' && !rows.some(row => row.pose.name === `grid-${safariPrefix}-drive` && row.scriptProfile)) throw new Error(`Selected prefix drive was not reached: ${safariPrefix}`);
    if (safariWindow !== null && !rows.some(row => row.pose.name === `grid-${safariWindow.route}-drive` && row.scriptProfile)) throw new Error(`Selected sampling window was not reached: ${safariWindow.route}`);
    const errors = await driver.errors();
    measurement = { shard, complete: true, pass: rows.every((r) => r.pass) && errors.length === 0, seconds: (Date.now() - start) / 1000,
      floorMs, evaluationOriginDriftMaxMs, cpuPhase: driver.cpuPhase?.() ?? null, metadata: meta, cameraSource: suppliedStanding !== null ? 'caller fixed world poses; source and hash retained' : declared.length > 0 ? 'manifest standing parity cameras' : 'no declared parity cameras; reversed spawn fallback', scan, rows, scenarios, lastRoute: driver.progress(), errors };
  } catch (error) {
    console.error(`${surface} ${shard}: ${errorText(error)}`);
    let diagnosticError;
    const diagnostic = await driver.evaluate(`(() => { const app = window.__wildshard?.world?.game?.app; const saved = JSON.parse(localStorage.getItem('wildshard.save.v2@1.device') ?? '{}'); return { documentOrigin: performance.timeOrigin, lastEnd: saved.keys?.['life.lastEnd']?.data, lastUnload: saved.keys?.['life.lastUnload']?.data, url: location.href, readyState: document.readyState, state: app?.state, modal: document.querySelector('#wserr .msg')?.textContent, stack: document.querySelector('#wserr pre')?.textContent, loading: document.querySelector('.ws-load')?.textContent?.slice(-3000), bootTrace: saved.keys?.['boot.trace']?.data, systems: app ? Object.values(app.systemsByPhase()).flat().map(system => system.id) : [], console: window.__frameFloorConsole ?? [], resources: performance.getEntriesByType('resource').slice(-20).map(row => ({ name: row.name, duration: row.duration })) }; })()`).catch(diagnosticFailure => { diagnosticError = errorText(diagnosticFailure); return null; });
    const lastRoute = driver.progress(), runtimeFailure = gridFloorRuntimeFailure(lastRoute, diagnostic ?? { documentOrigin: error?.documentOrigin });
    measurement = { shard, complete: runtimeFailure !== null, pass: false, seconds: (Date.now() - start) / 1000, error: errorText(error),
      ...(error?.entryReadFailures === undefined ? {} : { entryReadFailures: error.entryReadFailures }), ...(diagnosticError === undefined ? {} : { diagnosticError }),
      evaluationOriginDriftMaxMs, cpuPhase: driver.cpuPhase?.() ?? null, ...(meta === undefined ? {} : {metadata: meta}), errors: await driver.errors().catch(() => []), rows, scenarios, lastRoute, runtimeFailure, diagnostic };
  } finally {
    await driver.unload().catch(unloadError => {
      if (measurement === undefined) throw unloadError;
      // Cleanup cannot erase an entry refusal or its diagnostic. Missing native
      // evidence still makes the measurement incomplete and never earns credit.
      measurement.unloadError = errorText(unloadError); measurement.complete = false; measurement.pass = false;
    });
  }
  return measurement;
}

/** Long tasks inside a profiled travel leg, each with its heaviest inclusive frames (function url:line); raw profile kept in scratch. */
/** Each long frame (>50 ms, [startMs, ms] on the page clock) attributed to the runtime hook it overlapped
 *  (`instance:hook`, from the grid's runtimeTiming), else `between hooks`: where a whole drive's long frames came from,
 *  on either surface, with no profiler running. */
function longFrameHooks(at, completed) {
  const out = new Map();
  for (const [start, ms, gl, glStart] of at ?? []) {
    const hit = completed.find((t) => start < t.end && start + ms > t.start);
    const key = hit === undefined ? 'between hooks' : `${hit.instance}:${hit.hook}`;
    const row = out.get(key) ?? { hook: key, frames: 0, maxMs: 0, totalMs: 0, gl: {}, glStart: {} };
    row.frames++; row.maxMs = Math.max(row.maxMs, ms); row.totalMs += ms; out.set(key, row);
    // --gl-time: [ms, calls] per WebGL method in those frames
    for (const [method, [glMs, calls]] of Object.entries(gl ?? {})) { const sum = row.gl[method] ?? [0, 0]; row.gl[method] = [Math.round((sum[0] + glMs) * 10) / 10, sum[1] + calls]; }
    // glStart: the take of the frame drawn at the interval's start (its render delayed this interval's end)
    for (const [method, [glMs, calls]] of Object.entries(glStart ?? {})) { const sum = row.glStart[method] ?? [0, 0]; row.glStart[method] = [Math.round((sum[0] + glMs) * 10) / 10, sum[1] + calls]; }
  }
  return [...out.values()].sort((a, b) => b.totalMs - a.totalMs).map((row) => Object.assign(row, { gl: Object.fromEntries(Object.entries(row.gl).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8)), glStart: Object.fromEntries(Object.entries(row.glStart).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8)) }));
}
/** The preview's hidden source maps for every script the profile sampled, saved beside it (`<dir>/maps/<file>.map`): the
 *  preview build is deleted when the run ends, and the summary's frames are minified. */
async function saveProfileMaps(profile) {
  const urls = new Set(profile.nodes.map((node) => node.callFrame.url).filter((url) => /^https?:.*\.js$/u.test(url)));
  await saveScriptMaps(urls, cpuProfileDir);
}
async function saveScriptMaps(urls, directory) {
  mkdirSync(join(directory, 'maps'), { recursive: true });
  for (const url of urls) {
    const out = join(directory, 'maps', `${url.split('/').pop()}.map`);
    if (existsSync(out)) continue;
    try { const response = await fetch(`${url}.map`); if (response.ok) writeFileSync(out, await response.text()); }
    catch { /* a script without a map stays minified in offline resolution */ }
  }
}
/** --gl-time: every frame's GL calls ([startMs, {method: [ms, calls]}]) summed by the runtime hook it fell in (`between
 *  hooks` otherwise): what a hook uploaded, compiled and drew, frame by frame, on either surface. */
function glByHook(glFrames, completed) {
  const out = {};
  for (const [start, gl] of glFrames) {
    const hit = completed.find((t) => start >= t.start && start < t.end);
    const key = hit === undefined ? 'between hooks' : `${hit.instance}:${hit.hook}`;
    out[key] ??= { frames: 0, gl: {} };
    const row = out[key];
    row.frames++;
    for (const [method, [ms, calls]] of Object.entries(gl)) { const sum = row.gl[method] ?? [0, 0]; row.gl[method] = [Math.round((sum[0] + ms) * 10) / 10, sum[1] + calls]; }
  }
  return out;
}
function summarizeTravelProfile(profile, startedAt, longTasks, name) {
  const file = join(cpuProfileDir, `${name}-${Date.now()}.cpuprofile`); writeFileSync(file, JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node])), parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const label = (node) => { const f = node.callFrame; return `${f.functionName === '' ? '(anonymous)' : f.functionName} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; };
  // Native navigation time shares the CPU profiler's monotonic clock. The
  // evaluate after Profiler.start can arrive seconds later while sampling starts.
  const originUs = profile.pageNavigationStartUs;
  const samples = []; let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) { t += profile.timeDeltas[i]; samples.push([typeof originUs === 'number' ? (t - originUs) / 1000 : startedAt + (t - profile.startTime) / 1000, profile.samples[i], (profile.timeDeltas[i + 1] ?? 0) / 1000]); }
  const end = samples.at(-1)?.[0] ?? startedAt;
  const tasks = longTasks.filter(([s, d]) => s + d >= startedAt && s <= end).map(([s, d]) => {
    const inclusive = new Map(), self = new Map();
    for (const [at, id, ms] of samples) {
      if (at < s || at > s + d) continue;
      const leaf = nodes.get(id); if (!leaf) continue;
      const own = label(leaf); self.set(own, (self.get(own) ?? 0) + ms);
      const seen = new Set();
      for (let n = id; n !== undefined; n = parent.get(n)) { const key = label(nodes.get(n)); if (seen.has(key)) continue; seen.add(key); inclusive.set(key, (inclusive.get(key) ?? 0) + ms); }
    }
    const top = (map, k) => [...map].filter(([key]) => !/^\((root|program|idle)\)/u.test(key)).sort((a, b) => b[1] - a[1]).slice(0, k).map(([key, ms]) => `${Math.round(ms)} ms ${key}`);
    return { start: Math.round(s), ms: Math.round(d), inclusive: top(inclusive, 18), self: top(self, 8) };
  });
  return { note: 'Diagnostic CPU attribution (sampling profiler on): no timing credit', longTasks: tasks.length, longTaskMs: tasks.reduce((sum, task) => sum + task.ms, 0), file, startedAt, tasks }; // file + startedAt: re-resolve the raw profile offline (source maps)
}
function webkit(wsUrl) {
  const ws = new WebSocket(wsUrl), pending = new Map(), listeners = new Map();
  let constructorsLastRead = 0;
  let seq = 0, target = null, clock = {};
  let targetReady, targetRefuse;
  const targetAdmission = new Promise((resolve, reject) => { targetReady = resolve; targetRefuse = reject; });
  const targetDeadline = new AbortController();
  const expireTarget = async () => {
    try { await sleep(10000, undefined, { signal: targetDeadline.signal }); targetRefuse(new Error('Web Inspector timed out: page target')); }
    catch (error) { if (!targetDeadline.signal.aborted) targetRefuse(error); }
  };
  void expireTarget();
  const changeTarget = (next) => {
    if (next === target) return;
    const previous = target; target = next; clock = {};
    targetReady(); targetDeadline.abort();
    if (previous === null) return;
    for (const [id, waiter] of pending) {
      if (waiter.target !== previous) continue;
      pending.delete(id); clearTimeout(waiter.timer); waiter.reject(new Error('Web Inspector target changed'));
    }
    for (const listener of listeners.get('Target.changed') ?? []) listener({ previousTargetId: previous, targetId: next });
  };
  const opened = Promise.all([targetAdmission, new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); })]);
  const inner = (message) => {
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.done(message.result); }
    if (message.method) for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  };
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Target.targetCreated' && message.params.targetInfo.type === 'page') changeTarget(message.params.targetInfo.targetId);
    else if (message.method === 'Target.didCommitProvisionalTarget') changeTarget(message.params.newTargetId);
    else if (message.method === 'Target.dispatchMessageFromTarget') { if (message.params.targetId === undefined || message.params.targetId === target) inner(JSON.parse(message.params.message)); }
    else inner(message);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Web Inspector timed out: ${method}`)); }, 10000);
    pending.set(id, { done: resolve, reject, timer, target });
    const message = { id, method, params };
    ws.send(JSON.stringify(target ? { id: ++seq, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(message) } } : message));
  });
  return { opened, send, get clock() { return clock; }, get targetId() { return target ?? undefined; }, on: (method, receive) => {
    const set = listeners.get(method) ?? new Set(); set.add(receive); listeners.set(method, set);
    return () => { set.delete(receive); if (set.size === 0) listeners.delete(method); };
  }, raw: async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.wasThrown) throw new Error(result.result?.description ?? 'Safari evaluation threw');
    // Reuse completed evaluations, never add another game watcher or rAF. Send
    // directly to avoid recursive observation. Each document has its own clock.
    if (wasmConstructorsDir !== '' && (Date.now() - constructorsLastRead > 1000 || expression.includes('__frameFloorErrors'))) {
      constructorsLastRead = Date.now();
      const captured = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__wasmDurationCensus ?? null)', returnByValue: true });
      if (captured.wasThrown) throw new Error('Native constructor census read failed');
      const value = captured.result?.value;
      if (typeof value === 'string' && value !== 'null') {
        const census = JSON.parse(value);
        if (!Number.isFinite(census.origin) || census.origin <= 0) throw new Error('Native constructor census has no document clock');
        writeFileSync(join(wasmConstructorsDir, `census-${census.origin}.json`), value);
      }
    }
    return result.result?.value;
  }, close: () => { targetRefuse(new Error('Inspector closed')); targetDeadline.abort(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Inspector closed')); } pending.clear(); listeners.clear(); ws.close(); } };
}
async function safariPage(base) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    for (let port = 9232; port <= 9240; port++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) })).json();
        const page = pages.find((p) => p.url?.startsWith(base));
        if (page) return page.webSocketDebuggerUrl;
      } catch { /* Proxy discovery has not announced the Simulator yet. */ }
    }
    await sleep(200);
  }
  throw new Error('Simulator Safari page not exposed by ios_webkit_debug_proxy (ports 9232–9240)');
}
async function worker() {
  const base = flag('base', ''), rows = [];
  // Native memory owns a bounded Simulator window, not time spent queued for it.
  const deadline = nativeDirectory === '' ? Number(flag('deadline', '0')) : Date.now() + 570_000;
  let browser, context, page, proxy, inspector, nativeMemory, wasmProbeResult;
  const nativeReadings = [];
  const timelineSession = createWebKitTimelineSession();
  /** @type {ReturnType<typeof startFloorNative> | undefined} */
  let stopNative;
  let quietHeld = false, stopJscGc;
  const quiet = action => {
    const result = spawnSync('python3', [join(ROOT, 'scripts/sim-quiet.py'), action, String(process.pid), 'scripts/frame-floor.mjs'], { cwd: ROOT, encoding: 'utf8' });
    if (result.status !== 0) {
      const message = result.stderr.trim();
      throw new Error(message.length === 0 ? 'Simulator frame-floor quiet refused' : message);
    }
  };
  let lastRoute = null;
  // Retain the existing once-a-second route ledger's memory envelope, including loading between standing witnesses.
  // This records already-read model costs; it adds no browser sampling or timing instrumentation.
  const memoryJourney = new Map();
  const observe = progress => {
    if (progress.sampledAt !== lastRoute?.sampledAt && progress.memory?.cost && progress.stop?.leg) {
      const { cost } = progress.memory, key = `${progress.documentOrigin}:${progress.stop.leg}`;
      const row = memoryJourney.get(key) ?? { leg: progress.stop.leg, samples: 0, playingPeakMB: 0, loadingPeakMB: 0,
        productsMinBytes: cost.input.products, productsMaxBytes: 0 };
      row.samples++;
      row.playingPeakMB = Math.max(row.playingPeakMB, cost.playing / 1e6);
      row.loadingPeakMB = Math.max(row.loadingPeakMB, cost.loading / 1e6);
      row.productsMinBytes = Math.min(row.productsMinBytes, cost.input.products);
      row.productsMaxBytes = Math.max(row.productsMaxBytes, cost.input.products);
      memoryJourney.set(key, row);
    }
    lastRoute = progress;
  };
  try {
    if (quietSample) { quiet('take'); quietHeld = true; }
    let driver;
    if (surface === 'desktop') {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ channel: 'chromium', args: ['--mute-audio', `--use-angle=${chromiumAngle}`, '--ignore-gpu-blocklist'] });
      context = await browser.newContext({ ...(chromiumPhone ? { viewport: softwareCensus?.viewport ?? { width: 402, height: 874 }, deviceScaleFactor: 3 } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: desktopDpr }), serviceWorkers: 'block' });
      await context.addInitScript({ content: `${fixture(settings.tier)};window.__wildshardHarness=${HARNESS_PINS};${ERROR_SCRIPT}${CONSOLE_SCRIPT}${LONGTASK_SCRIPT}${GL_TIME_SCRIPT}${TASK_CLOCK}${travelGl}` });
      let errors = [], profiler = null, throttle = null, cpuPhase = null;
      driver = {
        load: async (shard) => {
          errors = []; cpuPhase = null; page = await context.newPage();
          if (chromiumCpuRate !== 1) {
            throttle = await context.newCDPSession(page);
            cpuPhase = frameFloorCpuPhase(chromiumCpuRate, postReadyCpu, {
              apply: rate => throttle.send('Emulation.setCPUThrottlingRate', {rate}),
              fence: () => page.evaluate(() => {
                const game = window.__wildshard?.world?.game;
                if (game === undefined) throw new Error('Post-throttle fence requires the ready game');
                const frame = game.frameCount, atMs = performance.now(), documentOrigin = performance.timeOrigin;
                return new Promise((resolve, reject) => {
                  let raf = 0;
                  const timer = setTimeout(() => { cancelAnimationFrame(raf); reject(new Error('Post-throttle draw fence stalled')); }, 30000);
                  const tick = () => {
                    if (game.frameCount >= frame + 2) { clearTimeout(timer); resolve({frame, atMs, documentOrigin, firstCompletedFrame: game.frameCount}); }
                    else raf = requestAnimationFrame(tick);
                  };
                  raf = requestAnimationFrame(tick);
                });
              }),
            });
            await cpuPhase.boot();
          }
          page.on('pageerror', (e) => errors.push(e.message.slice(0, 240)));
          page.on('console', (message) => { if (message.type() === 'error' && message.text().includes('[faults]')) errors.push(message.text().slice(0, 1000)); });
          await page.goto(`${base}${query(shard)}`, { waitUntil: 'domcontentloaded' });
        },
        beginMeasurement: async () => { await cpuPhase?.measure(); },
        cpuPhase: () => cpuPhase?.reading() ?? null,
        tapGrid: () => page.evaluate(FLOOR_GRID_TAP),
        evaluate: evaluator((expr) => page.evaluate(expr), observe), errors: () => Promise.resolve(errors), progress: () => lastRoute, followed: () => page.waitForURL((u) => !u.search.includes('mute=1') || u.search.includes('chunk='), { timeout: 60000 }).catch(() => undefined),
        unload: async () => { try {await throttle?.detach();} finally {throttle = null; await page?.close();} },
        profile: cpuProfileDir === '' ? null : {
          start: async () => { profiler = await page.context().newCDPSession(page); await profiler.send('Performance.enable'); await profiler.send('Profiler.enable'); await profiler.send('Profiler.setSamplingInterval', { interval: 250 }); await profiler.send('Profiler.start'); return page.evaluate('performance.now()'); },
          stop: async () => {
            const { profile } = await profiler.send('Profiler.stop');
            const metrics = await profiler.send('Performance.getMetrics');
            const navigationStart = metrics.metrics.find(row => row.name === 'NavigationStart')?.value;
            if (navigationStart === undefined) throw new Error('CPU profile page clock unavailable');
            await profiler.detach(); profiler = null;
            return { ...profile, pageNavigationStartUs: navigationStart * 1e6 };
          },
        },
        trace: gpuTraceDir === '' ? null : {
          // the anchor: a user-timing mark whose trace timestamp pins the page clock to the trace clock
          start: async (name) => { const file = join(gpuTraceDir, `${name}-${Date.now()}`); await browser.startTracing(page, { path: `${file}.json`, categories: GPU_TRACE_CATEGORIES }); const [pageMs, wallMs] = await page.evaluate("(performance.mark('frameFloorTraceAnchor'), [performance.now(), Date.now()])"); return { file, pageMs, wallMs }; },
          stop: async (anchor, longFrames, hooks) => { await browser.stopTracing(); writeFileSync(`${anchor.file}.frames.json`, JSON.stringify({ anchorPageMs: anchor.pageMs, anchorWallMs: anchor.wallMs, longFrames, hooks })); console.log(`GPU trace ${anchor.file}.json`); },
        },
      };
    } else {
      const udid = process.env.SIM_UDID;
      if (!udid) throw new Error('Safari worker must run inside scripts/sim-lane.sh run');
      if (jscGcDirectory !== '') stopJscGc = await startJscGcLog(jscGcDirectory, udid, jscRamSize);
      const xcrun = (tail) => execFileSync('xcrun', ['simctl', ...tail], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      // An owned fresh tab prevents accumulated worlds across shards. Safari is terminated between loads.
      const socket = xcrun(['getenv', udid, 'RWI_LISTEN_SOCKET']).trim();
      proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${socket}`, '-c', 'null:9221,:9232-9240', '-F'], { stdio: 'ignore' });
      proxy.on('error', (error) => { console.error(`Inspector proxy: ${errorText(error)}`); });
      let evaluate, currentUrl;
      const connect = async (url) => {
        inspector?.close(); inspector = undefined;
        currentUrl = url;
        inspector = webkit(await safariPage(url)); await inspector.opened; await sleep(500);
        evaluate = evaluator(inspector.raw, observe);
        const attachedInspector = inspector;
        timelineSession.attach(attachedInspector, expression => attachedInspector.raw(expression));
      };
      // A timed-out evaluation may already have started movement or an async admission. Reconnect for diagnostics,
      // but never replay it: losing the document/target invalidates that route's witnesses.
      const retryEvaluate = async (expr, timeout) => {
        try { return await evaluate(expr, timeout); }
        catch (error) {
          if (!errorText(error).includes('Web Inspector timed out: Runtime.evaluate') && !errorText(error).includes('Web Inspector target changed')) throw error;
          // Inherited stderr reaches a live host diagnostic before reconnect or
          // Simulator cleanup, without depending on the worker stdout pipe.
          process.stderr.write(`Safari Inspector failure: ${errorText(error)}; at=${new Date().toISOString()} worker=${process.pid}; refusing replay\n`);
          if (!errorText(error).includes('Web Inspector target changed')) await connect(currentUrl);
          const documentOrigin = await inspector.raw('performance.timeOrigin').catch(() => undefined);
          throw Object.assign(new Error('Safari inspector lost the active evaluation; refusing to replay the measurement', { cause: error }), { documentOrigin });
        }
      };
      driver = {
        load: async (shard) => {
          inspector?.close(); inspector = undefined;
          try { xcrun(['terminate', udid, 'com.apple.mobilesafari']); } catch { /* Safari is not running on first boot. */ }
          const preparationUrl = `${base}${wasmMemoryProbe ? 'version.json' : 'frame-floor-bootstrap.html'}`;
          xcrun(['openurl', udid, preparationUrl]);
          await connect(preparationUrl);
          if (!wasmMemoryProbe) await retryEvaluate(`(() => { ${fixtureCheck}; if(window.__frameFloorBootstrapReady!==true)throw new Error('Frame-floor preparation document did not finish'); return true; })()`);
          if (nativeDirectory !== '') {
            const directory = shards.length === 1 ? nativeDirectory : join(nativeDirectory, shard);
            if (shards.length > 1) mkdirSync(directory);
            const stop = startFloorNative(ROOT, directory, udid, expression => inspector?.raw(expression), () => { inspector?.close(); }, quietSample);
            stopNative = async () => {
              const reading = await stop(); nativeReadings.push({shard, reading}); return reading;
            };
          }
          // Reconnect after navigation: an inspector evaluation envelope can disappear in a WebContent process swap.
          // The helper sets live pose pins before the clean build's modules boot.
          const gameUrl = `${base}frame-floor-safari.html${query(shard)}`;
          // Intentional preparation navigation has no measurement envelope to
          // preserve. Read its acknowledgement directly before reconnecting.
          if (!wasmMemoryProbe && await inspector.raw(frameFloorGameNavigationCode(gameUrl)) !== true)
            throw new Error('Safari preparation did not acknowledge game navigation');
          inspector.close(); inspector = undefined;
          if (wasmMemoryProbe) xcrun(['openurl', udid, gameUrl]);
          await connect(gameUrl);
        },
        refreshInspector: async () => { await connect(currentUrl); return JSON.parse(await inspector.raw(`JSON.stringify((${gridFloorDocumentIdentity.toString()})())`)); },
        tapGrid: () => inspector.raw(FLOOR_GRID_TAP),
        evaluate: retryEvaluate, errors: () => retryEvaluate('window.__frameFloorErrors ?? []'), progress: () => lastRoute, unload: async () => {
          if (stopNative !== undefined) { nativeMemory = await stopNative(); stopNative = undefined; }
          inspector?.close(); inspector = undefined;
        },
        // the tap's fresh document (same helper page, so the pins stay): reconnect to whatever page the helper path now holds
        followed: async () => { await sleep(1500); await connect(`${base}frame-floor-safari.html`); },
        scriptProfile: safariProfileDir === '' ? null : { start: () => startScriptProfile(inspector), prefix: persist => startPrefixScriptProfile(inspector, expression => retryEvaluate(expression), persist),
          window: (driveMs, selected, persist) => startDriveWindowScriptProfile(inspector, expression => retryEvaluate(expression), driveMs, selected.fromMs, selected.toMs, persist) },
        timeline: glTime || webkitTimelineDir !== '' ? { start: () => timelineSession.start() } : null,
      };
    }
    if (wasmMemoryProbe) {
      await driver.load('grid');
      const blank = await driver.evaluate('window.__wildshard === undefined && [...document.scripts].every(script => script.src === "")');
      if (!blank) throw new Error('Memory probe must run without application scripts');
      const stop = await driver.timeline.start();
      let probe, timeline;
      try {
        probe = await driver.evaluate(`(${runWasmMemoryProbe.toString()})()`, 20000);
        writeFileSync(join(webkitTimelineDir, 'blank-memory-probe-checkpoint.json'), JSON.stringify({ diagnostic: true, finalClock: 'not-yet-validated', probe }));
      }
      finally { timeline = await stop(); }
      const counts = await driver.evaluate(`(() => { const rows = window.__wasmDurationCensus.rows; return { dropped: window.__wasmDurationCensus.dropped, Memory: rows.filter(r => r.kind === 'Memory').length, Module: rows.filter(r => r.kind === 'Module').length, Instance: rows.filter(r => r.kind === 'Instance').length }; })()`);
      if (counts.dropped !== 0 || counts.Memory !== 46 || counts.Instance !== 46 || counts.Module !== 1) throw new Error('Blank native constructor counts differ from the protocol');
      const errors = await driver.errors();
      if (errors.length > 0) throw new Error('Blank memory probe reported page errors');
      wasmProbeResult = { complete: true, diagnostic: true, blank, counts, probe, timeline, errors };
      writeFileSync(join(webkitTimelineDir, 'blank-memory-probe.json'), JSON.stringify(wasmProbeResult));
      await driver.unload();
    } else for (const shard of shards) { lastRoute = null; evaluationOriginDriftMaxMs = 0; rows.push(await measureShard(driver, shard, deadline)); }
  } catch (error) {
    for (const shard of shards.filter((s) => !rows.some((r) => r.shard === s))) rows.push({ shard, complete: false, pass: false, error: errorText(error) });
  } finally {
    if (stopNative !== undefined) {
      try { nativeMemory = await stopNative(); }
      catch (error) { nativeMemory = { error: errorText(error) }; }
    }
    try { timelineSession.close(); inspector?.close(); proxy?.kill('SIGTERM'); await context?.close(); await browser?.close(); }
    finally { try { if (stopJscGc !== undefined) await stopJscGc(); } finally { if (quietHeld) quiet('release'); } }
  }
  writeFileSync(flag('worker-out', ''), JSON.stringify({ surface, rows, memoryJourney: [...memoryJourney.values()], nativeReadings, ...(nativeMemory === undefined ? {} : { nativeMemory }), ...(wasmProbeResult === undefined ? {} : { wasmMemoryProbe: wasmProbeResult }) }));
}
function run(command, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const { echo, ...spawnOptions } = options;
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...spawnOptions });
    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data; if (echo) process.stdout.write(data); });
    child.on('error', reject); child.on('close', (code) => { if (code !== 0) reject(new Error(`${command} exited ${code}`)); else resolve(stdout.trim()); });
  });
}
async function main() {
  const regrade = flag('regrade', '');
  if (regrade) {
    const path = resolvePath(ROOT, regrade);
    if (!path.startsWith(`${join(ROOT, 'progress/frame-floor')}/`) || !path.endsWith('.json')) throw new Error('Regrade must name a progress/frame-floor JSON');
    const record = grade(JSON.parse(readFileSync(path, 'utf8')));
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    printVerdict(record);
    process.exitCode = record.complete ? record.pass ? 0 : 2 : 3;
    return;
  }
  const start = Date.now(), sha = execFileSync('git', ['rev-parse', flag('rev', 'HEAD')], { cwd: ROOT, encoding: 'utf8' }).trim();
  const runId = `${process.pid}-${Date.now()}`;
  const scratch = join(resolvePath(flag('scratch-dir', '/private/tmp/sp-lanes/frame-floor')), `frame-floor-${runId}`);
  mkdirSync(scratch, { recursive: true });
  const results = [], temporary = [];
  let base, probeServer, ownedServer = true;
  try {
    // --serve-shard=<slug>: build only that shard's product (serve-build --shard), for a standalone row when another
    // shard's product does not build at this commit
    const serveShard = flag('serve-shard', '');
    // --serve-base=<url>: measure an already-served preview of --rev (scripts/serve-build.sh, kept running by its
    // owner), so back-to-back A/B rows in a quiet window build nothing; its build id is still checked below (sp-o286)
    const serveBase = flag('serve-base', '');
    if (serveBase !== '') ownedServer = false;
    if (wasmMemoryProbe) {
      ownedServer = false;
      const blank = `<!doctype html><html><head><meta charset="utf-8"><script>${WASM_CONSTRUCTORS}${ERROR_SCRIPT}</script></head><body>Blank native memory diagnostic</body></html>`;
      probeServer = createServer((request, response) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        response.setHeader('Cache-Control', 'no-store');
        if (path === '/version.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ build: `blank-fixture-${sha.slice(0, 7)}` })); }
        else if (path === '/frame-floor-safari.html') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(blank); }
        else { response.statusCode = 404; response.end(); }
      });
      await new Promise((resolve, reject) => { probeServer.once('error', reject); probeServer.listen(0, '127.0.0.1', resolve); });
      const address = probeServer.address();
      if (address === null || typeof address === 'string') throw new Error('Blank diagnostic server has no loopback port');
      base = `http://127.0.0.1:${address.port}/`;
    } else base = serveBase !== '' ? (serveBase.endsWith('/') ? serveBase : `${serveBase}/`) : await run(join(ROOT, 'scripts/serve-build.sh'), ['--rev', sha, '--name', `frame-floor-${runId}`, '--hours', '1', ...(devserverBuild ? ['--devserver'] : []), ...(serveShard === '' ? [] : ['--shard', serveShard])], { cwd: ROOT }); // G670: previews start from the checkout, never a tmp/ caller
    const version = await (await fetch(`${base}version.json`)).json();
    if (!JSON.stringify(version).includes(sha.slice(0, 7))) throw new Error(`Preview build id does not match ${sha}: ${JSON.stringify(version)}`);
    // Safari cannot inject a pre-navigation script with its inspector protocol. Add pins to a COPY of the clean
    // entry HTML in the served dist only. Compiled JS/assets and all gameplay remain byte-identical to the export.
    if (!wasmMemoryProbe && surface !== 'desktop') {
      const registry = readFileSync(join(process.env.HOME, '.dev-servers', new URL(base).port), 'utf8').trim().split(' ');
      const dist = join(registry[2], 'dist'), html = readFileSync(join(dist, 'index.html'), 'utf8');
      const helper = join(dist, 'frame-floor-safari.html');
      writeFileSync(helper, html.replace('<head>', `<head><script>(${traceFrameFloorFixtureWrites.toString()})();${ablationSelected ? BUFFER_PRESSURE_SCRIPT : ''}${NATIVE_PRESSURE}${WASM_CONSTRUCTORS}${fixture('phone')};window.__wildshardHarness=${HARNESS_PINS};${ERROR_SCRIPT}${CONSOLE_SCRIPT}${GL_TIME_SCRIPT}${TASK_CLOCK}${travelGl}</script>`));
      writeFileSync(join(dist, 'frame-floor-bootstrap.html'), frameFloorBootstrapHtml(fixture('phone'), fixtureCheck));
    }
    for (const s of surface === 'both' ? ['desktop', 'sim'] : [surface]) {
      const out = join(scratch, `frame-floor-${s}-${sha.slice(0, 9)}.json`); temporary.push(out);
      const workerArgs = [SCRIPT, '--worker', ...(devserverBuild ? ['--devserver'] : []), `--surface=${s}`, `--developer=${developer}`, `--standing-poses=${standingPoses.join(',')}`, `--base=${base}`, `--shards=${shards.join(',')}`, `--grid-scenario=${gridScenario}`, ...(gridRoutes.length === 0 ? [] : [`--grid-routes=${gridRoutes.join(',')}`]), ...(gridCell === '' ? [] : [`--grid-cell=${gridCell}`]), ...(roadApproach ? ['--road-approach'] : []), ...(entrySocket ? ['--entry-socket'] : []), ...(risingIslet === '' ? [] : [`--rising-islet=${risingIslet}`]), ...(gridCellPoseArg === '' ? [] : [`--grid-cell-pose=${gridCellPoseArg}`]), `--gl-observer=${glObserver}`, ...(texturesPin === '' ? [] : [`--textures=${texturesPin}`]), ...(ktx2ProbePin === '' ? [] : [`--ktx2-probe=${ktx2ProbePin}`]), ...(glTime ? ['--gl-time'] : []), ...(gpuBisectOn ? ['--gpu-bisect'] : []), ...(frameTimeline ? ['--frame-timeline'] : []), ...(taskClock ? ['--task-clock'] : []), ...(cpuProfileDir === '' ? [] : [`--cpu-profile=${cpuProfileDir}`]), ...(safariProfileDir === '' ? [] : [`--safari-profile=${safariProfileDir}`]), ...(gpuTraceDir === '' ? [] : [`--gpu-trace=${gpuTraceDir}`]), `--frames=${frames}`, `--settle=${settleMs / 1000}`, `--deadline=${start + 600000}`, `--worker-out=${out}`, ...settingArgs, ...deviceSaveArgs, ...systemArgs];
      if (chromiumPhone) workerArgs.push('--chromium-phone');
      if (desktopDpr !== 2) workerArgs.push(`--desktop-dpr=${desktopDpr}`);
      if (standingFile !== '') workerArgs.push(`--standing-file=${resolvePath(ROOT, standingFile)}`);
      if (drawBudgetOn) workerArgs.push(drawBudgetMode === 'report-only' ? '--draw-budget-report-only' : '--draw-budget');
      if (softwareCensus !== null) workerArgs.push('--software-draw-census');
      if (chromiumCpuRate !== 1) workerArgs.push(`--chromium-cpu=${chromiumCpuRate}`);
      if (chromiumBackend.explicit) workerArgs.push(`--chromium-angle=${chromiumAngle}`);
      if (entrySettle) workerArgs.push('--entry-settle');
      if (jscGcDirectory !== '') workerArgs.push(`--jsc-gc-log=${jscGcDirectory}`);
      if (jscRamSize > 0) workerArgs.push(`--jsc-ram-size=${jscRamSize}`);
      if (nativeDirectory !== '') workerArgs.push(`--native-memory=${nativeDirectory}`);
      if (webkitTimelineDir !== '') workerArgs.push(`--webkit-timeline=${webkitTimelineDir}`);
      if (webkitSteadyPose !== '') workerArgs.push(`--webkit-steady=${webkitSteadyPose}`);
      if (pauseAblation) workerArgs.push('--pause-ablation');
      if (bufferAblation) workerArgs.push('--buffer-ablation');
      if (nativePressureDir !== '') workerArgs.push(`--native-pressure=${nativePressureDir}`);
      if (wasmConstructorsDir !== '') workerArgs.push(`--wasm-constructors=${wasmConstructorsDir}`);
      if (wasmMemoryProbe) workerArgs.push('--wasm-memory-probe');
      if (safariSteadyPose !== '') workerArgs.push(`--safari-steady=${safariSteadyPose}`);
      if (safariDrive !== '') workerArgs.push(`--safari-drive=${safariDrive}`);
      if (safariPrefix !== '') workerArgs.push(`--safari-prefix=${safariPrefix}`);
      if (safariWindow !== null) workerArgs.push(`--safari-window=${safariWindow.route}:${safariWindow.fromMs / 1000}:${safariWindow.toMs / 1000}`);
      if (quietSample) workerArgs.push('--quiet');
      const lane = s === 'desktop' ? ['--max', '10', process.execPath, ...workerArgs] : ['run', '--max', '10', device, process.execPath, ...workerArgs];
      await run(join(ROOT, `scripts/${s === 'desktop' ? 'browser' : 'sim'}-lane.sh`), lane, { cwd: quietSample ? ROOT : scratch, echo: true });
      results.push(JSON.parse(readFileSync(out, 'utf8')));
    }
    const elapsedSeconds = (Date.now() - start) / 1000;
    if (wasmMemoryProbe) {
      const complete = results.length === 1 && results[0]?.wasmMemoryProbe?.complete === true;
      const record = { diagnostic: 'blank-wasm-memory-probe', complete, floorTimingCredit: false, harnessRevision: sha, elapsedSeconds, results };
      const directory = resolvePath(ROOT, flag('output-dir', 'tmp/frame-floor')); mkdirSync(directory, { recursive: true });
      const output = join(directory, `blank-wasm-${runId}.json`);
      writeFileSync(output, JSON.stringify(record, null, 2));
      console.log(`Blank native memory diagnostic ${output}: complete=${complete}; no app build or floor timing credit`);
      process.exitCode = complete ? 0 : 3;
      return;
    }
    const complete = results.every((r) => r.rows.every((row) => row.complete));
    const pass = complete && elapsedSeconds < 600 && results.every((r) => r.rows.every((row) => row.pass));
    const record = grade({ schema: 2, sha, runId, device, standingSource, when: new Date().toISOString(), elapsedSeconds, underTenMinutes: elapsedSeconds < 600,
      drawBudgetOn, drawBudgetMode, chromiumAngle, chromiumAngleExplicit: chromiumBackend.explicit, ...(desktopDpr === 2 ? {} : {desktopDpr}), ...(softwareCensus === null ? {} : {softwareCensus}), ...(postReadyCpu ? {cpuPhaseMode: 'after-ready', bootCpuRate: 1} : {}), ...(chromiumCpuRate === 1 ? {} : {chromiumCpuRate, diagnostic: 'cpu-throttled-chromium', floorTimingCredit: false}),
      frames, settleMs, standingPoses, shards, surface, developer, quiet: quietSample, ...(publicGrid ? {publicGrid:'public grid as it would ship once GRID_GATES_PASSED flips'} : {}), settings, deviceSaves, expectedSystems, gridScenario, gridRoutes, ...(gridCell === '' ? {} : { gridCell, gridCellPose }), build: devserverBuild ? 'devserver' : 'production', glObserver, travelGlCensus: travelGl !== '', glTime, frameTimeline, gpuBisect: gpuBisectOn, safariProfile: safariProfileDir !== '', ...(safariSteadyPose === '' ? {} : {safariSteady: {pose: safariSteadyPose, seconds: 20}}), ...(safariDrive === '' ? {} : {safariDrive: {route: safariDrive, ...(safariSteadyPose === '' ? {earlyPlaySeconds: 20} : {separateSteady: true})}}), ...(safariPrefix === '' ? {} : {safariPrefix: {route: safariPrefix, seconds: 20}}), ...(safariWindow === null ? {} : {safariWindow}), webkitTimeline: webkitTimelineDir !== '', ...(webkitSteadyPose === '' ? {} : {webkitSteady: {poses: webkitSteadyPoses, seconds: 20}}), pauseAblation, bufferAblation, nativeJscGcLog: jscGcDirectory !== '', ...(jscRamSize === 0 ? {} : {diagnosticJscRamSizeBytes: jscRamSize}), wasmConstructors: wasmConstructorsDir !== '', nativePressure: nativePressureDir !== '', harnessRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), complete, pass, desktopCap: 'Settings fps=auto: no game cap; display/vsync remains enabled',
      simulatorCap: `Shipped phone-tier 30 fps cap; Simulator Safari on ${device}`,
      measurement: `${chromiumCpuRate === 1 ? '' : postReadyCpu ? `Diagnostic boot CPU 1x; requested measurement CPU ${chromiumCpuRate}x only after ready and an acknowledged new-draw fence (actual per-shard cpuPhase retained); no official floor timing credit. ` : `Diagnostic page CPU ${chromiumCpuRate}x; no official floor timing credit. `}Live game; rAF timestamps between observed drawn frameCount changes grade cadence; performance.now callback intervals retained as diagnostics, Game.frameMs/workMs and game.lastFrame retained. No frame limiter bypass or capture clock.${chromiumCpuRate === 1 ? ' No CPU throttling.' : ''}`,
      limitations: [softwareCensus !== null ? 'Software-only CSS201x437 / canvas402x874 at 2x, four native spawn frames; no phone-budget or official timing credit.' : standingPoses.length === 0 ? 'Stationary spawn and two heaviest scanned standing parity cameras; this is a baseline, not proof of every gameplay moment.' : 'Stationary spawn and explicitly pinned authored standing cameras; this is a baseline, not proof of every gameplay moment.', 'Simulator readings measure Mac-backed Mobile Safari, not physical iPhone performance.', 'Safari helper HTML adds live harness pins; travel scenarios also install diagnostic WebGL allocation hooks before boot. Travel GL figures are API allocations, not native WebContent memory, and must not be added to the playing model as another claim.'], results });
    const directory = resolvePath(ROOT, flag('output-dir', 'progress/frame-floor')); mkdirSync(directory, { recursive: true });
    const output = join(directory, `${sha.slice(0, 9)}-${runId}.json`);
    writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
    printVerdict(record);
    if (drawBudgetOn) {
      writeFrameFloorDrawReport(record, output, process.env.GITHUB_STEP_SUMMARY);
      console.log(frameFloorDrawMarkdown(frameFloorDrawReport(record)));
    }
    console.log(`Baseline ${output}: ${elapsedSeconds.toFixed(1)} seconds, complete=${record.complete}, pass=${record.pass}`);
    process.exitCode = record.complete ? record.pass ? 0 : 2 : 3;
  } finally {
    if (probeServer !== undefined) await new Promise(resolve => { probeServer.close(resolve); });
    if (base && ownedServer) await run(join(ROOT, 'scripts/serve-build.sh'), ['stop', new URL(base).port], { cwd: ROOT });
    for (const out of temporary) rmSync(out, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}
await (args.includes('--worker') ? worker() : main());
