import { sceneWeldBytes } from '@wildshard/format/worldScenePages';
import { sceneFileKey, type SceneFileReference, type WorldSceneWeld } from '@wildshard/format/worldSceneWeld';
import { playLibrarySteps } from '@wildshard/format/admissionControl';
import { stringsSteps, tierLibrarySteps, entryFileSteps } from '@wildshard/format/tierSelection';
import { parseImageAsset } from '@wildshard/format/stillImage';
import { journalImageRefs } from '@wildshard/format/compendiumRows';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { TextureTranscodeSupport } from '@wildshard/format/contentBounds';
import type { worstContentCost } from '@wildshard/format/budget';
import { deviceLibraryCostSteps } from '@wildshard/format/deviceMemoryCost';
import { frameBudgetSpent } from '@wildshard/engine/core/framePacing';
import { preflightShardfile, preflightShardfileSteps } from '@wildshard/format/preflight';
import { jsonDataHeapBytes } from '@wildshard/format/json';
import { outputDescriptor, isBuildValidatedOutput } from '../../../shared/game/shardfile/outputDescriptor';
import { otherTierSplatFiles } from '../../../shared/game/shardfile/wholeInputs';
import {builtProductPostCost} from '@wildshard/format/validationReceipt';
import {postStackCost,type PostStackCost} from '@wildshard/format/postStack';
import { isPlatformDataSection } from '@wildshard/format/outputFields';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { parseWorldSceneModels, worldSceneModelGraphs, worldSceneModelResources } from '@wildshard/format/worldSceneModels';
import { plumbingKnob } from '../shard/declaredPlumbing';
import { recordSceneProfile } from './sceneProfile';

/** View-scoped frozen specimens retain at most the current model and its two
 * tier comparisons. Reserve a fourth complete choice for a cancelled decoder.
 * Each choice includes its intake CPU storage and a copied draw geometry.
 * World geometry, transport, external readers and dependencies stay charged. */
interface SpecimenQuality { readonly tier: 'phone' | 'desktop'; readonly overrides?: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>> }
export function scopedSpecimenLibrarySource(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, quality?: SpecimenQuality): Shardfile {
  const costs = specimenCosts(source, assets, quality);
  let result = costs.next();
  while (!result.done) result = costs.next();
  return result.value;
}

/** Run `steps` to its result, pausing after each 8 ms of them, or sooner once the frame's shared build budget is spent:
 *  the grid admits several products at once, and their own clocks alone stacked 45-65 ms of steps into one Pine frame
 *  (a live admission paints in between). */
const drive = <T>(steps: Generator<void, T>): T => { for (;;) { const step = steps.next(); if (step.done === true) return step.value; } };

async function paced<T>(steps: Generator<void, T>, pause: () => Promise<void>): Promise<T> {
  let started = diagnosticNow(), result = steps.next();
  while (result.done !== true) {
    if (diagnosticNow() - started >= 8 || frameBudgetSpent(8)) { await pause(); started = diagnosticNow(); }
    result = steps.next();
  }
  return result.value;
}

/** This device's worst-disc cost of `source` (`deviceLibraryCostSteps`), paced like the specimen projection. */
export function deviceLibraryCostPaced(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, support: TextureTranscodeSupport,
  pause: (() => Promise<void>) | undefined, validatedSource?: Shardfile): Promise<ReturnType<typeof worstContentCost>> {
  // Projected budgets may change, but only exact original file objects inherit the build's body-cost proof.
  const original = validatedSource !== undefined && isBuildValidatedOutput(validatedSource) ? validatedSource : undefined;
  const facts = original === undefined ? undefined : outputDescriptor(original)?.index.ktx2Costs;
  const files = new Set(original?.files);
  const costs = new Map(source.files.flatMap(file => {
    const known = facts?.[file.hash];
    return file.kind === 'ktx2' && files.has(file) && known !== undefined ? [[file.hash, known] as const] : [];
  }));
  return paced(deviceLibraryCostSteps(source, assets, support, costs), pause ?? (() => Promise.resolve()));
}

