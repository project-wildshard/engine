export type WorldChannel = 'staging' | 'production';
export type Channel = WorldChannel | 'preview' | 'explore';
export type Phase = 'build' | 'upload' | 'check' | 'go-live';
export interface WorldChannelConfig { channel: WorldChannel; solo: false; other: WorldChannel; origin: string; release: string; socket: string; health: string }
export interface SoloChannelConfig { channel: 'preview' | 'explore'; solo: true; origin: string; release: string }
export type ChannelConfig = WorldChannelConfig | SoloChannelConfig;
export interface Deployment { id: string; url: string }
export interface HostContext { root: string; channel: ChannelConfig; build: string; saveEpoch: number; version: string; deployment?: Deployment }
export type HostStep = 'prepare' | 'package' | 'upload' | 'deployedDigests' | 'goLive';
export interface Digest { algorithm: 'sha1' | 'sha256'; digest: string }
export interface PageHost {
  name: string;
  buildEnv: (context: HostContext) => Record<string, string>;
  outputDir: (context: HostContext) => string;
  prepare: (context: HostContext) => Promise<void>;
  package: (context: HostContext) => Promise<void>;
  upload: (context: HostContext) => Promise<Deployment>;
  deployedDigests: (context: HostContext & { deployment: Deployment }, names: readonly string[]) => Promise<Map<string, Digest>>;
  goLive: (context: HostContext & { deployment: Deployment }) => Promise<void>;
  describe: (step: HostStep, context: HostContext) => string[];
}
export interface PacksSummary { parts: number; uploaded: number; held: number; book: string; cors: string }
export interface PackStore {
  publish: (context: { root: string; build: string; cors: string; dryRun: boolean }) => Promise<PacksSummary>;
  verify: (context: { root: string; build: string; cors: string }) => Promise<PacksSummary>;
}
export interface ContentSummary { set: string; base: string; files: number; bytes: number; uploaded: number; uploadedBytes: number; held: number; cors: string }
export interface ContentPublisher { publish: (context: { dir: string; cors: string; dryRun: boolean }) => Promise<ContentSummary> }
export interface Deps {
  root: string;
  channel: Channel;
  build: string;
  host: PageHost;
  codeRetention?: boolean;
    packs: PackStore;
  content?: ContentPublisher;
  run: (file: string, args: string[], env: Record<string, string>) => void;
  fetchJSON: (url: string) => Promise<unknown>;
  fetchText: (url: string) => Promise<string>;
  /** FR-A15: the HTTP status of a public rooms URL. */
  roomsStatus?: (url: string) => Promise<number>;
  /** ALLOW_ROOMS_DOWN=1 (J381). */
  allowRoomsDown?: boolean;
  /** FR-A17: production's advertised heads with no exact-build pack index. */
  productionPacks?: (build: string) => Promise<string[]>;
  /** ALLOW_MISSING_PACKS=1 (J381). */
  allowMissingPacks?: boolean;
  /** QA 11-25 row 131: production's page against its content set, before and after the alias move. */
  contentReach?: (when: 'before' | 'after', stagingBase: string | undefined) => Promise<{ summary: string; problems: string[] }>;
  /** ALLOW_CONTENT_GAPS=1 (J381). */
  allowContentGaps?: boolean;
  readFile: (path: string) => Uint8Array;
  state: { read: (phase: Phase) => unknown; write: (phase: Phase, value: object) => void };
  git: { clean: () => boolean; head: () => string; remoteTag: (tag: string) => string | undefined };
  manifest: { version: string; saveEpoch: number };
  log: (line: string) => void;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  dryRun?: boolean;
  waitMs?: number;
  pollMs?: number;
  qa?: QaVerdict;
  localQa?: QaVerdict;
  localQaSource?: string;
  releaseKey?: string;
  catalogue?: string;
  zoneTable?: string;
}
export const SMOKE_SCENARIOS: readonly string[];
/** STAGING-QA SQ15: one staging-qa.mjs verdict, the candidate's or live staging's. */
export interface ZoneEntryProof { build?: string; engine?: string; profile?: string; mode?: string; pass?: boolean; expected?: number; arrivals?: readonly {from: string; to: string}[]; failure?: {from: string; to: string; reason: string} }
export interface QaVerdict { qa?: boolean; kind?: string; full?: boolean; build?: string; release?: string; url?: string; deploymentId?: string; roomsSerial?: number; proofs?: readonly { id?: string; pass?: boolean }[]; scenarios?: readonly { id?: string; status?: string }[]; hold?: boolean; findings?: readonly { scenario?: string; severity?: string; text?: string }[]; problem?: string; deploy?: {zoneEntry?: ZoneEntryProof}; contentBase?: string }
export const QA_LEGS: Readonly<{ candidate: readonly string[]; staging: readonly string[] }>;
export function qaGap(qa: QaVerdict | undefined, build: string): string | undefined;
export function zoneEntryGap(proof: ZoneEntryProof | undefined, build: string): string | undefined;
export function localQaGap(qa: QaVerdict | undefined, source: string | undefined, release: string): string | undefined;
export const PACKS_ORIGIN: string;
export const API_ORIGIN: string;
export const RELEASE_PUBLIC_KEY: string;
export function pinnedReleaseKey(configured?: string): string;
export const PHASES: readonly Phase[];
/** FR-A15: both channels' public rooms /up URLs. */
export const PUBLIC_ROOMS: readonly string[];
export function roomsDown(deps: Deps): Promise<string[]>;
export const CHECKED_DOCUMENTS: readonly ['version.json', 'index.html', 'sw.js', 'deploy-chunks.json'];
export const CHANNELS: { staging: WorldChannelConfig; production: WorldChannelConfig; preview: SoloChannelConfig; explore: SoloChannelConfig };
export class RefusedError extends Error { constructor(message: string) }
export function runPhase(phase: Phase, deps: Deps): Promise<{ refusals: string[] }>;
export function buildEnv(channel: ChannelConfig, deps: Deps): Record<string, string>;
export function readGate(channel: ChannelConfig, deps: Deps): Promise<{ serial?: number; problem?: string }>;
