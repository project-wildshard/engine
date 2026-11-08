import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
// src/client/engine/audio/credits.ts — the model credits the licences ask the UI to show (project/archive/2026-09-23-music.md v3): MiniMax-Music3 for the
// score, and the sound-effect set's own `credit` string (public/assets/sfx/best/sfx.json). The one generated set is the better
// take per sound of MOSS-SoundEffect v2 (Apache-2.0) and Stable Audio 3 Medium (Stability AI Community licence, which asks
// for "Powered by Stability AI"), so its credit names both (AGENTS.md "Audio engines"). The sfx.json credit arrives with
// the boot preload (the loading bar reads the manifest); until then the line is built from the set's name.
//
//   sfxCredit(getSfxSet())   → 'Sound effects: MOSS-SoundEffect v2 · Stable Audio 3 Medium — Powered by Stability AI' ('' for synth, or a set not shipped)
//   onSfxCredit(fn)          → a set's sfx.json credit arrived (Audio.ts calls setSfxCredit)
import type { SfxSet } from '../ui/Settings';
import { shipped } from './Stems';
import { onOwnerDispose } from '../../../shared/engine/app/ownership';

export const MUSIC_CREDIT: string = engineString('s_7fc7e56bbd7f');
/** J201: the model provider notice is visible beside the existing credits. */
export const MODEL_CREDIT: string = engineString('s_model_provider_notice');
const STABILITY = engineString('s_ef691a454428');
const NAMES: Record<Exclude<SfxSet, 'synth'>, string> = {
  best: engineString('s_9c6373f9a730'),
};
/** the sets whose licence asks for the Stability line (the merged set carries Stable Audio 3 Medium sounds) */
const STABILITY_SETS: ReadonlySet<SfxSet> = new Set<SfxSet>(['best']);
const loaded = new Map<SfxSet, string>();
const listeners = new Set<() => void>();
const scopedCredits = new Map<object, string>();

/** Retain an owned bank's attribution independently of the shared sound-set
 * preference. Retiring its scene restores the remaining or shared credits. */
export function installSfxCredit(credit: string, scope: Scope): void {
  const text = credit.trim();
  if (text === '' || scope.disposed || scope.disposing) throw new Error('Active SFX credit requires a live scope and text');
  const token = {};
  scopedCredits.set(token, text); listeners.forEach(fn => fn());
  scope.onDispose(() => { scopedCredits.delete(token); listeners.forEach(fn => fn()); });
}

export function sfxCredit(set: SfxSet): string {
  if (scopedCredits.size > 0) return [...new Set(scopedCredits.values())].join(' · ');
  if (set === 'synth' || !shipped(`/assets/sfx/${set}/sfx.json`)) return ''; // a set this build does not ship plays no model's sounds
  const c = loaded.get(set) ?? NAMES[set];
  return !STABILITY_SETS.has(set) || c.includes('Stability AI') ? c : engineString('s_276bbc529952', [c, STABILITY]);
}
export function setSfxCredit(set: SfxSet, credit: string): void {
  if (credit.trim() === '' || loaded.get(set) === credit) return;
  loaded.set(set, credit.trim());
  listeners.forEach((fn) => fn());
}
export function onSfxCredit(fn: () => void): () => void { listeners.add(fn); const off = (): void => { listeners.delete(fn); }; onOwnerDispose(off); return off; }
