#!/usr/bin/env node
// QA 11-25 row 131 (after rows 121 and 123, the v0.1.92 P0): a promoted page reads every content path from its content
// set, so production proves the set serves every path the page names, before the alias moves and again after it. v0.1.92
// went live with 357 paths its page named and its set never held (its index had 9,827 files, the page asked for more),
// and players got 404s on the boot tables, grid seams and title art.
//
// The names come from the page itself: index.html, sw.js and every code file index.html loads from this build; then the
// boot tables those name (`assets/boot-tables-<hash>.json`), the build's three spawn books
// (`assets/spawn/{packs,server,engine}-<build>.json`) and every spawn list the books name. Each content path must be in
// the set's own index (`content.json`), and must answer 200 from the set with the channel page's Origin in
// Access-Control-Allow-Origin. With a staging set (the one staging QA played on, the verdict's `contentBase`) the bytes of
// every named path both sets hold must match, so production serves the bytes staging QA entered the MMO on; the spawn
// books and lists are channel-bound (their code lists differ by channel) and are left out of that comparison.
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
 *   differ: string[], unstaged: number, staging?: string}} Reach
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
  for (const name of [...PAGE_DOCUMENTS.slice(1), ...pageScripts(html, build)]) add(namedPaths(await input.readPage(name)));
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
  return {build, base, named: paths.length, indexed: index.size, misses, gaps, differ, unstaged,
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
  return `${reach.build.slice(0, 10)} ${reach.base}: ${reach.named} named content paths, ${reach.named - reach.gaps.length} indexed, `
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
