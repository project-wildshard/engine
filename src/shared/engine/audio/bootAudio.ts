/**
 * AUDIO AU1 (J299): which recordings a level's boot reads, as one pure selection over the asset tables
 * (`../boot/tables`). The client's level profiles (`client/engine/audio/levelAudio.ts`) and the cook
 * (`cook/game/entryTotals.ts`) both call it, so the cook lists in a shard's spawn manifest exactly the files LOAD
 * reads, and DOWNLOAD fetches, counts and caches them. Nothing here fetches, decodes or reads a setting: the music
 * style and sound-effect set are arguments.
 */
import type { AudioData } from '@wildshard/format/audio';
import { musicManifests, publicBytes, sfxManifests } from '../boot/tables';

export const MUSIC_STYLES = ['piano', 'orchestral', 'folk', 'synth'] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];
export const SFX_SETS = ['best'] as const;
export type SfxSet = 'best' | 'synth';
/** A new player's choices (Settings): the files the cook puts in DOWNLOAD. */
export const DEFAULT_MUSIC_STYLE: MusicStyle = 'piano';
export const DEFAULT_SFX_SET: SfxSet = 'best';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- inventories (the generated manifests, the selected style and set first) ----

const AUDIO_RE = /\.(m4a|mp3|ogg|opus|wav|webm|flac)$/;
/** every audio file name a manifest mentions, wherever it sits (slots, stings, beds, hums, one-shot variants) */
export function manifestFiles(m: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (AUDIO_RE.test(v) && !v.includes('..') && !v.includes('/')) out.push(v); }
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) walk(x);
  };
  walk(m);
  return [...new Set(out)];
}
/** the selected one first, then the rest in the menu's order; only those the build has a manifest for */
function ordered<T extends string>(all: readonly T[], selected: string, manifests: Readonly<Record<string, unknown>>): T[] {
  const have = all.filter((v) => Object.hasOwn(manifests, v));
  return [...have.filter((v) => v === selected), ...have.filter((v) => v !== selected)];
}
export const musicStylesFor = (style: MusicStyle): string[] => ordered(MUSIC_STYLES, style, musicManifests());
export const sfxSetsFor = (set: SfxSet): string[] => ordered(SFX_SETS, set, sfxManifests());
const filesOf = (dir: string, manifest: unknown): string[] => manifestFiles(manifest).map((f) => `${dir}${f}`).filter((p) => p in publicBytes()); // a file the build does not ship is never asked for
export const musicDir = (style: string): string => `/assets/music/${style}/`;
export const sfxDir = (set: string): string => `/assets/sfx/${set}/`;
/** the manifest without `drop`'s slots */
function withoutSlots(m: unknown, drop: readonly string[]): unknown {
  if (drop.length === 0 || typeof m !== 'object' || m === null || Array.isArray(m)) return m;
  const slots: unknown = (m as Record<string, unknown>)['slots'];
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) return m;
  return { ...m, slots: Object.fromEntries(Object.entries(slots).filter(([k]) => !drop.includes(k))) };
}
/** Shared style/set files, followed by the level profile's own sets. */
export interface AudioFilePolicy {
  omitSlots?: readonly string[];
  musicSets?: readonly string[];
  sfxSets?: readonly string[];
  omitSfx?: Readonly<Record<string, readonly string[]>>;
}
export function audioFilesFor(style: MusicStyle, set: SfxSet, policy: AudioFilePolicy = {}): { music: string[]; sfx: string[] } {
  return {
    music: [...musicStylesFor(style).flatMap((s) => filesOf(musicDir(s), withoutSlots(musicManifests()[s], policy.omitSlots ?? []))), ...(policy.musicSets ?? []).flatMap((s) => filesOf(musicDir(s), musicManifests()[s]))],
    sfx: [...sfxSetsFor(set).flatMap((s) => filesOf(sfxDir(s), sfxManifests()[s]).filter((url) => !(policy.omitSfx?.[s] ?? []).includes(url.slice(sfxDir(s).length)))), ...(policy.sfxSets ?? []).flatMap((s) => filesOf(sfxDir(s), sfxManifests()[s]))],
  };
}

