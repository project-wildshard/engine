import { BOOT_STEPS, STEP_INFO } from '@wildshard/engine/boot/steps';
import { repeatedStep } from '@wildshard/engine/boot/timeline';
import type { Loading } from '@wildshard/engine/ui/Loading';
import type { GridCrossingTiming } from '../../../shared/game/grid/crossing';

/** LS7 (J188): a Load row's bar share is its measured seconds, never a range or a floor. One calibrated profile: the
 *  data-only shardfile path, Sunscar Dunes, phone tier (iPhone 16 Pro viewport, 4x CPU, 12.8 Mbit/s), headless Chromium,
 *  each row's own timeline ms at ready (`scripts/loading-card-proof.mjs --shard=sunscar-dunes --throttle --strict
 *  --dump`, its `-rows.json`; build 616462d, 2026-11-08), at the timeline's 0.1 ms resolution. A row that did not run
 *  there (state todo, 0 ms) has weight 0. `modules` is the exception: its row starts at document t0, so its row ms
 *  (8677.1) repeats the Start phase. Its weight is only its Load-phase stretch, the `game-stage:modules` span in the
 *  same proof's `-timing.json` (from `app:loading-adopt`, where Start ends, to admission): 364 ms at that span's 1 ms
 *  resolution, the same in builds 616462d and 2c12f2c. */
const SHARDFILE_MEASURED_SECONDS: Readonly<Record<string, number>> = {
  modules: 0.364, runtimeModules: 0.0050, data: 0.0134,
  audioFiles: 0, // not run: todo at ready
  world: 1.6831, renderer: 0.0769, loadout: 1.1897, weapon: 0.0009, gameplay: 0.3758, menu: 0.0014,
  finish: 0.0231, // still on at ready: its ms then
  spawnDetail: 0.0014, shaders: 0.6235, firstFrame: 6.6858, worldFrame: 0.1162, readyFrame: 0.4966,
  spawnPrograms: 0, worldPrograms: 0, // WebKit-only links (QA8): not run in this profile, nor in the WebKit proof
  server: 1.8716, audio: 0.0010,
};

/** LS8 (J188): the native and hybrid world stages (Driftwood, Pine, Nalati and Nine still build theirs in TypeScript),
 *  measured the same way: Driftwood Isle, the same phone profile and headless Chromium, its `-rows.json` from
 *  `scripts/loading-card-proof.mjs --shard=driftwood-isle --throttle --dump` (build d0f800b-mw9lffqd with the creature
 *  warm-up and FIRST_DRAW_NARROW, 2026-11-09), at 0.1 ms. `modules` is its `game-stage:modules` span, 685 ms, as above.
 *  The first frame is most of this boot there: SwiftShader builds each pipeline on the CPU. */
const NATIVE_MEASURED_SECONDS: Readonly<Record<string, number>> = {
  modules: 0.685, runtimeModules: 0.1605, data: 0.2816, audioFiles: 0.0103,
  world: 0.0755, renderer: 0.0896, sky: 2.3915, terrain: 0.567, cards: 0.0039, forest: 0.0297, physics: 0.0205,
  edge: 0.0243, grass: 0.0017, cabins: 0.0009, props: 3.7816, animals: 0.0476,
  loadout: 0.8326, weapon: 0.0009, gameplay: 0.4638, assembly: 0.0024, menu: 0.0022,
  finish: 0.0954, // still on at ready: its ms then
  spawnDetail: 0.0008, shaders: 2.7485, firstFrame: 49.684, worldFrame: 0.1816, readyFrame: 0.6249,
  spawnPrograms: 0, worldPrograms: 0, // WebKit-only links (QA8): not run in this profile
  server: 3.324, audio: 0.1524,
};

