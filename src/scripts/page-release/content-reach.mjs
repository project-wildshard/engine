#!/usr/bin/env node
// QA 11-25 row 131 (after rows 121 and 123, the v0.1.92 P0): a promoted page reads every content path from its content
// set, so production proves the set serves every path the page names, before the alias moves and again after it. v0.1.92
// went live with 357 paths its page named and its set never held (its index had 9,827 files, the page asked for more),
// and players got 404s on the boot tables, grid seams and title art.
//
// The names come from the page itself: index.html, sw.js, every code file index.html loads from this build and every file
// the build's own graph in deploy-chunks.json lists (its shared `b/c/` code too, QA 11-25 row 146); then the boot tables
// those name (`assets/boot-tables-<hash>.json`), the build's three spawn books
// (`assets/spawn/{packs,server,engine}-<build>.json`) and every spawn list the books name. Each content path must be in
// the set's own index (`content.json`), and must answer 200 from the set with the channel page's Origin in
// Access-Control-Allow-Origin. With a staging set (the one staging QA played on, the verdict's `contentBase`) the bytes of
// every named path both sets hold must match, so production serves the bytes staging QA entered the MMO on; the spawn
// books and lists are channel-bound (their code lists differ by channel) and are left out of that comparison.
//
// Only the paths this build names are asked for (QA 11-25 row 146). The page also carries the files of up to four older
// builds (previousDeploy.mjs, MF2), so a tab still running one finds its code; a carried build reads its content from
// the page or its own set, never this one. v0.1.96's page carried v0.1.85's books, spawn lists and boot tables, which
// name 190 paths this set never held and no client of this build fetches (a staging boot through ENTER THE MMO, Nine
// Dragon and Pine Hollow asked for none of them). A walk of every file in dist/ counts them (9417 of 9607); this check
// leaves them out and says how many carried files it left out.
//
// J205: the check reads the static page and the content set only. It opens no socket and joins nothing.
//
//   node src/scripts/page-release/content-reach.mjs [<origin>] [--page=<dist>] [--staging-base=<url>] [--json]
//
//   <origin>        the page whose names are read, live (default https://play.wildshard.io); also the CORS Origin
//   --page=<dist>   read the page from a local build instead (production go-live does this before the alias moves)
//   --staging-base  compare bytes with this set (https://packs.wildshard.io/content/<set>/)
// Exit 0: every named path is in the index and answers. Exit 1: a miss, a gap or a byte difference, each named.
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isContent} from '../app-build/splitOutput.mjs';

/** The page documents that name content, besides the code index.html loads. */
export const PAGE_DOCUMENTS = Object.freeze(['index.html', 'sw.js']);
const NONE = new Set();
// A content path, page-rooted (`"/assets/…"`) or under a set's base (`…/content/<set>/assets/…`).
const NAMED = /(?:["'`(\s,=]|\/content\/[0-9a-f]{16})\/((?:assets|shardfiles|programs)\/[A-Za-z0-9_./-]+\.[a-z0-9]+)/gu;
// A spawn list a book names relative to `assets/spawn/` (rel86's restore list read these, row 123).
const BOOK_RELATIVE = /"((?:parts|code|server)\/[0-9a-f]{16}\.(?:pack\.br|json))"/gu;
/** The page's graph of builds (previousDeploy.mjs): this build's files first, then the builds it carries. */
export const DEPLOY_CHUNKS = 'deploy-chunks.json';
/** A file of a build's graph that can name content: its code and its per-build JSON and HTML. */
const NAMING = /\.(?:m?js|json|html)$/u;
const BOOT_TABLES = /^assets\/boot-tables-[0-9a-f]{8}\.json$/u;
const SPAWN_LIST = /^assets\/spawn\/(?:code\/)?[a-z0-9-]+\.json$/u;
/** The books are channel-bound: their tier and code lists name channel code. */
const CHANNEL_BOUND = /^assets\/spawn\/(?:[a-z0-9-]+-[0-9a-f]{16}\.json|code\/[0-9a-f]{16}\.json|(?:packs|server|engine)-[0-9a-f]{40}\.json)$/u;

/** Every content path a text names, page-relative with no leading slash. @param {string} text @returns {Set<string>} */
export function namedPaths(text) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const match of text.matchAll(NAMED)) {
    const path = match[1] ?? '';
    if (!path.includes('..') && isContent(path, NONE)) found.add(path);
  }
  return found;
}