/** Same complete cost projection, allowing live admission to paint between catalogue choices. */
export async function scopedSpecimenLibrarySourcePaced(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, quality: SpecimenQuality | undefined, pause: (() => Promise<void>) | undefined): Promise<Shardfile> {
  if (pause === undefined) return scopedSpecimenLibrarySource(source, assets, quality);
  await pause();
  return paced(specimenCosts(source, assets, quality), pause);
}

function* specimenCosts(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, quality?: SpecimenQuality): Generator<void, Shardfile> {
  const descriptor = outputDescriptor(source), input = descriptor?.sections.get('world/scenes');
  if (descriptor === undefined || input === undefined) return source;
  const scenes = parseWorldScenes(input);
  if (scenes.catalogue === undefined) return source;
  const names = new Map<string, string>();
  for (const file of descriptor.index.files) for (const name of [file.hash, file.path, `/shardfiles/${source.identity.slug}/${file.path}`, ...file.name === undefined ? [] : [file.name]]) names.set(name, file.hash);
  // H4: multiple names and quality leaves may refer to the same verified wire.
  // Keep only the most recent graph within this projection, never a growing
  // parsed copy of the whole wire bank or a cache across admissions.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let recentWeld: { hash: string; value: WorldSceneWeld } | undefined;
  const read = (name: string): unknown => {
    const hash = names.get(name), bytes = hash === undefined ? undefined : assets.get(hash);
    if (hash === undefined || bytes === undefined) throw new Error(`Missing specimen cost bytes: ${name}`);
    return JSON.parse(decoder.decode(bytes));
  };
  const checkedWeld = (reference: SceneFileReference): WorldSceneWeld => {
    const name = reference.file, hash = names.get(name);
    if (hash === undefined) throw new Error(`Missing specimen cost bytes: ${name}`);
    const key = sceneFileKey(reference);
    if (recentWeld?.hash === key) return recentWeld.value;
    const bytes = assets.get(hash);
    if (bytes === undefined) throw new Error(`Missing specimen cost bytes: ${name}`);
    const value = sceneWeldBytes(bytes, reference); recentWeld = { hash: key, value }; return value;
  };
  const catalogue = parseWorldSceneModels(read(scenes.catalogue));
  yield;
  const libraries = new Map(scenes.libraries.filter(row => row.kind === 'owned').map(row => [row.id, row]));
  const files = new Map(source.files.map(file => [file.hash, file]));
  const refs = (library: string, model: string): string[] => {
    const row = libraries.get(library)?.models.find(entry => entry.id === model);
    return row === undefined ? [] : [typeof row.file === 'string' ? [row.file] : Object.values(row.file), row.segments ?? []].flat().map(name => {
      const hash = names.get(name); if (hash === undefined) throw new Error('Missing specimen geometry cost'); return hash;
    });
  };
  const eligible = new Set<string>(), retained = new Set(source.critical);
  if (quality !== undefined) for (const library of libraries.values()) for (const model of library.models) for (const hash of refs(library.id, model.id)) eligible.add(hash);
  let largest = 0, unreadDemand = false;
  for (const model of catalogue.models) {
    for (const choice of model.choices) {
      const leaves = worldSceneModelGraphs(choice);
      // A cold-only document has no admitted body yet. Its geometry remains
      // fully charged rather than fetching the body merely to claim a saving.
      // Unknown inventory and ordinary missing bodies retain their refusal.
      let unread = false;
      for (const leaf of leaves) if ('file' in leaf) {
        const hash = names.get(leaf.file);
        if (hash === undefined) throw new Error(`Missing specimen cost bytes: ${leaf.file}`);
        if (!assets.has(hash) && model.load === 'demand') unread = true;
      }
      if (unread) { unreadDemand = true; yield; continue; }
      const graphs = leaves.map(leaf => 'file' in leaf ? checkedWeld(leaf) : leaf);
      const resources = worldSceneModelResources({ ...catalogue, models: [{ ...model, choices: [choice] }] }, graphs);
      const hashes = new Set(resources.geometry.flatMap(ref => refs(ref.library, ref.model)));
      if (model.assembly !== 'scene') { for (const hash of hashes) retained.add(hash); yield; continue; }
      for (const hash of hashes) eligible.add(hash);
      // A view resolves exactly one topology leaf. Admission still checks all
      // leaves; a union of mutually exclusive leaves is not one resident copy.
      // Only the admitted knob branch can be viewed (another quality reloads and
      // re-admits); both of its tier comparisons stay reserved.
      const scene = choice.scene, selectedLeaves = quality === undefined || scene === undefined || !('knob' in scene) ? undefined
        : worldSceneModelGraphs({ ...choice, scene: scene[plumbingKnob(source.plumbing, quality.tier, scene.knob, 'boolean', quality.overrides) ? 'true' : 'false'] });
      // Every leaf was parsed above, before the first yield for this choice.
      const viewable = selectedLeaves === undefined ? graphs : graphs.filter((_graph, index) => { const leaf = leaves[index]; return leaf !== undefined && selectedLeaves.includes(leaf); });
      for (const graph of viewable) {
        const selected = worldSceneModelResources({ ...catalogue, models: [{ ...model, choices: [{ ...choice, scene: graph }] }] });
        const selectedHashes = new Set(selected.geometry.flatMap(ref => refs(ref.library, ref.model)));
        largest = Math.max(largest, [...selectedHashes].reduce((sum, hash) => { const file = files.get(hash); if (file === undefined) throw new Error('Missing specimen file cost'); return sum + file.decoded + file.gpu * 2; }, 0));
        yield;
      }
    }
  }
  // Only strings and containers can retain geometry. Scan keys directly rather
  // than allocating entry pairs and recursing through every numeric pose word.
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { const hash = names.get(value); if (hash !== undefined) retained.add(hash); }
    else if (Array.isArray(value)) for (const child of value) { if (typeof child === 'string' || typeof child === 'object' && child !== null) visit(child); }
    else if (typeof value === 'object' && value !== null) {
      if ('library' in value && 'model' in value && typeof value.library === 'string' && typeof value.model === 'string') for (const hash of refs(value.library, value.model)) retained.add(hash);
      const row = value as Readonly<Record<string, unknown>>;
      for (const key of Object.keys(row)) {
        const hash = names.get(key); if (hash !== undefined) retained.add(hash);
        const child = row[key]; if (typeof child === 'string' || typeof child === 'object' && child !== null) visit(child);
      }
    }
  };
  const { files: _files, library: _library, critical: _critical, late: _late, ...fields } = source;
  visit(fields);
  yield;
  for (const [name, row] of descriptor.sections) {
    if (name !== 'world/scenes') { visit(row); yield; continue; }
    const { libraries: _libraries, catalogue: _catalogue, ...world } = scenes;
    visit(world);
    yield;
  }
  const selectedFiles: string[] = [];
  for (const weld of scenes.welds) {
    if (quality !== undefined) {
      const file = typeof weld.file === 'object' && 'knob' in weld.file ? weld.file[plumbingKnob(source.plumbing, quality.tier, weld.file.knob, 'boolean', quality.overrides) ? 'true' : 'false'] : weld.file;
      const selected = typeof file === 'string' || 'file' in file ? file : file[quality.tier];
      const reference = typeof selected === 'string' ? { file: selected } : selected;
      selectedFiles.push(sceneFileKey(reference)); visit(checkedWeld(reference)); yield; continue;
    }
    const variants = typeof weld.file === 'object' && 'knob' in weld.file ? [weld.file.false, weld.file.true] : [weld.file];
    for (const variant of variants) for (const name of typeof variant === 'string' || 'file' in variant ? [variant] : [variant.phone, variant.desktop]) {
      visit(checkedWeld(typeof name === 'string' ? { file: name } : name)); yield;
    }
  }
  if (quality !== undefined) recordSceneProfile(source, selectedFiles);
  for (const file of source.files) for (const dependency of file.dependencies) retained.add(dependency);
  const charged = new Set(source.library);
  const removable = source.files.reduce((sum, file) => sum + (charged.has(file.hash) && eligible.has(file.hash) && !retained.has(file.hash) ? file.decoded + file.gpu : 0), 0);
  const saving = unreadDemand ? 0 : Math.max(0, removable - largest * 4);
  return saving === 0 ? source : { ...source, budgets: { ...source.budgets, library: { ...source.budgets.library, resident: Math.max(0, source.budgets.library.resident - saving) } } };
}

