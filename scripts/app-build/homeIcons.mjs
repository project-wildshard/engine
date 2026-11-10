import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** J236 (Jake, 2026-11-10): each environment's home-screen icon is framing A (tilt), a real engine render of the
 *  3 × 3 around Driftwood. Production is plain, staging carries an amber S and preview a violet P (J209). Every
 *  channel ships the same files under `public/icons/<channel>/`; scripts/home-icons.mjs makes them from the 1024 px
 *  masters. */
export const HOME_ICON_CHANNELS = Object.freeze(['production', 'staging', 'preview']);

/** The channel `index.html` and `public/manifest.webmanifest` name as written: a dev server and any build without a
 *  world are the standalone (solo) game, which is preview. */
export const DEFAULT_HOME_ICON_CHANNEL = 'preview';

/** Each channel's files. `master` is which 1024 px source it comes from: `any` is the full-bleed art iOS masks itself,
 *  `maskable` keeps the nine cells and the badge inside the 80 % safe circle Android masks to. `purpose` puts a file
 *  in the web manifest; `link` puts it in the document head. */
export const HOME_ICON_FILES = Object.freeze([
  { name: 'apple-touch-icon.png', size: 180, master: 'any', link: 'apple-touch-icon' },
  { name: 'favicon-64.png', size: 64, master: 'any', link: 'icon' },
  { name: 'icon-192.png', size: 192, master: 'any', purpose: 'any' },
  { name: 'icon-512.png', size: 512, master: 'any', purpose: 'any' },
  { name: 'maskable-192.png', size: 192, master: 'maskable', purpose: 'maskable' },
  { name: 'maskable-512.png', size: 512, master: 'maskable', purpose: 'maskable' },
].map(row => Object.freeze(row)));

/** @param {string} channel */
export const homeIconDirectory = channel => `/icons/${channel}/`;

/** A build stamped with a world is an MMO page: the production release file makes it production, any other world
 *  (staging, a local sitting fixture) is not production. No world is the solo build, preview.
 *  @param {{release: string} | undefined} world */
export function homeIconChannel(world) {
  if (world === undefined) return 'preview';
  return /\/releases\/production\.json(?:[?#]|$)/u.test(world.release) ? 'production' : 'staging';
}

/** The web manifest's icon rows for one channel.
 *  @param {string} channel */
export function homeIconManifestRows(channel) {
  if (!HOME_ICON_CHANNELS.includes(channel)) throw new Error(`Unknown home icon channel: ${channel}`);
  return HOME_ICON_FILES.filter(row => row.purpose !== undefined).map(row => ({
    src: `${homeIconDirectory(channel)}${row.name}`, sizes: `${row.size}x${row.size}`, type: 'image/png', purpose: row.purpose,
  }));
}

/** Point a finished build at one channel's icons: its documents' head links, its web manifest, and only that channel's
 *  files in the output. Runs after stampBuildDocuments and before the service worker reads the final document.
 *  @param {string} outDir @param {string} channel */
export function writeHomeIcons(outDir, channel) {
  if (!HOME_ICON_CHANNELS.includes(channel)) throw new Error(`Unknown home icon channel: ${channel}`);
  const from = homeIconDirectory(DEFAULT_HOME_ICON_CHANNEL), to = homeIconDirectory(channel);
  const index = resolve(outDir, 'index.html');
  const html = readFileSync(index, 'utf8');
  for (const row of HOME_ICON_FILES.filter(file => file.link !== undefined))
    if (!html.includes(`href="${from}${row.name}"`)) throw new Error(`index.html lacks its ${row.link} link to ${from}${row.name}`);
  if (channel !== DEFAULT_HOME_ICON_CHANNEL) writeFileSync(index, html.replaceAll(`"${from}`, `"${to}`));
  const manifestPath = resolve(outDir, 'manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, icons: homeIconManifestRows(channel) }, null, 2)}\n`);
  const icons = resolve(outDir, 'icons');
  if (existsSync(icons)) for (const name of readdirSync(icons)) if (name !== channel) rmSync(join(icons, name), { recursive: true, force: true });
  for (const row of HOME_ICON_FILES)
    if (!existsSync(join(icons, channel, row.name))) throw new Error(`Missing home icon ${to}${row.name}`);
}
