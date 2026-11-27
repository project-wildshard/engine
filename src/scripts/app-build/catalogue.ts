import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import * as v from 'valibot';
import {packsBookPath, readSpawnManifest} from '../../shared/game/shardfile/spawnManifest';
import {prepareAssetDecoders} from '@wildshard/format/shardfileAssets';
import {validateShardfileFolder} from '@wildshard/format/shardfileValidation';
import {assertKtx2TableTargets} from '../../shared/game/shardfile/ktx2Targets';
import {parseStandaloneCatalogue, type StandaloneCatalogue} from '../standalone-catalogue.ts';
import {CELL_HEIGHT, CHUNK_SIZE} from '@wildshard/format/contentBounds';
import {readTar} from '@wildshard/format/tar';
import type {CookIndex} from '../../cook/game/cookWorker';
import type {PackStore} from '../../cook/game/packStore';
import {bareSlug, installCatalogue, playerHidden, selectTitleRows} from '../../shared/game/grid/catalogueSlot';
import {serverPackBookPath} from '../../shared/game/shardfile/serverPack';
import {folderTarball} from '../../cook/game/folderTarball';
import {titleMetadata, type TitleManifest} from '../../client/game/shard/titleList';
import {servedDiscoveryPath} from '../../cook/game/entryTotals';
import {ZoneSelectSchema, type ZoneSelectDocument} from '../../shared/game/grid/zoneSelectRows';

/** C3 (J61, D7): every build bakes `catalogue.json`, so a build needs no server, and inlines it in `index.html`, so the
 * first paint waits on no new fetch. `WILDSHARD_CATALOGUE` names a file a deploy took from `api-server`'s
 * `/api/catalogue.json`; with none, the in-tree grid and this build's products say the same thing. */
const ELEMENT = /<script type="application\/json" id="ws-catalogue">[^<]*<\/script>/u;
/** J138: the shards cooked to R2 and its origin, for a page's spawn download. */
export interface PackHome {
  readonly base: string;
  readonly shards: readonly string[];
  readonly loose?: Readonly<Record<string, string>>;
}
const inline = (text: string): string => `<script type="application/json" id="ws-catalogue">${text.replaceAll('<', String.raw`\u003c`)}</script>`;

