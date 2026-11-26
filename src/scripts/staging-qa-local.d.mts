/** SQ5: build the source and exercise a real signed world on loopback. */
/** Build-max C4: the shards the local rig hosts when no tour picks them. */
export const QA_RIG_HOME: string;
export const QA_RIG_MORE: readonly string[];
export const QA_RIG_SHARDS: readonly string[];
export function checkLocalSource(root: string, build: string): void;
/** The tour's catalogue, the placed extras and the shards the rig hosts besides Driftwood; every featured zone with no seed. */
export function tourFixture(checkout: string, seed?: number): Promise<{ catalogue: unknown; extras: { instance: string; slug?: string; cell: [number, number] }[]; more: string[] }>;
export function openQaRig(options: { root: string; build: string; out: string; tourSeed?: number }):
  Promise<{ base: string; socket: string; source: string; close: () => Promise<void> }>;
