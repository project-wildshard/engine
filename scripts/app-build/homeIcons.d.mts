export type HomeIconChannel = 'production' | 'staging' | 'preview';
export interface HomeIconFile {
  readonly name: string; readonly size: number; readonly master: 'any' | 'maskable';
  readonly purpose?: 'any' | 'maskable'; readonly link?: 'apple-touch-icon' | 'icon';
}
export interface HomeIconManifestRow { readonly src: string; readonly sizes: string; readonly type: 'image/png'; readonly purpose: 'any' | 'maskable' }
/** J236: production plain, staging an amber S, preview a violet P. */
export const HOME_ICON_CHANNELS: readonly HomeIconChannel[];
/** The channel the committed index.html and manifest name: the standalone (solo) build. */
export const DEFAULT_HOME_ICON_CHANNEL: 'preview';
/** Each channel's files under public/icons/<channel>/. */
export const HOME_ICON_FILES: readonly HomeIconFile[];
/** `/icons/<channel>/`. */
export function homeIconDirectory(channel: string): string;
/** A production world is production, any other world staging, no world preview. */
export function homeIconChannel(world: { readonly release: string } | undefined): HomeIconChannel;
/** The web manifest's icon rows for one channel. */
export function homeIconManifestRows(channel: string): HomeIconManifestRow[];
/** Point a finished build's head links and manifest at one channel's icons and drop the other channels' files. */
export function writeHomeIcons(outDir: string, channel: string): void;