const ROWS = /<script type="application\/json" id="ws-title-rows">[^<]*<\/script>/u;
/** C3: the title's rows beside the catalogue, so a shard's card and name reach the first paint with no rebuild. */
export function writeTitleRows(outDir: string, rows: readonly TitleManifest[]): void {
  const element = `<script type="application/json" id="ws-title-rows">${JSON.stringify(rows).replaceAll('<', String.raw`\u003c`)}</script>`;
  const file = join(outDir, 'index.html'), html = readFileSync(file, 'utf8');
  if (!html.includes('</head>')) throw new Error('No document head for the title rows');
  const catalogue = /<script type="application\/json" id="ws-catalogue">([^<]*)<\/script>/u.exec(html)?.[1];
  if (catalogue !== undefined) installCatalogue(JSON.parse(catalogue));
  const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const links = selectTitleRows(rows, true).map(row => `<a class="ws-launch-shard" href="/slug/${encodeURIComponent(bareSlug(row.slug))}"${playerHidden(row) ? ' data-developer' : ''}><b>${escape(row.name)}</b><span>${escape(row.biome)}</span></a>`).join('');
  const titled = ROWS.test(html) ? html.replace(ROWS, () => element) : html.replace('</head>', () => `${element}</head>`);
  writeFileSync(file, titled.replace(/<!-- first-menu-cards -->[\s\S]*?<!-- \/first-menu-cards -->/u,
    () => `<!-- first-menu-cards -->${links}<!-- /first-menu-cards -->`));
}
const readTitleRows = (outDir: string): readonly TitleManifest[] => {
  const text = /<script type="application\/json" id="ws-title-rows">([^<]*)<\/script>/u.exec(readFileSync(join(outDir, 'index.html'), 'utf8'))?.[1];
  return text === undefined ? [] : JSON.parse(text.replaceAll(String.raw`\u003c`, '<')) as readonly TitleManifest[];
};
const hash8 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 8);
/** A title row from a shard's discovery document: `home` is an origin for a shard cooked to R2 (J138). */
export function titleRowOf(bytes: Uint8Array, home = '', resourceSlug?: string): TitleManifest {
  const {data} = JSON.parse(new TextDecoder().decode(bytes)) as {readonly data: TitleManifest};
  const base = home.replace(/\/$/u, ''), from = `/shardfiles/${data.slug}/`, to = `/shardfiles/${resourceSlug ?? data.slug}/`;
  // A stored cook serves blobs under its canonical identity, while an older discovery can still name its
  // authored folder.
  const at = (url: string): string => (url.startsWith(from) ? `${base}${to}${url.slice(from.length)}` : url.startsWith('/shardfiles/') ? `${base}${url}` : url);
  const {thumb, portrait, landscape} = data.card;
  return {...titleMetadata(data), ...(data.shardfile === undefined ? {} : {shardfile: at(data.shardfile)}), card: {thumb: at(thumb), portrait: at(portrait), landscape: at(landscape)}, discovery: `${base}/shardfiles/${data.slug}/discovery.json?v=${hash8(bytes)}`};
}
/** Every built product's title row, in title order. */
export function folderTitleRows(products: string, outDir?: string): readonly TitleManifest[] {
  const rows = readdirSync(products, {withFileTypes: true}).flatMap(entry => {
    // S12d: the document as this build serves it (`servedDiscoveryPath`, the phone tier's table), so the title's `?v=` is its hash.
    const own = join(products, entry.name, 'mounts/shardfiles', entry.name, 'discovery.json'), served = outDir === undefined ? undefined : servedDiscoveryPath(outDir, entry.name);
    const file = served !== undefined && existsSync(served) ? served : own;
    return entry.isDirectory() && existsSync(own) ? [titleRowOf(readFileSync(file))] : [];
  });
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function writeCatalogueDocument(outDir: string, document: unknown): void {
  const text = JSON.stringify(parseStandaloneCatalogue(document));
  writeFileSync(join(outDir, 'catalogue.json'), text);
  const file = join(outDir, 'index.html'), html = readFileSync(file, 'utf8');
  if (!html.includes('</head>')) throw new Error('No document head for the catalogue');
  writeFileSync(file, ELEMENT.test(html) ? html.replace(ELEMENT, () => inline(text)) : html.replace('</head>', () => `${inline(text)}</head>`));
}

const ZONE_SELECT = /<script type="application\/json" id="ws-zone-select">[^<]*<\/script>/u;
const STAGING_ZONE_SELECT = 'https://rooms-staging.wildshard.io/zone-select';

export function writeZoneSelectDocument(outDir: string, document: ZoneSelectDocument): void {
  const text = JSON.stringify(document).replaceAll('<', String.raw`\u003c`);
  const element = `<script type="application/json" id="ws-zone-select">${text}</script>`;
  const file = join(outDir, 'index.html'), html = readFileSync(file, 'utf8');
  if (!html.includes('</head>')) throw new Error('No document head for Zone Select');
  writeFileSync(file, ZONE_SELECT.test(html) ? html.replace(ZONE_SELECT, () => element) : html.replace('</head>', () => `${element}</head>`));
}

/** Each release carries the staging list for a first launch offline. */
export async function stagingZoneSelect(root: string, read: typeof fetch = fetch): Promise<ZoneSelectDocument> {
  try {
    const reply = await read(STAGING_ZONE_SELECT, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(1500) });
    if (reply.ok) {
      const document = v.parse(ZoneSelectSchema, await reply.json());
      if (document.channel === 'staging') return document;
    } else await reply.body?.cancel();
  } catch { /* A release can use the checked-in staging snapshot. */ }
  return v.parse(ZoneSelectSchema, JSON.parse(readFileSync(join(root, 'test/pins/zone-select.json'), 'utf8')));
}

interface Listed {readonly slug: string; readonly order?: number; readonly status?: string}

