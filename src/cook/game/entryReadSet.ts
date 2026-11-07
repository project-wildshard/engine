import {controlFileHashes} from '@wildshard/format/admissionControl';
import {entryFileSteps, tierLibrarySteps} from '@wildshard/format/tierSelection';
import type {Shardfile} from '@wildshard/format/shardSchema';
import type {OutputIndex} from '@wildshard/format/outputIndex';
import {otherTierSplatFiles, wholeGeometryInputs} from '../../shared/game/shardfile/wholeInputs';
import {spawnViewSceneFiles} from '@wildshard/format/spawnView';

/** The same required, active entry selection for totals and read-ahead. Default (the Shardfile path every player gets):
 * today's entry set; streamed/late-only bodies and the other device's variants are not entry IO. `whole` (DL5, G872:
 * "no deferring level content past control"; read only with Debug > Level download > Runtime packs until a memory
 * reading backs it): the whole level on this tier, every byte its play can load, resident at control. */
export function entryReadSet(source: Shardfile, tier: 'phone' | 'desktop', index: Pick<OutputIndex, 'files' | 'sections' | 'schemas'>,
  sections: ReadonlyMap<string, unknown>, whole = false, fence: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  const required = controlFileHashes(source), steps = entryFileSteps(source, tier, {index, sections});
  let turn = steps.next(); while (turn.done !== true) turn = steps.next();
  const wanted = new Set([...index.sections, ...index.schemas].map(row => row.hash));
  // `turn.value` is what this tier streams after control today: still required, so the whole level keeps it.
  for (const file of index.files) if (required.has(file.hash) && (whole ? file.tier === undefined || file.tier === tier : !turn.value.has(file.hash))) wanted.add(file.hash);
  // `late` only schedules a library member after control (controlFileHashes leaves it out); the level still loads it
  // in play. Tile streaming loads every tile of the tier (every LOD) as the player moves; control requires none.
  const late = new Set((source.late ?? []).map(row => row.hash)), byHash = new Map(source.files.map(file => [file.hash, file]));
  const tileFiles = whole ? source.tiles.flatMap(tile => tile.files.map(ref => ref.replace(/^commons:/u, ''))) : [];
  const tierOf = new Map(index.files.map(file => [file.hash, file.tier])), seen = new Set<string>();
  // DL21: the spawn-view fence attaches a tiled scene library's chunks within its reach before control, `late` or not
  // (Nine's native-slabs: 8 files a cold visit fetched one by one inside the fence, none in this set), so the default
  // set carries them and they download with the rest, in parallel and counted.
  // DL22: and the files a recorded cold boot read before control (`fence`, the shard's fence-reads.json mapped to this
  // product's hashes): late models and props tiles the setup steps fetch on demand. A recorded read is a fact, so it
  // passes the tier check: Driftwood's phone reads 46 `models/fixed/` files tagged desktop, and left out they read loose.
  const pending = whole ? [...source.library.filter(hash => late.has(hash)), ...tileFiles] : [...spawnViewSceneFiles(sections), ...fence];
  while (pending.length > 0) {
    const hash = pending.pop(); if (hash === undefined || seen.has(hash)) continue;
    seen.add(hash); pending.push(...byHash.get(hash)?.dependencies ?? []);
    const fileTier = tierOf.get(hash);
    if (tierOf.has(hash) && (fileTier === undefined || fileTier === tier || fence.has(hash))) wanted.add(hash);
  }
  if (whole) {
    // The other device's payloads and the variants this tier never fetches: tier selection's own verdict (named
    // desktop files, the smaller texture-mode alternatives, the other tier's horizons and scene models), sp-o1's census.
    const library = tierLibrarySteps(source, tier, {index, sections}); let step = library.next(); while (step.done !== true) step = library.next();
    for (const hash of step.value) wanted.delete(hash);
    // Per-tier tables, `{phone: X, desktop: Y}` (cover cells, scene model files, held decals, lent atlases, Explorer
    // books): their loaders read `[TIER]`, so a file named only as the other tier's value is never read on this one.
    const other = tier === 'phone' ? 'desktop' : 'phone', otherOnly = new Set<string>(), elsewhere = new Set<string>();
    const walk = (value: unknown, skip: boolean): void => {
      if (typeof value === 'string') { (skip ? otherOnly : elsewhere).add(value); return; }
      if (Array.isArray(value)) { for (const item of value) walk(item, skip); return; }
      if (typeof value !== 'object' || value === null) return;
      const table = 'phone' in value && 'desktop' in value;
      for (const [key, item] of Object.entries(value)) walk(item, skip || table && key === other);
    };
    for (const value of sections.values()) walk(value, false);
    const hashOf = new Map(index.files.flatMap(file => [[file.hash, file.hash], [file.path, file.hash], ...file.name === undefined ? [] : [[file.name, file.hash] as const]] as const));
    const kept = new Set<string>(); for (const name of elsewhere) { const hash = hashOf.get(name); if (hash !== undefined) kept.add(hash); }
    const needed = new Set([...wanted].flatMap(hash => byHash.get(hash)?.dependencies ?? []));
    for (const name of otherOnly) { const hash = hashOf.get(name); if (hash !== undefined && !kept.has(hash) && !needed.has(hash)) wanted.delete(hash); }
  }
  for (const hash of otherTierSplatFiles(source, tier)) wanted.delete(hash);
  const plan = sections.get('client/plan'), features: unknown = typeof plan === 'object' && plan !== null ? Reflect.get(plan, 'features') : undefined;
  // This host starts its complete native intake before construction. These
  // are actual mandatory reads, even when a tile is outside the spawn view.
  if (Array.isArray(features) && features.some((row: unknown) => typeof row === 'object' && row !== null
    && Reflect.get(row, 'kind') === 'world.assembly' && typeof Reflect.get(row, 'library') === 'string')) {
    for (const hash of wholeGeometryInputs(source.props, true)) wanted.add(hash);
  }
  return wanted;
}
