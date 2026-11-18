export const DEV_PORT: number
export const DEV_RELEASE: string
export const DEV_STATE: string
export const DEV_SERVICE_WORKER: string
export function buildOf(folder: string): string
export function devKey(work: string): { readonly public: string; readonly private: string }
export function stampDevDocument(
  html: string,
  stamp: { readonly release: string; readonly key: string },
  revision: number,
): string
export interface DevWorld {
  readonly url: string
  readonly port: number
  readonly stamp: { readonly release: string; readonly key: string }
  readonly socket: string
  readonly database: string
  readonly build: string
  readonly revision: number
  readonly restart: () => Promise<void>
  readonly move: (built: string) => Promise<void>
  readonly close: () => Promise<void>
}
export function openDevWorld(options: {
  readonly dist: string
  readonly work: string
  readonly shard?: string
  readonly product?: string
  readonly port?: number
  readonly saves?: 'disk' | 'memory'
  readonly gridRoot?: string
  readonly log?: (line: string) => void
}): Promise<DevWorld>