/** The in-tree grid with this build's heads: a product's slug, name and tarball hash, at revision 1. */
export function inTreeCatalogue(root: string, products: string, listed: readonly Listed[]): StandaloneCatalogue {
  const grid = JSON.parse(readFileSync(join(root, 'test/pins/catalogue.json'), 'utf8')) as Pick<StandaloneCatalogue, 'version' | 'placements' | 'grid'>;
  const rows = new Map(listed.map(row => [row.slug, row]));
  const placements = grid.placements.map(row => {
    const shard = rows.get(row.slug);
    return {...row, ...(shard?.order === undefined ? {} : {order: shard.order}), ...(shard?.status === undefined ? {} : {status: shard.status})};
  });
  const shards: StandaloneCatalogue['shards'] = [], missing: string[] = [];
  for (const row of placements) {
    const folder = join(products, row.slug), header = join(folder, 'shard.json');
    if (!existsSync(header)) { missing.push(row.slug); continue; }
    const index = JSON.parse(readFileSync(header, 'utf8')) as {readonly identity: {readonly slug: string; readonly name: string}};
    shards.push({slug: index.identity.slug, name: index.identity.name, uploadNumber: 1, hash: createHash('sha256').update(folderTarball(folder)).digest('hex')});
  }
  return {version: grid.version, stage: 'live', placements, grid: grid.grid, shards, missing};
}

/** The build's step: the file a deploy names, else the tree's. */
export async function bakeCatalogue(outDir: string, root: string): Promise<void> {
  const {WILDSHARD_CATALOGUE: source} = process.env;
  const rows = folderTitleRows(join(root, 'out'), outDir);
  const document = source === undefined ? inTreeCatalogue(root, join(root, 'out'), rows) : parseStandaloneCatalogue(JSON.parse(readFileSync(source, 'utf8')));
  writeCatalogueDocument(outDir, document);
  writeTitleRows(outDir, rows);
  const {WS_RELEASE: release} = process.env;
  if (release === '1') writeZoneSelectDocument(outDir, await stagingZoneSelect(root));
}

interface CookedManifest {readonly url: string; readonly tier: 'phone' | 'desktop'; readonly set: 'entry' | 'whole'; readonly files: number; readonly totalBytes: number; readonly wireBytes: number}
export interface CookedShard {
  readonly slug: string;
  readonly hash: string;
  readonly header: string;
  readonly manifests: readonly CookedManifest[];
  /** The row `buildValidationReceipts` writes for this product. */
  readonly verdict: unknown;
  /** Its discovery document's bytes: its title row. A shard with none wears the catalogue's plain card. */
  readonly discovery?: Uint8Array;
  /** Its row of the server pack book, when it has a server class. */
  readonly server?: unknown;
  /** Whether this cook actually published the optional recorded-program file. */
  readonly entryPrograms?: boolean;
}

/** A catalogue shard this build has no code or table for, once its packs exist: each table a page reads names it, in files
 *  the bundle doesn't hash. Nothing under `/b/<build>/` changes, which is what "no client rebuild" means (C3). */