/** The code files index.html loads from this build: its `<script src>` and modulepreload links under `/b/<build>/` (the
 * boot bank also maps old code names to new ones, and an old name is never served). @param {string} html @param {string} build */
export function pageScripts(html, build) {
  const tags = [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"|<link\b[^>]*rel="modulepreload"[^>]*\shref="([^"]+)"/gu)];
  return [...new Set(tags.map(match => match[1] ?? match[2] ?? '').filter(src => src.startsWith(`/b/${build}/`) && src.endsWith('.js'))
    .map(src => src.slice(1)))].sort();
}

/**
 * This build's own files that can name content, from the page's deploy-chunks.json, and how many files of the builds it
 * carries are left out (row 146). Undefined when the graph is unreadable or does not name this build.
 * @param {string} text deploy-chunks.json @param {string} build @returns {{own: string[], carried: number} | undefined}
 */
export function ownGraph(text, build) {
  /** @type {unknown} */
  let graph;
  try { graph = JSON.parse(text); } catch { return undefined; }
  /** @type {unknown[]} */
  const builds = typeof graph === 'object' && graph !== null && 'builds' in graph && Array.isArray(graph.builds) ? graph.builds : [];
  /** @param {unknown} row @returns {string[]} */
  const files = row => {
    if (typeof row !== 'object' || row === null || !('files' in row) || !Array.isArray(row.files)) return [];
    return row.files.map((/** @type {unknown} */ file) => (typeof file === 'object' && file !== null && 'path' in file ? file.path : undefined))
      .filter((/** @type {unknown} */ path) => typeof path === 'string' && !path.split('/').includes('..') && NAMING.test(path));
  };
  const mine = builds.find(row => typeof row === 'object' && row !== null && 'build' in row && row.build === build);
  if (mine === undefined) return undefined;
  const own = new Set(files(mine));
  const carried = new Set(builds.filter(row => row !== mine).flatMap(files).filter(path => !own.has(path)));
  return {own: [...own].sort(), carried: carried.size};
}

/** @param {string} html */
export function buildOf(html) {
  return /globalThis\.__WS_BUILD_ID__="([0-9a-f]{40})"/u.exec(html)?.[1];
}

/** PZ6: the boot bank's content base (flow.mjs contentBaseIn, kept local so this file needs no flow import cycle).
 * @param {string} html */
export function baseOf(html) {
  const bank = /<script type="application\/json" id="boot-module-files">([^<]+)<\/script>/u.exec(html)?.[1];
  if (bank === undefined) return undefined;
  const base = JSON.parse(bank).contentBase;
  return typeof base === 'string' && base !== '' ? base : undefined;
}

/**
 * @typedef {{status: number, cors: string | null, text: () => Promise<string>, drop: () => Promise<void>}} Answer
 * @typedef {{
 *   origin: string,
 *   readPage: (path: string) => Promise<string>,
 *   get: (url: string, origin: string) => Promise<Answer>,
 *   stagingBase?: string,
 *   width?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} ReachInput
 * @typedef {{build: string, base: string, named: number, indexed: number, misses: string[], gaps: string[],
 *   differ: string[], unstaged: number, staging?: string, code: number, carried?: number}} Reach  `code`: this build's page
 *   files read for names; `carried`: the files of the builds the page carries, left out (undefined: no graph to read)
 */

/** A read that retries a 5xx or no answer 3 times, 3 s apart (engine 1a08b3f45's read-back rule); a 4xx is final.
 * @param {ReachInput} input @param {string} url @returns {Promise<Answer | undefined>} */
async function settled(input, url) {
  const sleep = input.sleep ?? (ms => new Promise(done => setTimeout(done, ms)));
  for (let attempt = 0; ; attempt++) {
    /** @type {Answer | undefined} */
    let answer;
    try { answer = await input.get(url, input.origin); } catch { answer = undefined; }
    if ((answer !== undefined && answer.status < 500) || attempt >= 3) return answer;
    await answer?.drop();
    await sleep(3000);
  }
}

/** @param {ReachInput} input @param {string} url @returns {Promise<string>} */
async function text(input, url) {
  const answer = await settled(input, url);
  if (answer?.status !== 200) {
    await answer?.drop();
    throw new Error(`${url} answered ${answer?.status ?? 'nothing'}`);
  }
  return answer.text();
}

/** @param {ReachInput} input @param {string} base @returns {Promise<Map<string, string>>} path to sha256 */
async function readIndex(input, base) {
  const index = JSON.parse(await text(input, `${base}content.json`));
  if (!Array.isArray(index?.files)) throw new Error(`${base}content.json holds no file list`);
  return new Map(index.files.map((/** @type {{path: string, sha256: string}} */ row) => [row.path, row.sha256]));
}

/**
 * Every content path the page names, checked against its set: in the index, served with CORS, and (with a staging set)
 * the same bytes staging QA played. Throws only when the page or the set's index cannot be read at all.
 * @param {ReachInput} input @returns {Promise<Reach>}
 */
export async function contentReach(input) {
  const html = await input.readPage('index.html');
  const build = buildOf(html), base = baseOf(html);
  if (build === undefined) throw new Error('index.html names no build');
  if (base === undefined) throw new Error('index.html names no content base: a promoted page reads its content from a set');
  const named = new Set();
  const add = (/** @type {Iterable<string>} */ paths) => { for (const path of paths) named.add(path); };
  add(namedPaths(html));
  // Row 146: this build's own graph, never a carried build's files. A page without a readable graph reads the code
  // index.html loads.
  /** @type {{own: string[], carried: number} | undefined} */
  let graph;
  try { graph = ownGraph(await input.readPage(DEPLOY_CHUNKS), build); } catch { graph = undefined; }
  const code = [...new Set([...PAGE_DOCUMENTS.slice(1), ...pageScripts(html, build), ...(graph?.own ?? [])])];
  /** @type {string[]} */
  const unreadPage = [];
  let nextPage = 0;
  await Promise.all(Array.from({length: Math.min(input.width ?? 12, 8)}, async () => {
    while (nextPage < code.length) {
      const name = code[nextPage++] ?? '';
      try { add(namedPaths(await input.readPage(name))); } catch { unreadPage.push(name); }
    }
  }));
  // The boot tables, the books and the lists they name: read from the set, each one also a named path.
  const books = ['packs', 'server', 'engine'].map(book => `assets/spawn/${book}-${build}.json`);
  add(books);
  /** @type {string[]} */
  const unread = [];
  /** @param {string} path @returns {Promise<string | undefined>} */
  const read = async path => {
    try { return await text(input, `${base}${path}`); } catch { unread.push(path); return undefined; }
  };
  for (const path of [...named].filter(path => BOOT_TABLES.test(path))) add(namedPaths(await read(path) ?? ''));
  /** @type {Set<string>} */
  const lists = new Set();
  for (const book of books) {
    const body = await read(book);
    if (body === undefined) continue;
    for (const path of namedPaths(body)) { named.add(path); if (SPAWN_LIST.test(path)) lists.add(path); }
    for (const match of body.matchAll(BOOK_RELATIVE)) named.add(`assets/spawn/${match[1]}`);
  }
  for (const list of lists) add(namedPaths(await read(list) ?? ''));

  const index = await readIndex(input, base);
  const paths = [...named].sort();
  const gaps = paths.filter(path => !index.has(path));
  /** @type {string[]} */
  const misses = [];
  let next = 0;
  await Promise.all(Array.from({length: input.width ?? 12}, async () => {
    while (next < paths.length) {
      const path = paths[next++] ?? '';
      const answer = await settled(input, `${base}${path}`);
      await answer?.drop();
      if (answer?.status !== 200) misses.push(`${answer?.status ?? 'no answer'} ${path}`);
      else if (answer.cors !== input.origin) misses.push(`CORS ${answer.cors ?? 'none'} ${path}`);
    }
  }));
  misses.sort();
  /** @type {string[]} */
  const differ = [];
  let unstaged = 0;
  if (input.stagingBase !== undefined && input.stagingBase !== base) {
    const staged = await readIndex(input, input.stagingBase);
    for (const path of paths) {
      if (CHANNEL_BOUND.test(path)) continue;
      const theirs = staged.get(path), ours = index.get(path);
      if (theirs === undefined) unstaged++;
      else if (ours !== undefined && theirs !== ours) differ.push(path);
    }
  }
  for (const path of unread) if (!misses.some(line => line.endsWith(` ${path}`))) misses.push(`unreadable ${path}`);
  for (const name of unreadPage.sort()) misses.push(`unreadable page file ${name}`);
  return {build, base, named: paths.length, indexed: index.size, misses, gaps, differ, unstaged, code: code.length - unreadPage.length,
    ...(graph === undefined ? {} : {carried: graph.carried}),
    ...(input.stagingBase === undefined ? {} : {staging: input.stagingBase})};
}

/** One line per refusal reason, each naming up to 8 paths; empty when the page and its set agree. @param {Reach} reach */
export function reachProblems(reach) {
  const some = (/** @type {string[]} */ rows) => `${rows.slice(0, 8).join(', ')}${rows.length > 8 ? ', ...' : ''}`;
  return [
    ...(reach.gaps.length === 0 ? [] : [`${reach.gaps.length} named content path(s) are not in ${reach.base}content.json: ${some(reach.gaps)}`]),
    ...(reach.misses.length === 0 ? [] : [`${reach.misses.length} named content path(s) do not answer 200 with CORS: ${some(reach.misses)}`]),
    ...(reach.differ.length === 0 ? [] : [`${reach.differ.length} named content path(s) differ from the set staging QA played (${reach.staging}): ${some(reach.differ)}`]),
  ];
}

/** @param {Reach} reach */
export function reachSummary(reach) {
  const read = `${reach.code} page files read${reach.carried === undefined ? ' (no deploy-chunks.json graph)' : `, ${reach.carried} carried from older builds left out`}`;
  return `${reach.build.slice(0, 10)} ${reach.base}: ${read}; ${reach.named} named content paths, ${reach.named - reach.gaps.length} indexed, `
    + `${reach.named - reach.misses.length} answer 200 with CORS${reach.staging === undefined ? '' : `, ${reach.differ.length} differ from staging's set (${reach.unstaged} not in it)`}`;
}

/** A marked GET (J205: static page and content only). @param {typeof fetch} fetcher @returns {ReachInput['get']} */
export function fetchAnswer(fetcher) {
  return async (url, origin) => {
    const response = await fetcher(url, {headers: {origin}, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000)});
    return {status: response.status, cors: response.headers.get('access-control-allow-origin'),
      text: () => response.text(), drop: async () => { await response.body?.cancel(); }};
  };
}

/** @param {{origin: string, page?: string, fetcher: typeof fetch}} options @returns {ReachInput['readPage']} */
export function pageReader({origin, page, fetcher}) {
  if (page !== undefined) return name => Promise.resolve(readFileSync(join(resolve(page), name), 'utf8'));
  return async name => {
    const response = await fetcher(`${origin}/${name === 'index.html' ? '' : name}`, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000)});
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`${origin}/${name} answered ${response.status}`); }
    return response.text();
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (/** @type {string} */ name) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const origin = args.find(arg => !arg.startsWith('--')) ?? 'https://play.wildshard.io';
  const {agentFetch} = await import('../agent-requests.mjs');
  const page = value('page'), stagingBase = value('staging-base');
  try {
    const reach = await contentReach({origin, readPage: pageReader({origin, fetcher: agentFetch, ...(page === undefined ? {} : {page})}),
      get: fetchAnswer(agentFetch), ...(stagingBase === undefined ? {} : {stagingBase})});
    if (args.includes('--json')) console.log(JSON.stringify(reach, null, 2));
    console.log(reachSummary(reach));
    const problems = reachProblems(reach);
    for (const line of problems) console.error(line);
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
