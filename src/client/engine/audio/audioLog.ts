/**
 * The audio trigger log (PINE-HOLLOW-REMASTER A-rows, the audio-wiring lane): every music scene / phase / sting / deck, every
 * Pine Hollow one-shot and bark, every ambience bed coming up or going down, pushed as one small record — a headless check
 * reads `window.__audioLog` to prove a trigger fired (and whether its sound was decoded: `ok`). A ring of the last 400;
 * nothing else reads it and it never touches the audio graph.
 *
 *   audioLog('sfx', 'leverShot', true)            // kind, name, ok (false = not decoded / not shipped), detail
 */
export interface AudioLogEntry { t: number; kind: 'music' | 'sfx' | 'bark' | 'bed' | 'zone' | 'wire' | 'cue'; name: string; ok?: boolean; detail?: string }
/** EG-15: every trigger since boot, by `kind name`: how many sounded (`ok` not false) and how many found no sound. The ring forgets; this doesn't. */
export type AudioTally = Record<string, { played: number; silent: number }>;

const MAX = 400;
const log: AudioLogEntry[] = [];
const tally: AudioTally = {};
if (typeof window !== 'undefined') Object.assign(window as unknown as { __audioLog: AudioLogEntry[]; __audioTally: AudioTally }, { __audioLog: log, __audioTally: tally });

/** record one audio trigger (music, sfx, bark, bed …) in the `window.__audioLog` ring a headless check reads */
export function audioLog(kind: AudioLogEntry['kind'], name: string, ok?: boolean, detail?: string): void {
  const e: AudioLogEntry = { t: Math.round(typeof performance === 'undefined' ? 0 : performance.now()), kind, name };
  if (ok !== undefined) e.ok = ok;
  if (detail !== undefined) e.detail = detail;
  log.push(e);
  if (log.length > MAX) log.shift();
  const row = tally[`${kind} ${name}`] ??= { played: 0, silent: 0 };
  if (ok === false) row.silent++; else row.played++;
}