export function addCookedShards(outDir: string, shards: readonly CookedShard[], cooked: string = outDir, home?: PackHome): void {
  const {build} = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8')) as {build: string};
  const file = join(outDir, 'index.html');
  let html = readFileSync(file, 'utf8');
  const expression = /(<script type="application\/json" id="boot-module-files">)([^<]+)(<\/script>)/u, match = expression.exec(html);
  if (match?.[2] === undefined) throw new Error('Missing entry module bank');
  const bank = JSON.parse(match[2]) as {entryPrograms?: Record<string, boolean>; spawnManifests: {client: Record<string, Record<string, unknown>>; home?: PackHome}};
  const bookFile = join(outDir, packsBookPath(build)), book = JSON.parse(readFileSync(bookFile, 'utf8')) as {client?: Record<string, Record<string, unknown>>};
  const verdicts: unknown[] = [];
  for (const shard of shards) {
    const address = (row: CookedManifest): unknown => {
      const bytes = readFileSync(join(cooked, row.url.slice(1)));
      readSpawnManifest(JSON.parse(bytes.toString('utf8')));
      return {url: row.url, bytes: bytes.length, totalBytes: row.totalBytes, files: row.files, wireBytes: row.wireBytes};
    };
    const pick = (set: 'entry' | 'whole'): Record<string, unknown> => Object.fromEntries(shard.manifests.filter(row => row.set === set).map(row => [row.tier, address(row)]));
    bank.spawnManifests.client[shard.slug] = pick('entry');
    if (shard.entryPrograms !== undefined) (bank.entryPrograms ??= {})[shard.slug] = shard.entryPrograms;
    (book.client ??= {})[shard.slug] = pick('whole');
    verdicts.push(shard.verdict);
  }
  if (home !== undefined) bank.spawnManifests.home = home;
  writeFileSync(bookFile, JSON.stringify(book));
  const serverFile = join(outDir, serverPackBookPath(build));
  if (shards.some(row => row.server !== undefined) && existsSync(serverFile)) {
    const servers = JSON.parse(readFileSync(serverFile, 'utf8')) as {shards: Record<string, unknown>};
    for (const row of shards) if (row.server !== undefined) servers.shards[row.slug] = row.server;
    writeFileSync(serverFile, JSON.stringify(servers));
  }
  html = html.replace(expression, () => `<script type="application/json" id="boot-module-files">${JSON.stringify(bank).replaceAll('<', String.raw`\u003c`)}</script>`);
  writeFileSync(file, appendValidationVerdicts(html, verdicts));
  const added = shards.flatMap(row => {
    if (row.discovery === undefined) return [];
    const stored = home?.shards.includes(row.slug) === true;
    // SA48: a stored cook's shardfiles live only in its upload's loose folder, so its title row reads them there.
    const loose = stored ? home.loose?.[bareSlug(row.slug)] ?? '' : '';
    return [titleRowOf(row.discovery, stored ? `${home.base.replace(/\/$/u, '')}/${loose}` : '', stored ? row.slug : undefined)];
  });
  if (added.length > 0) writeTitleRows(outDir, [...readTitleRows(outDir).filter(row => !added.some(next => next.slug === row.slug)), ...added]);
}

/** Stamp attached headers, replacing the verdict for each path they serve.
 * The verdict array shares a script with build labels and other stamps.
 * Find its JSON boundary without consuming or executing those assignments. */
export function appendValidationVerdicts(html: string, verdicts: readonly unknown[]): string {
  const marker = 'globalThis.__WS_SHARDFILE_VERDICTS__=', start = html.indexOf(marker);
  if (start === -1) throw new Error('Missing validation verdicts');
  const from = start + marker.length;
  let depth = 0, quoted = false, escaped = false;
  for (let at = from; at < html.length; at++) {
    const char = html[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        const before: unknown = JSON.parse(html.slice(from, at + 1));
        if (!Array.isArray(before)) throw new Error('Invalid validation verdicts');
        const installed = new Set(verdicts.map(verdictPath).filter(path => path !== undefined));
        const retained = before.filter((row: unknown) => {
          const path = verdictPath(row);
          return path === undefined || !installed.has(path);
        });
        return html.slice(0, from) + JSON.stringify([...retained, ...verdicts]).replaceAll('<', String.raw`\u003c`) + html.slice(at + 1);
      }
    }
  }
  throw new Error('Unclosed validation verdicts');
}

function verdictPath(row: unknown): string | undefined {
  return typeof row === 'object' && row !== null && 'path' in row && typeof row.path === 'string' ? row.path : undefined;
}

// SHARD-COMPAT CP10 (J486): a pinned or stored shard file was judged at its upload; memory policy only reports here.
// Spread, so a format before CP10 (which has no `judged` port) still types.
const STORED = {judged: 'stored'} as const;

/** What a page takes on trust for one tarball: a verdict is earned here, by this build's format validator, whichever validator
 *  stamped its receipt, because a page trusts it by its index hash. */
