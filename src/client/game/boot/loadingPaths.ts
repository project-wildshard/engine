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

/** Only the calibrated profile carries weights. Every other path keeps an equal share a row, which is what every path
 *  had before LS7 (the bar ignored weights), until it is measured. */
function calibrate(path: Path, calibrated: boolean): Path {
  return { ...path, steps: path.steps.map(row => {
    if (!calibrated) return { ...row, weight: 1 };
    const seconds = SHARDFILE_MEASURED_SECONDS[row.key];
    if (seconds === undefined) throw new Error(`LS7: Load row ${row.key} has no measured seconds`);
    return { ...row, weight: seconds };
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
    ignored: native ? [] : BOOT_STEPS.filter(key => !selected.has(key)) }, id === 'shardfile' && !native);
}

/** Crossings retain their existing unobstructed play view; the live diagnostic uses this separate, exact phase table. */
export function crossingLoadingRows(timing: GridCrossingTiming): { key: string; label: string; ms: number }[] {
  const boundaries = [timing.requestedAt, timing.readyAt, timing.start, timing.checkpointEnd, timing.commitEnd, timing.end];
  return loadingPath('crossing').steps.map((row, index) => ({ key: row.key, label: row.label,
    ms: Math.max(0, (boundaries[index + 1] ?? 0) - (boundaries[index] ?? 0)) }));
}
