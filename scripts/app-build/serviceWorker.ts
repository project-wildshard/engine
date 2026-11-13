/** Plain post-build PWA emission. Runtime caching owns no graph, accounting or hash work. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { rolldown } from 'rolldown';
import { isContentPath, readContentBase } from '../../src/client/engine/boot/contentBase';
import { ASSET_CACHE_NAME } from '../../src/client/engine/pwa/cacheNames';
import { serverPackBookPath } from '../../src/shared/game/shardfile/serverPack';
import { packsBookPath } from '../../src/shared/game/shardfile/spawnManifest';
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

/** PAGE-SIZE PZ10: the document's stamped `contentBase` (PZ8 stamps it before the worker bakes), or '' for the page. */
function documentContentBase(html: string): string {
  const bank = /<script type="application\/json" id="boot-module-files">([^<]+)<\/script>/u.exec(html)?.[1];
  if (bank === undefined) return '';
  const value: unknown = JSON.parse(bank);
  return readContentBase(typeof value === 'object' && value !== null ? Reflect.get(value, 'contentBase') : undefined);
}

interface Book { readonly url: string; readonly bytes: Uint8Array }

/** The build owns names. No worker parses boot banks, packs or runtime product metadata. */
export async function serviceWorkerCore(bundle: Readonly<Record<string, EmittedFile>>, root: string, buildId: string, serverBook?: Book, packsBook?: Book): Promise<{
  core: string; build: string; assets: string; hashed: string[];
}> {
  const document = bundle['index.html'];
  if (document?.type !== 'asset' || document.source === undefined) throw new Error('Missing worker document');
  const html = new TextDecoder().decode(document.source);
  // Everything emitted under the build's folder is immutable by it: the standalone shell names its entries, and they precache with their chunks.
  // A13: the Developer-only failure screen prototypes (src/client/app/failScreens.ts) are never precached, so no player downloads them.
  const hashed = Object.keys(bundle).filter(name => /^(?:assets|b\/[\w.-]+)\/[^/]+-[\w-]{8}\.\w+$|^b\/[\w.-]+\/standalone\/[^/]+\.(?:js|wasm)$/u.test(name) && !/-failScreens-[\w-]{8}\.js$/u.test(name)).map(name => `/${name}`).sort();
  const sources = new Map(Object.entries(titleAssetURLs(root)).map(([source, url]) => [url, source]));
  // S2: a deck portrait waits for control with the code (DL1), so a first visit's title doesn't fetch every shard's.
  const shell = shellFiles(html, root, sources), portraits = shell.filter(url => /^\/assets\/title\/[^/]+-portrait-/u.test(url)), digest = createHash('sha256');
  // Bundle the worker's explicit clock/owner imports; no page runtime enters it.
  const worker = await rolldown({ input: join(root, 'src/client/engine/pwa/sw.js'), platform: 'browser', transform: { target: 'es2022' } });
  let source: string;
  try {
    const output = (await worker.generate({ format: 'iife' })).output.find(file => file.type === 'chunk');
    if (output === undefined) throw new Error('Missing service worker bundle');
    source = output.code;
  } finally { await worker.close(); }
  digest.update(source);
  for (const name of [...hashed, '/index.html']) {
    const file = bundle[name.slice(1)];
    if (file === undefined) throw new Error(`Missing worker file: ${name}`);
    digest.update(name).update(file.type === 'chunk' ? file.code ?? '' : file.source ?? new Uint8Array());
  }
  for (const name of shell) if (name !== '/index.html') digest.update(name).update(readFileSync(join(root, 'public', sources.get(name) ?? name)));
  if (serverBook !== undefined) digest.update(serverBook.url).update(serverBook.bytes);
  // PZ10: with a content base, every content path (the books, the title art) is read from it, so the worker precaches it
  // there, into its cross-build content cache; the page keeps code and shell. With none, the lists are today's.
  const base = documentContentBase(html);
  // The build's server book with its code: a device that adopts a build and goes offline can still read a server class it holds.
  let files = [...hashed, ...portraits, ...serverBook === undefined ? [] : [serverBook.url]], shellList = shell.filter(url => !portraits.includes(url));
  let content: string[] = [];
  if (base !== '') {
    if (packsBook !== undefined) digest.update(packsBook.url).update(packsBook.bytes);
    digest.update(base);
    const moved = [...files, ...shellList, ...packsBook === undefined ? [] : [packsBook.url]].filter(path => isContentPath(path));
    content = [...new Set(moved)].map(path => new URL(`.${path}`, base).href);
    files = files.filter(path => !isContentPath(path)); shellList = shellList.filter(path => !isContentPath(path));
  }
  const build = `${buildId}-${digest.digest('hex').slice(0, 10)}`;
  const core = source.replaceAll('__BUILD_ID__', build).replaceAll('__ASSET_CACHE__', ASSET_CACHE_NAME)
    .replace(/['"]__FILES__['"]/u, () => JSON.stringify(JSON.stringify(files)))
    .replace(/['"]__SHELL_FILES__['"]/u, () => JSON.stringify(JSON.stringify(shellList)))
    .replace(/['"]__CONTENT__['"]/u, () => JSON.stringify(JSON.stringify({ base, files: content })))
    .replace(/['"]__DOCUMENT__['"]/u, () => JSON.stringify(html));
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
  writeFileSync(join(outDir, 'sw.js'), stampWorker(scripts.bootstrap, outDir));
  console.log(`sw.js refreshed (${buildId}-${digest})`);
}

/** PZ10: a bake of a split output (PZ4) sees the hashed top-level `assets/` files the split moved to `<out>-content/` (the
 *  boot tables, engine art), so they reach the content precache as they would from the whole output. Only those: the
 *  content tree is gigabytes, and nothing deeper is in the precache. */
function splitBundle(outDir: string, bundle: Record<string, EmittedFile>): Record<string, EmittedFile> {
  const moved = join(`${resolve(outDir)}-content`, 'assets');
  if (!existsSync(moved)) return bundle;
  const joined = { ...bundle };
  for (const entry of readdirSync(moved, { withFileTypes: true })) {
    const name = `assets/${entry.name}`;
    if (entry.isFile() && /-[\w-]{8}\.\w+$/u.test(entry.name) && joined[name] === undefined) joined[name] = { type: 'asset', source: new Uint8Array(readFileSync(join(moved, entry.name))) };
  }
  return joined;
}

/** STALE-BUILD SB1 (J321): sw.js opens with its build's time (version.json `time`), as the page and its entry do. */
function stampWorker(bootstrap: string, outDir: string): string {
  const { time } = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as { time?: unknown };
  const at = typeof time === 'string' ? Date.parse(time) : Number.NaN;
  return Number.isFinite(at) ? `// built ${new Date(at).toISOString()}\nself.__WS_BUILT_AT__=${at};\n${bootstrap}` : bootstrap;
}

/** Called after ordinary bundling; previous-deploy chunks are carried by MF2 afterwards. */
export async function writeServiceWorker(outDir: string, root: string): Promise<void> {
  const { build: buildId } = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as { build: string };
  // a split output (PAGE-SIZE PZ4) keeps its books beside the page, in `<out>-content/`
  const book = (path: string): Book | undefined => {
    const file = [join(outDir, path), join(`${resolve(outDir)}-content`, path)].find(at => existsSync(at));
    return file === undefined ? undefined : { url: `/${path}`, bytes: readFileSync(file) };
  };
  const { core, build, hashed } = await serviceWorkerCore(splitBundle(outDir, writtenBundle(outDir, root)), root, buildId, book(serverPackBookPath(buildId)), book(packsBookPath(buildId))), scripts = workerScripts(core);
  mkdirSync(dirname(join(outDir, scripts.fileName)), { recursive: true });
  writeFileSync(join(outDir, scripts.fileName), core);
  writeFileSync(join(outDir, 'sw.js'), stampWorker(scripts.bootstrap, outDir));
  console.log(`sw.js written (${build}; ${ASSET_CACHE_NAME}; ${hashed.length} precached files)`);
}
