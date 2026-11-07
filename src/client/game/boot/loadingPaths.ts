import { BOOT_STEPS, STEP_INFO } from '@wildshard/engine/boot/steps';
import { repeatedStep } from '@wildshard/engine/boot/timeline';
import type { Loading } from '@wildshard/engine/ui/Loading';
import type { GridCrossingTiming } from '../../../shared/game/grid/crossing';

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
  return { id, steps: [...early, world, ...(native ? worldKeys : ['renderer'] as const).map(leaf),
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
    { ...step('server', 'Server world'), weight: 0.01 }, leaf('audio')],
    ignored: native ? [] : BOOT_STEPS.filter(key => !selected.has(key)) };

}

/** Crossings retain their existing unobstructed play view; the live diagnostic uses this separate, exact phase table. */
export function crossingLoadingRows(timing: GridCrossingTiming): { key: string; label: string; ms: number }[] {
  const boundaries = [timing.requestedAt, timing.readyAt, timing.start, timing.checkpointEnd, timing.commitEnd, timing.end];
  return loadingPath('crossing').steps.map((row, index) => ({ key: row.key, label: row.label,
    ms: Math.max(0, (boundaries[index + 1] ?? 0) - (boundaries[index] ?? 0)) }));
}
