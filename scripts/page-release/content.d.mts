export type Kind = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'E1';
export interface ContentFile { path: string; kind: Kind; bytes: number; sha256: string; decoded: string }
export interface Headers { type: string; encoding?: string; cache: string }
export interface Put { key: string; file: string; headers: Headers }
export interface Read { status: number; cors: string | null; bytes: Uint8Array }
export interface ContentStore {
  exists: (key: string) => Promise<boolean>;
  put: (puts: readonly Put[]) => Promise<void>;
  read: (key: string, origin: string) => Promise<Read>;
}
export interface ContentSummary {
  set: string; base: string; files: number; bytes: number; uploaded: number; uploadedBytes: number; held: number;
  kinds: Record<string, { files: number; bytes: number }>; cors: string;
}
export const BUCKET: string;
export const CLOUDFLARE_ACCOUNT: string;
export const CONTENT_ROOT: string;
export const GAME_ORIGIN: string;
export const KIND_NAMES: readonly Kind[];
export function contentHeaders(key: string): Headers;
export const UNREAD_PACK: RegExp;
export function contentKind(path: string, shards: ReadonlySet<string>): Kind | undefined;
export function contentKey(set: string, path: string): string;
export function contentBaseOf(set: string): string;
export function scanContent(dir: string): ContentFile[];
export function contentSet(files: readonly ContentFile[]): string;
export function contentIndex(set: string, files: readonly ContentFile[]): Buffer;
export function readBack(store: ContentStore, key: string, expected: string, origin: string, sleep: (ms: number) => Promise<void>): Promise<number>;
export function publishContent(options: { dir: string; store: ContentStore; scratch: string; origin?: string; dryRun?: boolean; log: (line: string) => void; sleep?: (ms: number) => Promise<void> }): Promise<ContentSummary>;
export function sampleContent(options: { dir: string; store: ContentStore; count: number; origins: readonly string[]; log: (line: string) => void; sleep?: (ms: number) => Promise<void> }): Promise<{ set: string; checked: Record<string, number> }>;
export function r2Content(options: { root: string; scratch: string; token?: string; fetch?: typeof fetch; exec?: (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout?: number }, secrets: string[]) => string }): ContentStore;
