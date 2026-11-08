/**
 * The boot plan's vocabulary — the ONE place the loading screen's steps, labels, weights and
 * byte sources are declared. Ported from game-demos/trials-gauntlet-demo `src/shared/engine/boot/steps.ts`
 * (project/archive/2026-09-22-load-perf.md §1b). Everything the loader shows is derived from these tables by
 * `createBootPlan` (`./plan.ts`); nothing downstream parses a label or sums a constant.
 * A step declared here and not run by `main.ts` is a compile error (`done` only exists on the
 * exhausted plan type).
 */
// LS7 (J188): a row's weight is its share of the Load bar, how big the stage really is. The rows a shardfile boot runs
// (renderer, weapon, menu, shaders, firstFrame, audio) are its measured seconds: Sunscar Dunes, phone tier, the
// iPhone 16 Pro profile at 4x CPU and 12.8 Mbit/s in headless Chromium (scripts/loading-card-proof.mjs --throttle
// --dump, game-stage spans, 2026-11-08): renderer 0.14 s, weapon 0.00, menu 0.00, shaders 0.59, firstFrame 6.67,
// audio 0.00. A stage measured at 0 keeps 0.01, the path's no-share floor (loadingPaths.ts); the path's own rows
// weigh 1 each, about the 0.4 to 1.8 s its modules, world, loadout and gameplay rows took. The other rows (the legacy
// native path's world steps) are not measured here and keep their old weights.
// The shared nouns are neutral (the default shard is Driftwood Isle, a low-poly island with no pines, cabins or HDRI);
// a level names its own downloads and steps through authored boot data.
const STEP_ROWS: readonly [readonly ["renderer", "Renderer", 0.1], readonly ["sky", "Sky · lighting", 1], readonly ["terrain", "Terrain · heightfield", 2], readonly ["cards", "Tree cards", 1], readonly ["forest", "Trees", 2], readonly ["physics", "Physics · Rapier · navmesh", 1], readonly ["edge", "Chunk edge · water · horizon", 1], readonly ["grass", "Grass · ground cover", 2], readonly ["cabins", "Buildings", 2], readonly ["props", "Props", 1], readonly ["animals", "Animals", 1], readonly ["weapon", "Weapons · HUD", 0.01], readonly ["assembly", "World assembly", 1], readonly ["menu", "Title art · explore", 0.01], readonly ["shaders", "Shaders", 0.6], readonly ["firstFrame", "First frame", 6.7], readonly ["audio", "Audio · music + sound effects", 0.01]] = [
  ['renderer', 'Renderer', 0.1],
  ['sky', 'Sky · lighting', 1],
  ['terrain', 'Terrain · heightfield', 2],
  ['cards', 'Tree cards', 1],
  ['forest', 'Trees', 2],
  ['physics', 'Physics · Rapier · navmesh', 1],
  ['edge', 'Chunk edge · water · horizon', 1],
  ['grass', 'Grass · ground cover', 2],
  ['cabins', 'Buildings', 2],
  ['props', 'Props', 1],
  ['animals', 'Animals', 1],
  ['weapon', 'Weapons · HUD', 0.01],
  ['assembly', 'World assembly', 1],
  // project/archive/2026-09-23-preload-offline.md: the title / explore art and the lazy UI code (before the title builds its deck)
  ['menu', 'Title art · explore', 0.01],
  ['shaders', 'Shaders', 0.6],
  ['firstFrame', 'First frame', 6.7],
  // last, so the shaders compile while it downloads: every audio file (all styles, all sets), the selected music style +
  // sound-effect set decoded as their bytes land — nothing is fetched after the bar (project/archive/2026-09-23-preload-offline.md)
  ['audio', 'Audio · music + sound effects', 0.01],
] as const satisfies readonly (readonly [string, string, number])[];
export type BootStep = (typeof STEP_ROWS)[number][0];
export interface StepInfo { readonly label: string; readonly weight: number }
const BASE_INFO = Object.fromEntries(STEP_ROWS.map(([key, label, weight]) => [key, { label, weight }])) as Record<BootStep, StepInfo>;
/** The step table as this shard shows it: the rows above, with its own nouns and weights over them (`useShardSteps`). */
export const STEP_INFO: Record<BootStep, StepInfo> = { ...BASE_INFO };
/** The steps in declared order. */
export const BOOT_STEPS = STEP_ROWS.map((row) => row[0]) as readonly BootStep[];

let ownBytes: Readonly<Partial<Record<ByteKey, string>>> | undefined;
/**
 * The active shard's nouns + weights over the table (main.ts, before the boot plan is made). A shard without its own
 * rows keeps the shared table exactly. No per-level timing history is recorded.
 */
export function useShardSteps(steps?: Readonly<Record<string, { label: string; weight: number }>>, bytes?: Readonly<Partial<Record<ByteKey, string>>>): void {
  ownBytes = bytes;
  for (const k of BOOT_STEPS) STEP_INFO[k] = { label: steps?.[k]?.label ?? BASE_INFO[k].label, weight: steps?.[k]?.weight ?? BASE_INFO[k].weight };
}

/**
 * DOWNLOAD byte sources: the bytes boot awaits, each reported by the reader that reads them and
 * CLOSED (read := total) by the step whose completion proves they were consumed. A source is in
 * the number because it is in this table, and complete because its step is — `done()` reads 1
 * by arithmetic, never by reclassification.
 */
export const BYTE_SOURCES = ['sky', 'baked', 'terrain', 'trees', 'physics', 'cabins', 'props', 'art', 'music', 'sfx'] as const;
export type ByteKey = (typeof BYTE_SOURCES)[number];
const CLOSED_BY: Record<ByteKey, BootStep> = { sky: 'sky', baked: 'sky', terrain: 'terrain', trees: 'cards', physics: 'physics', cabins: 'cabins', props: 'props', art: 'menu', music: 'audio', sfx: 'audio' };
export const closedBy = (key: ByteKey): BootStep => CLOSED_BY[key];
const LABELS: Partial<Record<ByteKey, string>> = { trees: 'tree bark · twigs', baked: 'baked textures', art: 'title art', music: 'music · every style', sfx: 'sound effects · every set' };
// A level may override each shared download noun through its boot byte labels.
export const byteLabel = (key: ByteKey): string => ownBytes?.[key] ?? LABELS[key] ?? STEP_INFO[closedBy(key)].label.toLowerCase();