// ---- music styles (music.json) ----

/** the build's file table (vite.config.ts writes it from public/assets): a file the build does not have is never fetched —
 *  no 404 in the console, no request at all while the generated music has not landed */
export const shipped = (path: string): boolean => path in publicBytes();
/** Score-source slot names are content data, including sets registered by a level. */
export type SlotName = string;
export type StemSting = 'pickup' | 'death' | 'chunk' | 'dawn';
/** a music set: 'base' = the genre's own folder (`<genre>/`), any other id = a level's set folder (`<set>-<genre>/`) */
export type MusicSet = string;
export type BossPhase = 1 | 2 | 3;
export interface SlotSpec {
  /** the calm stem (a theme slot), the full mix (title) or the base (boss) — file names relative to the manifest */
  calm: string; tension: string | undefined;
  /** the boss's extra layers (bass, drums), each gained per phase by `phases` */
  layers: string[];
  phases: Partial<Record<BossPhase, number[]>>;
  bpm: number; beatsPerBar: number; loopStart: number; loopEnd: number; duration: number;
}
export interface MusicManifest { genre: string; credit: string; slots: Partial<Record<string, SlotSpec>>; stings: Partial<Record<StemSting, string>> }
export const STINGS: StemSting[] = ['pickup', 'death', 'chunk', 'dawn'];
const PHASES: BossPhase[] = [1, 2, 3];
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && !v.includes('..') ? v : undefined);
function parseSlot(v: unknown): SlotSpec | undefined {
  if (!isObj(v)) return undefined;
  const calm = str(v['calm']) ?? str(v['full']), bpm = num(v['bpm']), loopStart = num(v['loopStart']) ?? 0, loopEnd = num(v['loopEnd']);
  if (calm === undefined || bpm === undefined || bpm < 30 || bpm > 260 || loopEnd === undefined || loopEnd <= loopStart + 0.5) return undefined;
  const lv = v['layers'], layers = Array.isArray(lv) ? lv.map(str).filter((f): f is string => f !== undefined) : [];
  const phases: Partial<Record<BossPhase, number[]>> = {}, pv = v['phases'];
  if (isObj(pv)) for (const k of PHASES) { const g = pv[String(k)]; if (Array.isArray(g) && g.length === layers.length) phases[k] = g.map((x) => Math.min(1.5, Math.max(0, num(x) ?? 0))); }
  return { calm, tension: str(v['tension']), layers, phases, bpm, beatsPerBar: num(v['beatsPerBar']) ?? 4, loopStart, loopEnd, duration: num(v['duration']) ?? loopEnd };
}
/** the manifest, validated field by field — anything malformed is dropped (a slot without its files is a slot the synth keeps) */
export function parseManifest(raw: unknown): MusicManifest | undefined {
  if (!isObj(raw) || !isObj(raw['slots'])) return undefined;
  const slots: Partial<Record<SlotName, SlotSpec>> = {}, stings: Partial<Record<StemSting, string>> = {};
  for (const [k, value] of Object.entries(raw['slots'])) { const s = parseSlot(value); if (s && str(k) !== undefined) slots[k] = s; }
  const st = raw['stings'];
  if (isObj(st)) for (const k of STINGS) { const f = str(st[k]); if (f !== undefined) stings[k] = f; }
  return { genre: str(raw['style']) ?? '', credit: str(raw['credit']) ?? 'Music: MiniMax-Music3', slots, stings };
}
/** the folder a set of `genre` lives in: public/assets/music/<genre>/ or public/assets/music/<set>-<genre>/ */
export const musicSetDir = (genre: MusicStyle, set: MusicSet = 'base'): string => (set === 'base' ? genre : `${set}-${genre}`);
/** this build's manifest for `genre` (compiled in from public/assets/music/<dir>/music.json), or undefined */
export function musicManifest(genre: MusicStyle, set: MusicSet = 'base'): MusicManifest | undefined { return parseManifest(musicManifests()[musicSetDir(genre, set)]); }
/** the files `decodeStyle(genre, slots)` reads (URLs), so the loading bar can tell them from the files it only downloads;
 *  `withStings: false` lists the slots' stems alone */
