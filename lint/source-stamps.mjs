// A verdict may be reused only while every observed source/resolution probe is
// unchanged. Missing candidates count too, so a newly authored module invalidates it.
import { statSync } from 'node:fs';

export function sourceStamp(file) {
  const info = statSync(file, { throwIfNoEntry: false });
  return info === undefined ? null : `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}
export function currentSources(stamps) {
  for (const [file, stamp] of stamps) if (sourceStamp(file) !== stamp) return false;
  return true;
}
