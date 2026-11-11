export type Channel = 'staging' | 'production';
export type Phase = 'build' | 'upload' | 'check' | 'go-live';
export interface ChannelConfig { channel: Channel; other: Channel; origin: string; release: string; socket: string; health: string }
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
export interface Deps {
  root: string;
  channel: Channel;
  build: string;
  host: PageHost;
  packs: PackStore;
  run: (file: string, args: string[], env: Record<string, string>) => void;
  fetchJSON: (url: string) => Promise<unknown>;
  fetchText: (url: string) => Promise<string>;
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
  afterStagingProofs?: boolean;
  releaseKey?: string;
}
export const PACKS_ORIGIN: string;
export const RELEASE_PUBLIC_KEY: string;
export const PHASES: readonly Phase[];
export const CHECKED_DOCUMENTS: readonly ['version.json', 'index.html'];
export const CHANNELS: Record<Channel, ChannelConfig>;
export class RefusedError extends Error { constructor(message: string) }
export function runPhase(phase: Phase, deps: Deps): Promise<{ refusals: string[] }>;
export function buildEnv(channel: ChannelConfig, deps: Deps): Record<string, string>;
export function readGate(channel: ChannelConfig, deps: Deps): Promise<{ serial?: number; problem?: string }>;