/** Project only exclusive alternatives selected by existing typed presentation hosts.
 * Transport stays fully charged. References elsewhere or dependencies keep an asset resident;
 * arbitrary runtime names and unselected scene batches are never treated as tier selectors. */
export function tierLibrarySource(source: Shardfile, tier: 'phone' | 'desktop', assets?: ReadonlyMap<string, Uint8Array>): Shardfile {
  return drive(tierLibrarySourceSteps(source, tier, assets));
}
/** `tierLibrarySource`, paced like the admission's other projections. */
export function tierLibrarySourcePaced(source: Shardfile, tier: 'phone' | 'desktop', assets: ReadonlyMap<string, Uint8Array>, pause: (() => Promise<void>) | undefined): Promise<Shardfile> {
  return paced(tierLibrarySourceSteps(source, tier, assets), pause ?? (() => Promise.resolve()));
}
/** Typed alternatives which no critical, shared or dependency reader needs can
 * stay on disk. The full descriptor remains available for verified late reads.
 * The boot compiler and runtime use this same selection before declaring bytes. */
export async function tierProductFilesPaced(source: Shardfile, tier: 'phone' | 'desktop', pause?: () => Promise<void>, splatTier: () => 'phone' | 'desktop' = () => tier): Promise<Shardfile['files']> {
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) return source.files;
  const inactive = await paced(entryFileSteps(source, tier, descriptor), pause ?? (() => Promise.resolve()));
  const splat = otherTierSplatFiles(source, splatTier);
  return inactive.size === 0 && splat.size === 0 ? source.files : source.files.filter(file => !inactive.has(file.hash) && !splat.has(file.hash));
}
function* tierLibrarySourceSteps(source: Shardfile, tier: 'phone' | 'desktop', assets?: ReadonlyMap<string, Uint8Array>): Generator<void, Shardfile> {
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) return source;
  const excluded = yield* tierLibrarySteps(source, tier, descriptor, assets);
  if (excluded.size === 0) return source;
  const library = new Set(source.library), saving = source.files.reduce((sum, file) =>
    sum + (library.has(file.hash) && excluded.has(file.hash) ? file.decoded + file.gpu : 0), 0);
  return { ...source, library: source.library.filter(hash => !excluded.has(hash)), budgets: {
    ...source.budgets, library: { ...source.budgets.library, resident: Math.max(0, source.budgets.library.resident - saving) },
  } };
}