export function styleFiles(genre: MusicStyle, slots: readonly SlotName[], withStings = true, withTension = true): string[] {
  const m = musicManifest(genre);
  if (!m) return [];
  const files: string[] = [];
  for (const k of slots) { const sp = m.slots[k]; if (sp) files.push(sp.calm, ...(!withTension || sp.tension === undefined ? [] : [sp.tension])); }
  if (withStings) for (const k of STINGS) { const f = m.stings[k]; if (f !== undefined) files.push(f); }
  return [...new Set(files.map((f) => `/assets/music/${genre}/${f}`))].filter(shipped);
}

// ---- a level's own score set ----

export interface ScoreSet { dir: string; manifestKey: string }
const SCORE_STINGS: readonly StemSting[] = ['pickup', 'death', 'chunk'];
/** the music manifest of a score set (its slots, stems and stings), or undefined when the build has none */
export function scoreManifest(set: ScoreSet): MusicManifest | undefined { return parseManifest(musicManifests()[set.manifestKey]); }
/** the files a score set plays: the given slots' stems (every slot by default) and its stings */
export function scoreFiles(set: ScoreSet, slots?: readonly string[], withStings = true): string[] {
  const m = scoreManifest(set);
  if (!m) return [];
  const stems = (slots ?? Object.keys(m.slots)).flatMap((key) => {
    const s = m.slots[key];
    return s ? [s.calm].concat(s.tension === undefined ? [] : [s.tension], s.layers) : [];
  });
  const files = [...stems, ...(withStings ? SCORE_STINGS.flatMap((key) => m.stings[key] ?? []) : [])];
  return [...new Set(files.map((file) => `${set.dir}${file}`))].filter(shipped);
}

// ---- sound-effect sets (sfx.json) ----

/** Sample selection belongs to the level, independently of its bed id. */
export interface SfxDecodePolicy {
  omitLoops?: readonly string[]; omitShots?: readonly string[]; loopGains?: Readonly<Record<string, number>>;
}
/** one file `decodeSfxSet(set, bed)` reads, in decode order: a loop (its sfx.json row) or a one-shot take of `family` */
export type SfxEntry = { url: string; bed?: true } & ({ loop: string; row: Record<string, unknown> } | { family: string; gain: number });
export function sfxEntries(set: string, bed: string, policy: SfxDecodePolicy = {}): SfxEntry[] {
  const j = sfxManifests()[set];
  if (!isObj(j)) return [];
  const dir = sfxDir(set), out: SfxEntry[] = [];
  const url = (f: unknown): string | undefined => (typeof f === 'string' && !f.includes('..') && `${dir}${f}` in publicBytes() ? `${dir}${f}` : undefined);
  const loop = (name: string, v: unknown): void => {
    if (policy.omitLoops?.includes(name) || !isObj(v)) return;
    const u = url(v['file']);
    if (u === undefined) return;
    out.push({ url: u, ...(name === bed ? { bed: true as const } : {}), loop: name, row: v });
  };
  const beds = isObj(j['beds']) ? j['beds'] : {}, hums = isObj(j['hums']) ? j['hums'] : {}, shots = isObj(j['oneshots']) ? j['oneshots'] : {};
  // The selected bed first, then the common loops, in the existing decode order.
  loop(bed, beds[bed]); loop('underwater', beds['underwater']); loop('pickup', hums['pickup']); loop('shrine', hums['shrine']);
  for (const [family, v] of Object.entries(shots)) {
    if (policy.omitShots?.includes(family)) continue;
    const files = Array.isArray(v) ? v : isObj(v) && Array.isArray(v['files']) ? v['files'] : [];
    const gain = isObj(v) ? (typeof v['gain'] === 'number' && Number.isFinite(v['gain']) ? v['gain'] : 1) : 1;
    for (const f of files) { const u = url(f); if (u !== undefined) out.push({ url: u, family, gain }); }
  }
  return out;
}
/** the files `decodeSfxSet(set, bed)` reads (URLs), so the loading bar can tell them from the files it only downloads */
export function sfxFiles(set: string, bed: string, policy: SfxDecodePolicy = {}): string[] { return [...new Set(sfxEntries(set, bed, policy).map((j) => j.url))]; }
/** the selected bed's file of `set` (empty when the set has none): the one sample the first seconds of play loop */
export function sfxBedFiles(set: string, bed: string, policy: SfxDecodePolicy = {}): string[] { return sfxEntries(set, bed, policy).filter((j) => j.bed).map((j) => j.url); }