/** LS5 (J188): the Infinite Grid's path (Driftwood Isle from the title's Infinite Wildshard tap, a first visit), measured
 *  on two real-GPU profiles so the card can read time left (src/client/engine/boot/timeLeft.ts), each the mean of three
 *  runs of `scripts/loading-time-left-proof.mjs --profile=desktop,phone --runs=3 --dump` (build 7a23966, 2026-11-09):
 *  each row's own timeline ms at ready, and `modules` its `game-stage:modules` span, as above. The phone stand-in is the
 *  bar's share: Chromium on this Mac's GPU (ANGLE Metal), iPhone 16 Pro viewport, 4x CPU and 12.8 Mbit/s with 150 ms
 *  latency. The fast profile is the same Chromium unthrottled. Unlike the tables above, the GPU is real: on a software
 *  GPU (headless SwiftShader) the first frame alone takes 19-26 s, which no player's device does; that boot hides its
 *  time left (LS8's slow-GPU reading) and keeps these shares. Rows that did not run (a second home pass, home program
 *  links, selected audio) have 0. */
const GRID_MEASURED_SECONDS: Readonly<Record<string, number>> = {
  modules: 0.5581, runtimeModules: 0.0005, data: 0.0092, audioFiles: 0, world: 0.0532, renderer: 0.0587, loadout: 0.0575,
  weapon: 0.0961, gameplay: 0.6442, assembly: 0.8647, menu: 0.0111,
  finish: 0.1014, // still on at ready: its ms then
  home: 4.8447, 'world#2': 0, 'loadout#2': 0, homePrograms: 0, road: 0.0061, spawnDetail: 0.0037, shaders: 0.4227,
  firstFrame: 1.1067, worldFrame: 0.4434, readyFrame: 0.4656, spawnPrograms: 0.2212, worldPrograms: 0.5473, server: 1.5233,
  audio: 0.0038,
};
const GRID_DESKTOP_SECONDS: Readonly<Record<string, number>> = {
  modules: 0.3031, runtimeModules: 0.0001, data: 0.0023, audioFiles: 0, world: 0.0189, renderer: 0.0207, loadout: 0.0114,
  weapon: 0.0409, gameplay: 0.0552, assembly: 0.2964, menu: 0.0059, finish: 0.026, home: 1.3281, 'world#2': 0,
  'loadout#2': 0, homePrograms: 0, road: 0.0001, spawnDetail: 0.0008, shaders: 0.207, firstFrame: 0.7665,
  worldFrame: 0.0559, readyFrame: 0.3305, spawnPrograms: 0.232, worldPrograms: 0.3062, server: 0.1839, audio: 0.0003,
};

/** Only a calibrated profile carries weights. Every other path keeps an equal share a row, which is what every path
 *  had before LS7 (the bar ignored weights), until it is measured. */
function calibrate(path: Path, measured: Readonly<Record<string, number>> | null, fast?: Readonly<Record<string, number>>): Path {
  return { ...path, steps: path.steps.map(row => {
    if (measured === null) return { ...row, weight: 1 };
    const seconds = measured[row.key], desktop = fast?.[row.key];
    if (seconds === undefined) throw new Error(`LS7: Load row ${row.key} has no measured seconds`);
    if (fast !== undefined && desktop === undefined) throw new Error(`LS5: Load row ${row.key} has no desktop seconds`);
    return { ...row, weight: seconds, ...(desktop === undefined ? {} : { fastWeight: desktop }) };
  }) };
}

