export interface NpmFinalDeps {
  latest: () => Promise<string | undefined>;
  existingRun: (tag: string) => Promise<number | undefined>;
  dispatch: (tag: string) => Promise<number>;
  watch: (run: number) => Promise<string>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  waitMs?: number;
  pollMs?: number;
}
export function npmFinal(tag: string, deps: NpmFinalDeps): Promise<{version: string, run?: number, already: boolean}>;
