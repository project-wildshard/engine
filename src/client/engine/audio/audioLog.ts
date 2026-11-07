/**
 * The audio trigger log (PINE-HOLLOW-REMASTER A-rows, the audio-wiring lane): every music scene / phase / sting / deck, every
 * Pine Hollow one-shot and bark, every ambience bed coming up or going down, pushed as one small record — a headless check
 * reads `window.__audioLog` to prove a trigger fired (and whether its sound was decoded: `ok`). A ring of the last 400;
 * nothing else reads it and it never touches the audio graph.
 *
 *   audioLog('sfx', 'leverShot', true)            // kind, name, ok (false = not decoded / not shipped), detail
 */
export interface AudioLogEntry { t: number; kind: 'music' | 'sfx' | 'bark' | 'bed' | 'zone' | 'wire'; name: string; ok?: boolean; detail?: string }

const MAX = 400;
const log: AudioLogEntry[] = [];
if (typeof window !== 'undefined') (window as unknown as { __audioLog: AudioLogEntry[] }).__audioLog = log;

/** record one audio trigger (music, sfx, bark, bed …) in the `window.__audioLog` ring a headless check reads */
export function audioLog(kind: AudioLogEntry['kind'], name: string, ok?: boolean, detail?: string): void {
  const e: AudioLogEntry = { t: Math.round(typeof performance === 'undefined' ? 0 : performance.now()), kind, name };
  if (ok !== undefined) e.ok = ok;
  if (detail !== undefined) e.detail = detail;
  log.push(e);
  if (log.length > MAX) log.shift();
}