/** The platform loading-path names. */
export type LoadingPathId = 'legacy' | 'shardfile' | 'grid' | 'crossing' | 'cell';
type Path = Parameters<Loading['setPath']>[0];
const step = (key: string, label: string, aliases: readonly string[] = []): Path['steps'][number] => ({ key, label, aliases, weight: 1 });
/** A grid shell has no regional terrain, trees or physics to report; its real home has its own row. */
export function loadingPath(id: LoadingPathId, own?: Readonly<Record<string, { label: string; weight: number }>>, hybrid = false): Path {
  const early = [step('modules', 'Application modules'),
    step('runtimeModules', 'Runtime modules', ['manifest.load']),
    step('data', 'Texture formats and audio catalogue', ['level.data', 'ktx2', 'audio.preload']),
    step('audioFiles', 'Selected audio downloads')];
  const world = step('world', 'Region world', ['level.world', 'render', 'structures', 'structures.build']);
  const loadout = step('loadout', 'Equipment and HUD', ['level.kit', 'roster', 'fieldModels', 'sword']);
  const leaf = (key: typeof BOOT_STEPS[number]): Path['steps'][number] => ({ key,
    label: own?.[key]?.label ?? STEP_INFO[key].label, weight: own?.[key]?.weight ?? STEP_INFO[key].weight });
  const worldKeys = BOOT_STEPS.filter(key => !['weapon', 'assembly', 'menu', 'shaders', 'firstFrame', 'audio'].includes(key));
  const native = id === 'legacy' || hybrid;
  if (id === 'cell') return { id, steps: [step('world', 'Region world'),
    step('loadout', 'Equipment and HUD'), step('gameplay', 'Gameplay and saved state'), step('warm', 'Entry warm-up'),
    step('colliders', 'Colliders and simulation'), step('enter', 'Enter the cell')], ignored: [] };
  if (id === 'crossing') return { id, steps: [step('prepare', 'Prepare destination'), step('boundary', 'Await transfer boundary'),
    step('checkpoint', 'Save source state'), step('commit', 'Enter destination'), step('activate', 'Activate destination')], ignored: [] };
  const selected = new Set(['renderer', 'weapon', 'menu', 'shaders', 'firstFrame', 'audio', ...(id === 'grid' ? ['assembly'] : [])]);
  return calibrate({ id, steps: [...early, world, ...(native ? worldKeys : ['renderer'] as const).map(leaf),
    loadout, leaf('weapon'), step('gameplay', 'Gameplay and saved state', ['level.play']),
    ...(native || id === 'grid' ? [leaf('assembly')] : []), leaf('menu'), step('finish', 'Final activation', ['finish']),
    ...(id === 'grid' ? [step('home', 'Home region', ['crossing']),
      ...[world, loadout].map(row => repeatedStep(row, 2)),
      step('homePrograms', 'Home region shader preparation'), step('road', 'Road system')] : []),
    // MF5: the spawn view's refinement and the first world frame are named steps (no bar share: Nine-only / short)
    { ...step('spawnDetail', 'Spawn detail'), weight: 0.01 }, leaf('shaders'), leaf('firstFrame'), { ...step('worldFrame', 'First world frame'), weight: 0.01 },
    step('readyFrame', 'First drawn frames and minimap'),
    // QA8: WebKit only (finish.ts linkWorldUnderLoader); it carries no bar share, so other engines' bars are unchanged
    step('spawnPrograms', 'Spawn program links'), { ...step('worldPrograms', 'World program links'), weight: 0.01 },
    // DL21: the server's boot, on J130's row and after the flip on every page; no bar share, so a page with no server is unchanged
    { ...step('server', 'Worker boot'), weight: 0.01 }, leaf('audio')],
    ignored: native ? [] : BOOT_STEPS.filter(key => !selected.has(key)) },
    id === 'grid' ? GRID_MEASURED_SECONDS : native ? NATIVE_MEASURED_SECONDS : id === 'shardfile' ? SHARDFILE_MEASURED_SECONDS : null,
    id === 'grid' ? GRID_DESKTOP_SECONDS : undefined);
}

/** Crossings retain their existing unobstructed play view; the live diagnostic uses this separate, exact phase table. */
export function crossingLoadingRows(timing: GridCrossingTiming): { key: string; label: string; ms: number }[] {
  const boundaries = [timing.requestedAt, timing.readyAt, timing.start, timing.checkpointEnd, timing.commitEnd, timing.end];
  return loadingPath('crossing').steps.map((row, index) => ({ key: row.key, label: row.label,
    ms: Math.max(0, (boundaries[index + 1] ?? 0) - (boundaries[index] ?? 0)) }));
}
