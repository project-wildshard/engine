export const RELEASE_PUBLIC_KEY: string;
export const UNIT: string;
export const DOOR: string;
export const PORT: number;
export const INNER: number;
export const CPUS: string;
export const PG_VERSION: string;
export const CLUSTER: string;
export const PG_PORT: number;
export const PG_ROLE: string;
export const PG_DATABASE: string;
export const SCRATCH_HBA: string;

export interface ReplicaLimits {
  seconds: number;
  workers: number;
  seats: number;
  cells: string;
  saves?: 'memory' | 'postgres';
}

export interface StagingRelease {
  engineBuild: string;
  serial: number;
  saveEpoch: number;
  shards: unknown[];
  bundle: { name: string; sha256: string };
}

export function limits(args: string[]): ReplicaLimits | null;
export function stagingRelease(text: string, key: string): StagingRelease | null;
export function replicaRelease(release: Pick<StagingRelease, 'engineBuild' | 'saveEpoch' | 'shards'>): { text: string; publicKey: string };
export function doorArgs(run: { seconds: number; host: string }): string[];
export function scratchUrl(password: string): string;
export function unitArgs(run: ReplicaLimits & { host: string; publicKey: string; folder: string; database?: string }): string[];
