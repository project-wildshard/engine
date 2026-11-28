import type { S3Client } from '@aws-sdk/client-s3';

/** Fix preview PV15: a deletable unit, a content set or a C8 leftover at the packs bucket root. */
export interface Unit { key: string; kind: 'set' | 'leftover' }
export interface ChannelReaders { channel: string; base: string | undefined; carried: string[] }
export interface PruneState { format: 1; unread: Record<string, string> }
export interface Verdict { unit: Unit; readBy: string[] }
export interface Size { objects: number; bytes: number }
export interface PacksBucket {
  children: (prefix: string) => Promise<{ prefixes: string[]; keys: string[] }>;
  size: (prefix: string) => Promise<Size>;
  keys: (prefix: string) => Promise<string[]>;
  text: (key: string) => Promise<string | undefined>;
  write: (key: string, body: string) => Promise<void>;
  remove: (prefix: string) => Promise<Size>;
}
export interface PruneResult {
  channels: ChannelReaders[]; units: Verdict[]; unknown: string[]; indexes: number;
  deletes: Unit[]; waiting: { unit: Unit; since: string }[]; deleted: ({ key: string } & Size)[];
  sizes: Record<string, Size>; dryRun: boolean;
}
export const UNREAD_MS: number;
export const STATE_KEY: string;
export const LEFTOVER_ROOTS: readonly ['shardfiles/', 'programs/'];
export const OWNED_ROOTS: readonly ['assets/', 'index/', 'loose/'];
export function carriedContentBuilds(graph: unknown): string[];
export function channelReaders(channel: string, html: string, graph: unknown): ChannelReaders;
export function liveReaders(options?: { channels?: Record<string, { channel: string; origin: string }>; get?: typeof fetch }): Promise<ChannelReaders[]>;
export function unitsOf(listing: { sets: readonly string[]; shardfiles: readonly string[]; programs: boolean }): Unit[];
export function readersOf(units: readonly Unit[], readers: readonly ChannelReaders[], named: ReadonlySet<string>): Verdict[];
export function parseState(value: unknown): PruneState;
export function selectDeletes(verdicts: readonly { unit: Unit; readBy: readonly string[] }[], state: PruneState, now: number):
  { deletes: Unit[]; waiting: { unit: Unit; since: string }[]; state: PruneState };
export function packsBucket(client: S3Client): PacksBucket;
export function indexNamedKeys(bucket: Pick<PacksBucket, 'keys' | 'text'>): Promise<{ indexes: number; named: Set<string> }>;
/** Dry by default: lists and reads, writes nothing. `remove` deletes units unread for UNREAD_MS and writes the state. */
export function prune(options: { bucket: PacksBucket; readers: () => Promise<ChannelReaders[]>; now?: number; remove?: boolean; sizes?: boolean;
  log?: (line: string) => void }): Promise<PruneResult>;
export function report(result: PruneResult): string[];
export function packsClient(env: NodeJS.ProcessEnv): S3Client;
