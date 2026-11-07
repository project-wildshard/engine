/** Plain post-build PWA emission. Runtime caching owns no graph, accounting or hash work. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ASSET_CACHE_NAME } from '../../src/client/engine/pwa/cacheNames';
import { serverPackBookPath } from '../../src/shared/game/shardfile/serverPack';
import { titleAssetURLs } from '../title-assets.mjs';
import { writtenBundle, type EmittedFile } from './writtenBundle';

/** Update checks fetch this tiny bootstrap; the core URL names its exact bytes. */
export function workerScripts(core: string): { fileName: string; bootstrap: string } {
  const fileName = `sw-core/${createHash('sha256').update(core).digest('hex')}.js`;
  return { fileName, bootstrap: `importScripts(${JSON.stringify(`/${fileName}`)});\n` };
}

function shellFiles(html: string, root: string, sources: ReadonlyMap<string, string>): string[] {
  const files = new Set(['/manifest.webmanifest']);
  const publicRoot = resolve(root, 'public');
  const add = (url: string): void => {
    if (!url.startsWith('/') || url.startsWith('//') || url.includes('?') || url.includes('#')) return;
    const file = resolve(publicRoot, `.${sources.get(url) ?? url}`);
    if (file.startsWith(`${publicRoot}${sep}`) && existsSync(file) && statSync(file).isFile()) files.add(url);
  };
  // The first-paint shell's own public images/icons, not an unrelated world bank.
  for (const match of html.matchAll(/(?:\b(?:src|href)=["']|url\(["']?)(\/[^\s"'<>)]*)/gu)) {
    if (match[1] !== undefined) add(match[1]);
  }
  // Native title-image cache routes fall back to network on a miss. Install
  // every named deck portrait too, so that fallback cannot repeat each visit.
  for (const url of sources.keys()) add(url);
  const fonts = join(publicRoot, 'fonts');
  // S2: the title's bytes. Only the Latin faces the game's text uses wait in the shell; the rest load if a glyph asks.
  if (existsSync(fonts)) for (const file of readdirSync(fonts)) if (file.endsWith('-latin.woff2')) add(`/fonts/${file}`);
  // S2: iOS reads the launch image itself, once, when the app is added; no page or worker route ever serves it.
  return [...files].filter(url => !url.startsWith('/assets/title/launch-')).sort();
}

/** The build owns names. No worker parses boot banks, packs or runtime product metadata. */
export function serviceWorkerCore(bundle: Readonly<Record<string, EmittedFile>>, root: string, buildId: string, serverBook?: { readonly url: string; readonly bytes: Uint8Array }): {
  core: string; build: string; assets: string; hashed: string[];
} {
  const document = bundle['index.html'];
  if (document?.type !== 'asset' || document.source === undefined) throw new Error('Missing worker document');
  const html = new TextDecoder().decode(document.source);
  // Everything emitted under the build's folder is immutable by it: the standalone shell names its entries, and they precache with their chunks.
  const hashed = Object.keys(bundle).filter(name => /^(?:assets|b\/[\w.-]+)\/[^/]+-[\w-]{8}\.\w+$|^b\/[\w.-]+\/standalone\/[^/]+\.(?:js|wasm)$/u.test(name)).map(name => `/${name}`).sort();
  const sources = new Map(Object.entries(titleAssetURLs(root)).map(([source, url]) => [url, source]));
  // S2: a deck portrait waits for control with the code (DL1), so a first visit's title doesn't fetch every shard's.
  const shell = shellFiles(html, root, sources), portraits = shell.filter(url => /^\/assets\/title\/[^/]+-portrait-/u.test(url)), digest = createHash('sha256');
  const owner = readFileSync(join(root, 'src/client/engine/app/workerScope.js'), 'utf8').replaceAll(/^export /gmu, '');
  const worker = readFileSync(join(root, 'src/client/engine/pwa/sw.js'), 'utf8').replace("import { workerScope } from '../app/workerScope.js';\n", '');
  const source = `${owner}\n${worker}`;
  digest.update(source);
  for (const name of [...hashed, '/index.html']) {
    const file = bundle[name.slice(1)];
    if (file === undefined) throw new Error(`Missing worker file: ${name}`);
    digest.update(name).update(file.type === 'chunk' ? file.code ?? '' : file.source ?? new Uint8Array());
  }
  for (const name of shell) if (name !== '/index.html') digest.update(name).update(readFileSync(join(root, 'public', sources.get(name) ?? name)));
  if (serverBook !== undefined) digest.update(serverBook.url).update(serverBook.bytes);
  const build = `${buildId}-${digest.digest('hex').slice(0, 10)}`;
  const core = source.replaceAll('__BUILD_ID__', build).replaceAll('__ASSET_CACHE__', ASSET_CACHE_NAME)
    // The build's server book with its code: a device that adopts a build and goes offline can still read a server class it holds.
    .replace("'__FILES__'", JSON.stringify(JSON.stringify([...hashed, ...portraits, ...serverBook === undefined ? [] : [serverBook.url]])))
    .replace("'__SHELL_FILES__'", JSON.stringify(JSON.stringify(shell.filter(url => !portraits.includes(url)))))
    .replace("'__DOCUMENT__'", JSON.stringify(html));
  return { core, build, assets: ASSET_CACHE_NAME, hashed };
}

/** A bake changed `index.html` on a finished output, whose bundler manifest stayed behind: the worker's copy of the page
 *  follows, and its id with it, or a phone keeps the old page. Nothing else in the worker moves. */
export function refreshServiceWorker(outDir: string, before: string): void {
  const { build: buildId } = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as { build: string };
  const name = /importScripts\("\/(sw-core\/[a-f0-9]+\.js)"\)/u.exec(readFileSync(join(outDir, 'sw.js'), 'utf8'))?.[1];
  if (name === undefined) throw new Error('No worker core to refresh');
  const held = readFileSync(join(outDir, name), 'utf8'), document = JSON.stringify(before), html = readFileSync(join(outDir, 'index.html'), 'utf8');
  if (!held.includes(document)) throw new Error('The worker holds another page');
  const digest = createHash('sha256').update(html).digest('hex').slice(0, 10), old = new RegExp(`${buildId.replaceAll('.', String.raw`\.`)}-[a-f0-9]{10}`, 'gu');
  const core = held.split(document).join(JSON.stringify(html)).replaceAll(old, `${buildId}-${digest}`), scripts = workerScripts(core);
  mkdirSync(dirname(join(outDir, scripts.fileName)), { recursive: true });
  writeFileSync(join(outDir, scripts.fileName), core);
  writeFileSync(join(outDir, 'sw.js'), scripts.bootstrap);
  console.log(`sw.js refreshed (${buildId}-${digest})`);
}

/** Called after ordinary bundling; previous-deploy chunks are carried by MF2 afterwards. */
export function writeServiceWorker(outDir: string, root: string): void {
  const { build: buildId } = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as { build: string };
  const book = join(outDir, serverPackBookPath(buildId));
  const { core, build, hashed } = serviceWorkerCore(writtenBundle(outDir, root), root, buildId, existsSync(book) ? { url: `/${serverPackBookPath(buildId)}`, bytes: readFileSync(book) } : undefined), scripts = workerScripts(core);
  mkdirSync(dirname(join(outDir, scripts.fileName)), { recursive: true });
  writeFileSync(join(outDir, scripts.fileName), core);
  writeFileSync(join(outDir, 'sw.js'), scripts.bootstrap);
  console.log(`sw.js written (${build}; ${ASSET_CACHE_NAME}; ${hashed.length} precached files)`);
}