// ---- a level's own cue catalogue (sfx.json with a sprite, beds and hums) ----

const cueFileIn = (dir: string, v: unknown): string | undefined => typeof v === 'string' && !v.includes('..') && !v.includes('/') && shipped(`${dir}${v}`) ? `${dir}${v}` : undefined;
/** The installed recording catalogue, shared by eager banks and lazy family players. */
export function cueManifest(key: string): Record<string, unknown> | undefined { const raw = sfxManifests()[key]; return isObj(raw) ? raw : undefined; }
/** Resolve a confined shipped filename, or an explicit recording in another
 * shipped catalogue. References are one hop; paths and nested aliases refuse. */
export function cueFile(key: string, value: unknown): string | undefined {
  if (typeof value === 'string') return cueFileIn(`/assets/sfx/${key}/`, value);
  if (!isObj(value) || Object.keys(value).length !== 2 || typeof value['set'] !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value['set']) || cueManifest(value['set']) === undefined) return undefined;
  const target = cueManifest(value['set']);
  const known = ['beds', 'hums'].some(section => {
    const rows = target?.[section]; return isObj(rows) && Object.values(rows).some(row => isObj(row) && typeof row['file'] === 'string' && row['file'] === value['file']);
  });
  return known ? cueFileIn(`/assets/sfx/${value['set']}/`, value['file']) : undefined;
}
/** Original family order for array and object-form manifests. */
export function cueFamilyNames(manifest: Record<string, unknown> | undefined, family: string): string[] {
  const rows = manifest?.['oneshots'], value = isObj(rows) ? rows[family] : undefined;
  const list: unknown[] = Array.isArray(value) ? value : isObj(value) && Array.isArray(value['files']) ? value['files'] : [];
  return list.filter((name): name is string => typeof name === 'string');
}
/** One shipped sprite and its original take offsets; no PCM is copied. */
export interface CueSprite { url: string; clips: ReadonlyMap<string, Readonly<{ offset: number; duration: number }>> }
/** Admit a sprite's shipped file and positive slice bounds without decoding it. */
export function cueSprite(key: string, manifest: Record<string, unknown> | undefined): CueSprite | undefined {
  const sprite = manifest?.['sprite'], url = isObj(sprite) ? cueFile(key, sprite['file']) : undefined, raw = isObj(sprite) ? sprite['clips'] : undefined;
  if (url === undefined || !isObj(raw)) return undefined;
  const clips = new Map<string, { offset: number; duration: number }>();
  for (const [name, value] of Object.entries(raw)) {
    const pair: unknown[] = Array.isArray(value) ? value : [], offset = pair[0], duration = pair[1];
    if (typeof offset === 'number' && typeof duration === 'number' && offset >= 0 && duration > 0) clips.set(name, { offset, duration });
  }
  return { url, clips };
}
/** An own set uses one sprite for shots, plus its beds and positional loops. */
export function cueFiles(key: string): string[] {
  const raw = sfxManifests()[key];
  if (!isObj(raw)) return [];
  const files: string[] = [];
  for (const section of ['beds', 'hums']) {
    const entries = raw[section];
    if (isObj(entries)) for (const value of Object.values(entries)) if (isObj(value)) {
      const url = cueFile(key, value['file']); if (url) files.push(url);
    }
  }
  const sprite = raw['sprite'];
  if (isObj(sprite)) { const url = cueFile(key, sprite['file']); if (url) files.push(url); }
  else if (isObj(raw['oneshots'])) for (const value of Object.values(raw['oneshots'])) {
    const takes = Array.isArray(value) ? value : isObj(value) && Array.isArray(value['files']) ? value['files'] : [];
    for (const take of takes) { const url = cueFile(key, take); if (url) files.push(url); }
  }
  return [...new Set(files)];
}
/** a cue catalogue's one-shot files: its sprite, or every family's takes (CueCatalogue.shotFiles) */
export function cueShotFiles(key: string): string[] {
  const manifest = cueManifest(key), sprite = cueSprite(key, manifest);
  if (sprite !== undefined) return [sprite.url];
  const rows = manifest?.['oneshots'];
  return isObj(rows) ? [...new Set(Object.keys(rows).flatMap(id => cueFamilyNames(manifest, id).map(name => cueFile(key, name)).filter((url): url is string => url !== undefined)))] : [];
}

