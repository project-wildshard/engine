export const DEV_PORT: number
export const DEV_RELEASE: string
export const DEV_STATE: string
export const DEV_SERVICE_WORKER: string
export function buildOf(folder: string): string
export function devKey(work: string): { readonly public: string; readonly private: string }
export function devServerBuildArgs(options: {
  readonly id: string
  readonly out: string
  readonly built: string
  readonly dev: boolean
}): string[]
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
  /** Resolves to the time (`Date.now()`) the old world was told to stop. */
  readonly restart: () => Promise<number>
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
  /** the page and the world socket as another device reaches them through an HTTPS proxy (serve-local.mjs) */
  readonly publicOrigin?: string
  readonly publicSocket?: string
  readonly staging?: readonly { readonly slug: string; readonly uploadNumber: number }[]
  /** a fixed loopback port for the world socket (0: the OS's) */
  readonly socketPort?: number
  readonly log?: (line: string) => void
}): Promise<DevWorld>