/** D122: a whole library the world loads only for the Explorer (`load: 'explorer'`, read cold by a specimen) is never
 *  resident in play, so its files leave the play charge. A file stays charged when anything else names it: a played
 *  library, a tile, the critical set, another file's dependencies or any other section or field. `props.wholeLibrary`
 *  counts as a reader only when the client plan assembles an island library (its fixed draws read the whole library by
 *  slug in play); otherwise only the Explorer and bakes read it. */
export function playLibrarySource(source: Shardfile): Shardfile {
  return drive(playLibrarySourceSteps(source));
}
/** `playLibrarySource`, paced like the admission's other projections. */
export function playLibrarySourcePaced(source: Shardfile, pause: (() => Promise<void>) | undefined): Promise<Shardfile> {
  return paced(playLibrarySourceSteps(source), pause ?? (() => Promise.resolve()));
}
function* playLibrarySourceSteps(source: Shardfile): Generator<void, Shardfile> {
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) return source;
  const excluded = yield* playLibrarySteps(source, descriptor);
  const library = new Set(source.library);
  let saving = 0;
  for (const file of source.files) if (library.has(file.hash) && excluded.has(file.hash)) saving += file.decoded + file.gpu;
  if (excluded.size === 0) return source;
  return { ...source, library: source.library.filter(hash => !excluded.has(hash)), budgets: { ...source.budgets, library: { ...source.budgets.library, resident: Math.max(0, source.budgets.library.resident - saving) } } };
}

