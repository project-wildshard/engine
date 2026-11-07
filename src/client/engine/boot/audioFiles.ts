/** Audio inventories come from the generated manifests, with the selected styles/sets first.
 * Level profiles add their own sets and declare any file/slot exclusions.
 */
import { musicManifests, publicBytes, sfxManifests } from '../../../shared/engine/boot/tables';
import { MUSIC_STYLES, SFX_SETS, getMusicStyle, getSfxSet } from '../ui/Settings';

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
function ordered<T extends string>(all: readonly T[], selected: T, manifests: Readonly<Record<string, unknown>>): T[] {
  const have = all.filter((v) => Object.hasOwn(manifests, v));
  return [...have.filter((v) => v === selected), ...have.filter((v) => v !== selected)];
}
export const musicStyles = (): string[] => ordered(MUSIC_STYLES, getMusicStyle(), musicManifests());
export const sfxSets = (): string[] => ordered(SFX_SETS, getSfxSet(), sfxManifests());

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
export function audioFiles(policy: AudioFilePolicy = {}): { music: string[]; sfx: string[] } {
  return {
    music: [...musicStyles().flatMap((style) => filesOf(musicDir(style), withoutSlots(musicManifests()[style], policy.omitSlots ?? []))), ...(policy.musicSets ?? []).flatMap((set) => filesOf(musicDir(set), musicManifests()[set]))],
    sfx: [...sfxSets().flatMap((set) => filesOf(sfxDir(set), sfxManifests()[set]).filter((url) => !(policy.omitSfx?.[set] ?? []).includes(url.slice(sfxDir(set).length)))), ...(policy.sfxSets ?? []).flatMap((set) => filesOf(sfxDir(set), sfxManifests()[set]))],
  };
}