export async function folderVerdict(tarball: Uint8Array, out: string): Promise<{readonly verdict: unknown; readonly discovery?: Uint8Array}> {
  await prepareAssetDecoders();
  const files = readTar(tarball);
  validateShardfileFolder({read: (path, maximum) => { const bytes = files.get(path); if (bytes === undefined || bytes.length > maximum) throw new Error(`No ${path}`); return bytes; }, paths: () => files.keys()},
    {hash: bytes => createHash('sha256').update(bytes).digest('hex'), ...STORED});
  // S11: a deploy's added shard serves its KTX2 targets itself, or the build already holds them.
  assertKtx2TableTargets({paths: () => files.keys(), read: path => { const bytes = files.get(path); if (bytes === undefined) throw new Error(`No ${path}`); return bytes; }},
    url => { const file = join(out, url); return !url.split('/').includes('..') && existsSync(file) && statSync(file).isFile(); });
  const revision = /__WS_SHARDFILE_VALIDATOR__="([a-f0-9]{64})"/u.exec(readFileSync(join(out, 'index.html'), 'utf8'))?.[1];
  if (revision === undefined) throw new Error('No validator stamped on the build');
  const receipt = files.get('validation.json'), index = files.get('shard.json');
  if (receipt === undefined || index === undefined) throw new Error('No validation receipt');
  const {sourceHash, indexHash, residentBytes, postCost, worst} = JSON.parse(new TextDecoder().decode(receipt)) as Readonly<Record<string, unknown>>;
  const {identity: {slug}} = JSON.parse(new TextDecoder().decode(index)) as {readonly identity: {readonly slug: string}};
  const discovery = [...files].find(([path]) => /^mounts\/shardfiles\/[^/]+\/discovery\.json$/u.test(path))?.[1];
  return {verdict: {revision, sourceHash, indexHash, residentBytes, postCost, path: `/shardfiles/${slug}/shard.json`, ...(worst === undefined ? {} : {worst})}, ...(discovery === undefined ? {} : {discovery})};
}

/** A pinned staging-only head needs an instance on the nightly standalone page. */
export function nightlyHeadCatalogue(built: StandaloneCatalogue, reviewed: StandaloneCatalogue,
  head: {readonly slug: string; readonly hash: string}): StandaloneCatalogue {
  const namesHead = (row: {readonly slug: string}): boolean => bareSlug(row.slug) === head.slug;
  if (built.placements.some(namesHead) || built.grid.cells.some(namesHead)) return built;
  // QA 11-25 row 73: a cell is the slug's address, not one revision's. Staging moves ahead of the pins (mirror-salt r8
  // reviewed, r7 pinned), and a hash match left the pinned head unplaced: its boot died on an unknown built-in instance.
  const cell = reviewed.grid.cells.find(namesHead);
  if (cell === undefined || !reviewed.shards.some(row => row.slug === head.slug)) return built;
  return {...built, placements: [...built.placements, {
    instance: cell.instance, slug: cell.slug, cell: cell.cell, size: [CHUNK_SIZE, CELL_HEIGHT, CHUNK_SIZE],
  }]};
}

/** STANDALONE-SHARDFILES SF5d: a page trusts a stored shard by the hash of the header it reads, and that header is the
 *  cook's. A shard with a shardVersion has it stamped into its cook section by the cook (cookJob `openShardfile`), so its
 *  header is not the upload's: the upload's validated `indexHash` names bytes no page reads, and the page took stale-client
 *  recovery ("app older than its product") on Pine Hollow 0.0.18. The verdict names the served header instead. */
export function storedVerdict<T extends {readonly verdict: unknown}>(proved: T, header: Uint8Array): T {
  const indexHash = createHash('sha256').update(header).digest('hex');
  return {...proved, verdict: {...(proved.verdict as Record<string, unknown>), indexHash}};
}

/** A deploy's catalogue over a build's: the build keeps what it shipped, grid included, and gains each added shard's rows. */
export function catalogueWithAdded(built: StandaloneCatalogue, live: StandaloneCatalogue, slugs: readonly string[]): StandaloneCatalogue {
  const added = new Set(slugs), named = (row: {readonly slug: string}): boolean => added.has(bareSlug(row.slug));
  const shards = live.shards.filter(named), missing = slugs.filter(slug => !shards.some(row => row.slug === slug));
  if (missing.length > 0) throw new Error(`The catalogue has no row for ${missing.join(', ')}`);
  return {...built, placements: [...built.placements.filter(row => !named(row)), ...live.placements.filter(named)], shards: [...built.shards.filter(row => !named(row)), ...shards]};
}