/** Immutable manifest/journal URLs never create the data-URL string charged by image intake.
 * Keep one wire copy, CPU pixels and compositor pixels. Any other reader retains the full envelope. */
export function urlImageLibrarySource(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, verifiedMissingImages: ReadonlySet<string> = new Set()): Shardfile {
  return drive(urlImageLibrarySourceSteps(source, assets, verifiedMissingImages));
}
/** `urlImageLibrarySource`, paced like the admission's other projections. */
export function urlImageLibrarySourcePaced(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, pause: (() => Promise<void>) | undefined, verifiedMissingImages: ReadonlySet<string> = new Set()): Promise<Shardfile> {
  return paced(urlImageLibrarySourceSteps(source, assets, verifiedMissingImages), pause ?? (() => Promise.resolve()));
}
function* urlImageLibrarySourceSteps(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, verifiedMissingImages: ReadonlySet<string>): Generator<void, Shardfile> {
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) return source;
  const names = new Map<string, string>();
  for (const file of descriptor.index.files) if (file.kind === 'image') {
    names.set(file.hash, file.hash); names.set(file.path, file.hash);
    names.set(`/shardfiles/${source.identity.slug}/${file.path}`, file.hash);
    if (file.name !== undefined) names.set(file.name, file.hash);
  }
  const eligible = new Set<string>(), other = new Set<string>();
  const into = (set: Set<string>) => (text: string): void => { const hash = names.get(text); if (hash !== undefined) set.add(hash); };
  yield* stringsSteps([source.manifest], into(eligible));
  const compendiums = source.rows.compendiums.map(row => {
    if (!('kind' in row)) return row;
    for (const ref of journalImageRefs(row)) { const hash = names.get(ref); if (hash !== undefined) eligible.add(hash); }
    return { ...row, entries: row.entries.map(entry => {
      const { sketch: _sketch, silhouette: _silhouette, ...plate } = entry.plate;
      return { ...entry, plate };
    }), ...(row.chalk === undefined ? {} : { chalk: { ...row.chalk, atlas: '' } }) };
  });
  const { files: _files, library: _library, critical: _critical, manifest: _manifest, late: _late, rows, ...fields } = source;
  // These two typed sections are already represented by source.manifest/source.rows.
  const sections: unknown[] = [];
  for (const [name, section] of descriptor.sections) if (name !== 'ui/level' && name !== 'ui/compendium') sections.push(section);
  yield* stringsSteps([{ ...fields, rows: { ...rows, compendiums } }, ...sections], into(other));
  for (const file of source.files) for (const ref of file.dependencies) other.add(ref);
  const library = new Set(source.library);
  let saving = 0;
  for (const file of source.files) {
    if (!library.has(file.hash) || !eligible.has(file.hash) || other.has(file.hash)) continue;
    const bytes = assets.get(file.hash);
    if (bytes === undefined) {
      // An exact receipt proves decoded >= pixels + 4 * wire. The URL path
      // creates no base64 string, so the same saving is exactly 3 * wire;
      // pixels and one wire copy stay reserved even before the URL is viewed.
      if (verifiedMissingImages.has(file.hash)) saving += file.compressed * 3;
      continue;
    }
    const image = parseImageAsset(bytes);
    saving += Math.max(0, Math.min(file.decoded, image.decoded) - image.gpu - bytes.length);
  }
  if (saving === 0) return source;
  return { ...source, budgets: { ...source.budgets, library: { ...source.budgets.library,
    resident: Math.max(0, source.budgets.library.resident - saving) } } };
}

