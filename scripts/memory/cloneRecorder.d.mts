/** A message cloning this many buffer bytes or more fails the check (EM25). */
export const CLONE_LIMIT_BYTES: number;
/** Browser-side: install the recorder (`globalThis.__cloneLog`, `globalThis.__cloneSeen`). */
export function recordClones(): void;