// ---- a level's selection: what its profile lists, boots, holds for the title and needs at control ----

export interface AudioSelection {
  files: () => { music: string[]; sfx: string[] };
  priorityFiles?: () => readonly string[];
  bootFiles: (style: MusicStyle) => readonly string[];
  titleFiles: (style: MusicStyle) => readonly string[];
  controlFiles: (style: MusicStyle) => readonly string[];
}
/** The selection of a level's admitted audio rows under the player's music style and sound-effect set (`style` and
 *  `set`, read on each call, as Settings is; `bootFiles` takes its style as an argument). `extraFiles` is a trusted sprite catalogue's own one-shot list; a declared bank catalogue supplies its
 *  own. Throws when the rows declare no catalogue (createCatalogueAudio's refusal). */
export function audioSelection(data: AudioData, style: () => MusicStyle, set: () => SfxSet, extraFiles?: () => readonly string[]): AudioSelection {
  const music = data.music, samples = data.samples;
  if (music?.setCatalogue !== undefined) {
    const policy = music.setCatalogue, source = music.source;
    if (samples === undefined || source === undefined || source === null) throw new Error('Missing score set catalogue');
    return scoreSetSelection(music.bootSlots, policy, source, samples, style, set);
  }
  const bankPolicy = data.bank?.catalogue, extras = extraFiles ?? (bankPolicy === undefined ? undefined : () => cueShotFiles(bankPolicy.set));
  const policy = samples?.catalogue;
  if (samples === undefined || music === undefined || policy === undefined) throw new Error('Missing declared audio catalogue');
  const levels = { loopGains: samples.loopGains };
  const ownMusic = (): string[] => {
    const genre = style(), key = `${samples.set}-${genre}`;
    return policy.ownMusic && genre !== 'synth' && Object.hasOwn(musicManifests(), key) ? [key] : [];
  };
  const ownSfx = (): string[] => Object.hasOwn(sfxManifests(), samples.set) ? [samples.set] : [];
  const selectedSfx = (): string[] => [...sfxFiles(set(), samples.bed, levels),
    ...(policy.overlaySamples && set() !== 'synth' ? sfxFiles(samples.set, samples.bed, levels) : []),
    ...(set() === 'synth' ? [] : extras?.() ?? [])];
  return {
    files: () => audioFilesFor(style(), set(), { omitSlots: policy.inventoryOmitSlots, musicSets: ownMusic(), sfxSets: ownSfx() }),
    ...(policy.priorityOwn ? { priorityFiles: () => {
      const files = audioFilesFor(style(), set(), { musicSets: ownMusic(), sfxSets: ownSfx() }), dirs = [...ownMusic().map(musicDir), ...ownSfx().map(sfxDir)];
      return [...files.music, ...files.sfx].filter(url => dirs.some(dir => url.startsWith(dir)));
    } } : {}),
    bootFiles: genre => [...styleFiles(genre, music.bootSlots), ...selectedSfx()],
    titleFiles: genre => {
      const played = new Set(styleFiles(genre, music.bootSlots.filter(slot => slot !== 'title'), false));
      return styleFiles(genre, ['title'], false).filter(url => !played.has(url));
    },
    controlFiles: genre => [...styleFiles(genre, music.bootSlots, false, music.controlTension !== 'late'), ...sfxBedFiles(set(), samples.bed, levels),
      ...(policy.overlaySamples && set() !== 'synth' ? sfxBedFiles(samples.set, samples.bed, levels) : [])],
  };
}
type ScorePolicy = NonNullable<NonNullable<AudioData['music']>['setCatalogue']>;
function scoreSetSelection(bootSlots: readonly string[], policy: ScorePolicy, set: ScoreSet, samples: NonNullable<AudioData['samples']>, style: () => MusicStyle, sfxSet: () => SfxSet): AudioSelection {
  const slots = bootSlots.filter(slot => slot !== 'title');
  const titleFiles = (genre: MusicStyle): string[] => {
    if (policy.inventory === 'base') return styleFiles(genre, ['title']);
    const title = musicManifest(genre)?.slots['title']; return title ? [`/assets/music/${genre}/${title.calm}`].filter(shipped) : [];
  };
  const scoreSlots = (genre: MusicStyle): readonly string[] => genre === 'synth' && !policy.bootSynth ? [] : slots;
  const bootScore = (genre: MusicStyle): string[] => genre === 'synth' && !policy.bootSynth ? [] : scoreFiles(set, slots);
  const useCues = (): boolean => !policy.cueOverlay || sfxSet() !== 'synth';
  return {
    files: () => { const base = policy.inventory === 'base' ? audioFilesFor(style(), sfxSet()) : { music: MUSIC_STYLES.flatMap(titleFiles), sfx: [] }; return { music: [...base.music, ...scoreFiles(set)], sfx: [...base.sfx, ...cueFiles(samples.set)] }; },
    ...(policy.priority ? { priorityFiles: () => [...scoreFiles(set), ...cueFiles(samples.set)] } : {}),
    bootFiles: genre => [...titleFiles(genre), ...(policy.baseSamples ? sfxFiles(sfxSet(), samples.bed) : []),
      ...(policy.cueOverlay ? (useCues() ? cueFiles(samples.set) : []) : bootScore(genre)),
      ...(policy.cueOverlay ? bootScore(genre) : cueFiles(samples.set))],
    titleFiles,
    controlFiles: genre => [...(policy.inventory === 'base' ? styleFiles(genre, ['title'], false) : titleFiles(genre)),
      ...scoreFiles(set, scoreSlots(genre), false), ...(policy.baseSamples ? sfxBedFiles(sfxSet(), samples.bed) : [])],
  };
}

/** The boot's audio: the profile's selected files, in its inventory's order (extras `bootFiles`, with no title held). */
export function selectedBootAudio(inventory: { music: readonly string[]; sfx: readonly string[] }, selected: ReadonlySet<string>): { music: string[]; sfx: string[] } {
  return { music: inventory.music.filter(url => selected.has(url)), sfx: inventory.sfx.filter(url => selected.has(url)) };
}
/** AU1: what DOWNLOAD holds for a level's audio rows: a new player's boot set (the default style and set), every file
 *  LOAD reads before control. The cook lists these in the shard's spawn manifests. */
export function defaultBootAudio(data: AudioData): string[] {
  const selection = audioSelection(data, () => DEFAULT_MUSIC_STYLE, () => DEFAULT_SFX_SET), files = selectedBootAudio(selection.files(), new Set(selection.bootFiles(DEFAULT_MUSIC_STYLE)));
  return [...files.music, ...files.sfx];
}