/** Conservative heap estimate for a bounded plain-JSON source or its owned projection, including strings and container overhead. */
export function jsonResidentBytes(input: unknown): number {
  const bytes = jsonDataHeapBytes(input);
  if (bytes === undefined) throw new Error('Product residency needs bounded plain JSON');
  return bytes;
}
/** Reuse publication's graph cost; only Node/external sources need to validate graph bytes here. */
export function productPostCost(source:Shardfile,bytes:(hash:string)=>Uint8Array|undefined):PostStackCost{
  const descriptor=outputDescriptor(source);
  if(descriptor?.built===true){
    const cost=builtProductPostCost(descriptor.index.build.sourceHash);
    if(cost===undefined)throw new Error('Build must publish post cost');
    return cost;
  }
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned post cost');
  return postStackCost(source,bytes).cost;
}
/** The wire a product claim holds: every file's and common's compressed bytes. The grid's transport release
 * (`accountTransportRelease`) shrinks the claim by each released file's `compressed`, so a claim below this would
 * shrink past zero. A build-stamped residency is static evidence that a repack can carry stale (Brasscap rev 3's
 * receipt says 2.93 MB over 4.67 MB of wire), so it never claims less than this floor. */
function productWireBytes(source: Shardfile): number {
  return source.files.reduce((sum, file) => sum + file.compressed, 0)
    + source.requires.commons.reduce((sum, hash) => sum + (source.requires.commonsWire[hash] ?? 0), 0);
}
/** Conservative transport/source heap claim: two parsed-source copies, owned asset buffers and map/object overhead. */
export function productResidentBytes(source: Shardfile): number {
  const emitted=outputDescriptor(source);
  if(emitted?.built===true){if(emitted.residentBytes===undefined)throw new Error('Build must publish source residency');return Math.max(emitted.residentBytes,productWireBytes(source));}
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned residency');
  const accounting = { heapBytes: 0 };
  preflightShardfile(source, accounting);
  // File/common aliases are copied into separate owned buffers by admitProduct, so count each actual Map entry.
  const wire = productWireBytes(source);
  // The source-size walk already counted this exact tree. Reuse that
  // accounting without another residency-only traversal.
  return wire + accounting.heapBytes * 2 + (source.files.length + source.requires.commons.length) * 128 + 1024;
}

/** `productResidentBytes` in steps of `every` visited values, the same checks, refusals and bytes (T10: one admission walked a
 *  whole source in one drawn frame of a drive, 23-34 ms at phone 4x). The source must not change between steps. */
export function* productResidentBytesSteps(source: Shardfile, every = 4096): Generator<void, number> {
  const emitted=outputDescriptor(source);
  if(emitted?.built===true){if(emitted.residentBytes===undefined)throw new Error('Build must publish source residency');return Math.max(emitted.residentBytes,productWireBytes(source));}
  if(!(import.meta.env?.SSR??true))throw new Error('Client product needs its build-owned residency');
  const accounting = { heapBytes: 0 };
  yield* preflightShardfileSteps(source, every, accounting);
  const wire = productWireBytes(source);
  return wire + accounting.heapBytes * 2 + (source.files.length + source.requires.commons.length) * 128 + 1024;
}
/** Files read only through the asynchronous runtime product API. Inventory membership is not a use:
 * retain every host-declared reference and its dependency closure for synchronous neighbour/simulation readers. */