/** A head the cook worker already cooked for this build (J29), read from its store onto a built client: no cook, and no rebuild.
 *  What a page reads stays in the store under `home`, but for the header a page's product opens by its own URL and the
 *  server's pack, which the server worker reads beside it. A shard this build shipped keeps its own copy: it leaves with
 *  `src/shards` (P5). `live` is the catalogue document the heads came from. */
export async function addStoredShards(out: string, heads: readonly {readonly slug: string; readonly hash: string}[], store: Pick<PackStore, 'get'>, read: (hash: string) => Promise<Uint8Array>, home: PackHome, live: StandaloneCatalogue): Promise<readonly string[]> {
  const {indexKey, looseFolder} = await import('../../cook/game/cookWorker');
  const {build} = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8')) as {build: string};
  const bank = /<script type="application\/json" id="boot-module-files">([^<]+)<\/script>/u.exec(readFileSync(join(out, 'index.html'), 'utf8'))?.[1];
  if (bank === undefined) throw new Error('Missing entry module bank');
  const {spawnManifests: {client}} = JSON.parse(bank) as {spawnManifests: {client: Record<string, unknown>}};
  const scratch = mkdtempSync(join(tmpdir(), 'bake-stored-')), added: CookedShard[] = [], need = async (key: string): Promise<Uint8Array> => {
    const body = await store.get(key);
    if (body === undefined) throw new Error(`The store has no ${key}`);
    return body;
  };
  const loose = {...home.loose};
  const copy = async (key: string, root: string, source = key): Promise<void> => {
    mkdirSync(dirname(join(root, key)), {recursive: true});
    writeFileSync(join(root, key), await need(source));
  };
  try {
    for (const head of heads) {
      const body = Object.keys(client).some(slug => bareSlug(slug) === bareSlug(head.slug)) ? undefined : await store.get(indexKey(build, head.hash));
      if (body === undefined) continue;
      const index = JSON.parse(new TextDecoder().decode(body)) as CookIndex;
      // J262 (SP1a): the cook went by a preparation from another renderer; the bake says so beside its list.
      if (index.preparation === 'stale') console.warn(`stale preparation: ${index.slug}`);
      if (index.loose !== undefined) {
        if (index.loose !== looseFolder(head.hash)) throw new Error(`The stored cook for ${index.slug} names another upload`);
        loose[bareSlug(index.slug)] = index.loose;
      }
      for (const row of index.manifests) await copy(row.url.slice(1), scratch);
      const headerBytes = await need(`${index.loose ?? ''}${index.header}`);
      mkdirSync(dirname(join(out, index.header)), {recursive: true});
      writeFileSync(join(out, index.header), headerBytes);
      for (const key of index.keys) if (key.startsWith('assets/spawn/server/')) await copy(key, out);
      const proved = storedVerdict(await folderVerdict(await read(head.hash), out), headerBytes);
      const server = index.serverPack?.index.slice(1);
      added.push({slug: index.slug, hash: head.hash, header: index.header, manifests: index.manifests,
        entryPrograms: index.keys.includes(`${index.loose ?? ''}programs/${index.slug}.json`), ...proved,
        ...(server === undefined ? {} : {server: JSON.parse(new TextDecoder().decode(await need(server))) as unknown})});
    }
    if (added.length > 0) {
      const slugs = added.map(row => row.slug);
      writeCatalogueDocument(out, catalogueWithAdded(parseStandaloneCatalogue(JSON.parse(readFileSync(join(out, 'catalogue.json'), 'utf8'))), live, slugs));
      addCookedShards(out, added, scratch, {...home, shards: [...home.shards, ...slugs], ...(Object.keys(loose).length === 0 ? {} : {loose})});
    }
    return added.map(row => row.slug);
  } finally { rmSync(scratch, {recursive: true, force: true}); }
}