export function runtimeOnlyProductFiles(source: Shardfile): readonly string[] {
  const steps = runtimeOnlyProductFilesSteps(source);
  for (;;) { const step = steps.next(); if (step.done === true) return step.value; }
}
/** `runtimeOnlyProductFiles` in steps of 4096 visited values (its walk over a whole product was ~45 ms of a frame). */
function* runtimeOnlyProductFilesSteps(source: Shardfile, unread: ReadonlySet<string> = new Set()): Generator<void, readonly string[]> {
  let visited = 0;
  const files = new Map(source.files.map(file => [file.hash, file])), keep = new Set<string>();
  const descriptor = outputDescriptor(source), paths = new Map(descriptor?.index.files.map(file => [file.path, file.hash]));
  const { late: _late, ...consumed } = source; // scheduling metadata is not a synchronous transport read
  const pending: unknown[] = [{ ...consumed, files: [], critical: [], library: [] },
    ...[...descriptor?.sections ?? []].flatMap(([name, value]) => isPlatformDataSection(name) && !unread.has(name) ? [value] : [])];
  // O14: only strings can name a file: numbers, booleans and nulls (most of a product's rows) are never queued
  const queue = (item: unknown): void => { if (typeof item === 'string' || typeof item === 'object' && item !== null) pending.push(item); };
  while (pending.length > 0) {
    const value = pending.pop();
    if (++visited % 4096 === 0) yield;
    if (typeof value === 'string') { const ref = paths.get(value) ?? value; if (files.has(ref)) keep.add(ref); }
    else if (Array.isArray(value)) { const items: readonly unknown[] = value; for (const item of items) queue(item); }
    else if (typeof value === 'object' && value !== null) {
      // Keep both own keys and children in the same worklist order: a sampler's
      // property name can itself be a synchronous file reference.
      const fields = value as Readonly<Record<string, unknown>>;
      for (const key of Object.keys(value)) { pending.push(key); queue(fields[key]); }
    }
  }
  const dependencies = [...keep];
  while (dependencies.length > 0) {
    const ref = dependencies.pop();
    if (ref === undefined) continue;
    for (const dependency of files.get(ref)?.dependencies ?? []) {
      if (keep.has(dependency)) continue;
      keep.add(dependency); dependencies.push(dependency);
    }
  }
  return source.files.filter(file => !keep.has(file.hash)).map(file => file.hash);
}

/** Platform sections no neighbour reads synchronously: world scenes read their files through the product's `file()`. */
const NEIGHBOUR_UNREAD: ReadonlySet<string> = new Set(['world/scenes']);
/** Neighbours stream terrain, props tiles and placeholders through ClientAssets.read; bound whole geometry belongs to the entered runtime.
 * Keep every synchronous panel, material, physics and simulation reference, including dependencies shared with a tile.
 * World scenes read every file through the product's asynchronous `file()` (a released file is read again from the
 * cache or the network), so a neighbour holds none of its scene-only bytes (Nine's world GLBs were ~100 MB of a phone
 * renderer). */
export function neighbourProductFiles(source: Shardfile): readonly string[] {
  const steps = runtimeOnlyProductFilesSteps(neighbourSource(source), NEIGHBOUR_UNREAD);
  for (;;) { const step = steps.next(); if (step.done === true) return step.value; }
}
const neighbourWalks = new WeakMap<Shardfile, Promise<readonly string[]>>();
/** `neighbourProductFiles` paced like admission, walked once per admitted source (its pins, then its release). */
export function neighbourProductFilesPaced(source: Shardfile, pause: (() => Promise<void>) | undefined): Promise<readonly string[]> {
  let walk = neighbourWalks.get(source);
  if (walk === undefined) { walk = paced(runtimeOnlyProductFilesSteps(neighbourSource(source), NEIGHBOUR_UNREAD), pause ?? (() => Promise.resolve())); neighbourWalks.set(source, walk); }
  return walk;
}
/** `runtimeOnlyProductFiles` paced like admission. */
export function runtimeOnlyProductFilesPaced(source: Shardfile, pause: (() => Promise<void>) | undefined): Promise<readonly string[]> {
  return paced(runtimeOnlyProductFilesSteps(source), pause ?? (() => Promise.resolve()));
}
function neighbourSource(source: Shardfile): Shardfile {
  const props = source.props;
  const boundProps = source.runtime?.binds?.includes('props') === true;
  const boundTerrain = source.runtime?.binds?.includes('terrain') === true;
  const { near: _near, ...drawn } = source;
  return { ...drawn, tiles: [], far: null,
    terrain: source.terrain === null || boundTerrain ? null : { ...source.terrain, tiles: [] },
    props: props === null ? null : { ...props, tiles: [], far: null,
      ...(boundProps ? { models: [], wholeLibrary: [] } : {}),
      // The model key selects a colour map; material compilation only consumes its colour bytes.
      textures: props.textures.map(({ colour }) => ({ model: '', colour })) } };
}
