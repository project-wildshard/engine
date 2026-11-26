// @vitest-environment node
// QA 11-25 row 131: production's content reach check, fed v0.1.92's shape (rows 121 and 123): a page naming boot tables, grid
// seams and title art its content set's index lacks.
import {expect, test} from 'vitest';
import {contentReach, namedPaths, pageScripts, reachProblems, type Answer} from '../src/scripts/page-release/content-reach.mjs';

const build = '889b423bed33b64e778d7e69b07450eef62aad2a';
const set = '2ba30cfddecd9b49';
const base = `https://packs.wildshard.io/content/${set}/`;
const stagingBase = 'https://packs.wildshard.io/content/d21a64ad329cfe38/';
const origin = 'https://play.wildshard.io';
const bank = JSON.stringify({contentBase: base});

/** The page: a boot bank with the set's base, title art by full URL, the main script and an old-name map entry. */
const html = `<!doctype html><script>globalThis.__WS_BUILD_ID__="${build}";</script>
<link rel="apple-touch-startup-image" href="${base}assets/title/launch-1206x2622-aa16bc3256f3.png">
<script type="application/json" id="boot-module-files">${bank}</script>
<script>var map={"/b/${build}/calibration-OLD.js":"/b/${build}/calibration-NEW.js"};</script>
<script type="module" crossorigin src="/b/${build}/main-C0XQtDof.js"></script>`;
const main = `const t={common:{url:"/assets/boot-tables-e42a1de3.json",bytes:9,sha256:"e42a1de3"}};fetch("/assets/grid-seam-plans-aced7c9a.json");
import("/assets/physics/rapier.wasm");const s="/b/c/control-0-0-1beo-startup-SycAKqU-.js";`;
const sw = 'self.precache=["/assets/title/title-day-1f0e.jpg"];';
const bootTables = JSON.stringify({bytes: {'/assets/baked/common/cloud-field.bin': 262144}});
const packsBook = JSON.stringify({book: 'packs', build, client: {'nalati-grasslands': {phone: {url: '/assets/spawn/nalati-grasslands-client-phone-3dcfb9c1cfece266.json', code: {url: '/assets/spawn/code/042bdfd1af203810.json'}}}}});
const tier = JSON.stringify({files: [{url: '/shardfiles/nalati-grasslands/blobs/glb/aa.glb'}, {url: '/assets/physics/rapier.wasm?v=2935a533'}]});
const serverBook = JSON.stringify({book: 'server', build, shards: {'nalati-grasslands': {url: '/assets/spawn/server/fbf35a9c5f0a4325.pack.br'}}});
const engineBook = JSON.stringify({book: 'engine', build, client: {}});

/** Every content path the fixture page names, and its text where it has one. */
const content = new Map<string, string>([
  ['assets/title/launch-1206x2622-aa16bc3256f3.png', 'png'],
  ['assets/title/title-day-1f0e.jpg', 'jpg'],
  ['assets/boot-tables-e42a1de3.json', bootTables],
  ['assets/grid-seam-plans-aced7c9a.json', '{}'],
  ['assets/baked/common/cloud-field.bin', 'bin'],
  [`assets/spawn/packs-${build}.json`, packsBook],
  [`assets/spawn/server-${build}.json`, serverBook],
  [`assets/spawn/engine-${build}.json`, engineBook],
  ['assets/spawn/nalati-grasslands-client-phone-3dcfb9c1cfece266.json', tier],
  ['assets/spawn/code/042bdfd1af203810.json', '{"files":[]}'],
  ['shardfiles/nalati-grasslands/blobs/glb/aa.glb', 'glb'],
  ['assets/spawn/server/fbf35a9c5f0a4325.pack.br', 'br'],
]);

const indexOf = (paths: Iterable<string>, bytes = (path: string) => `sha-${path}`) =>
  JSON.stringify({format: 1, set, files: [...paths].map(path => ({path, kind: 'S1', bytes: 1, sha256: bytes(path)}))});

/** A fake CDN: `served` answers 200 with play CORS, the rest 404; each set's index lists `indexed`. */
function cdn(served: Iterable<string>, indexed: Iterable<string>, staged: string = indexOf(content.keys())) {
  const live = new Set(served);
  const index = indexOf(indexed);
  const reads: string[] = [];
  const get = (url: string, from: string): Promise<Answer> => {
    reads.push(url);
    const answer = (status: number, body = ''): Answer => ({status, cors: status === 200 ? from : null, text: () => Promise.resolve(body), drop: () => Promise.resolve()});
    if (url === `${base}content.json`) return Promise.resolve(answer(200, index));
    if (url === `${stagingBase}content.json`) return Promise.resolve(answer(200, staged));
    const path = url.startsWith(base) ? url.slice(base.length) : '';
    return Promise.resolve(live.has(path) ? answer(200, content.get(path) ?? '') : answer(404));
  };
  return {get, reads};
}
const pages = new Map([['index.html', html], [`b/${build}/main-C0XQtDof.js`, main], ['sw.js', sw]]);
const readPage = (path: string) => {
  const body = pages.get(path);
  return body === undefined ? Promise.reject(new Error(`${path} 404`)) : Promise.resolve(body);
};

test('the names come from the page, its boot tables and spawn books, never code or runtime files', async () => {
  expect(pageScripts(html, build)).toEqual([`b/${build}/main-C0XQtDof.js`]);
  expect([...namedPaths(main)].sort()).toEqual(['assets/boot-tables-e42a1de3.json', 'assets/grid-seam-plans-aced7c9a.json']);
  const {get} = cdn(content.keys(), content.keys());
  const reach = await contentReach({origin, readPage, get, stagingBase});
  expect(reach.named).toBe(content.size);
  expect(reachProblems(reach)).toEqual([]);
  expect(reach).toMatchObject({build, base, misses: [], gaps: [], differ: [], unstaged: 0});
});

// v0.1.92 as it went live: the set's index and the CDN lack the boot tables, grid seams and title art the page names.
test("v0.1.92's shape fails: the page names paths its set's index lacks, and they 404", async () => {
  const lacking = ['assets/boot-tables-e42a1de3.json', 'assets/grid-seam-plans-aced7c9a.json', 'assets/title/launch-1206x2622-aa16bc3256f3.png', 'assets/title/title-day-1f0e.jpg'];
  const held = [...content.keys()].filter(path => !lacking.includes(path));
  const {get} = cdn(held, held);
  const reach = await contentReach({origin, readPage, get, sleep: () => Promise.resolve()});
  expect(reach.gaps).toEqual(lacking.toSorted());
  expect(reach.misses).toEqual(lacking.map(path => `404 ${path}`).toSorted());
  const problems = reachProblems(reach);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toMatch(/^4 named content path\(s\) are not in .*content\.json: assets\/boot-tables-e42a1de3\.json/u);
  expect(problems[1]).toMatch(/^4 named content path\(s\) do not answer 200 with CORS/u);

  // row 123's restore wrote the files but not the index: they answer, and the check still fails on the index.
  const restored = await contentReach({origin, readPage, get: cdn(content.keys(), held).get});
  expect(restored.misses).toEqual([]);
  expect(reachProblems(restored)).toEqual([expect.stringMatching(/^4 named content path\(s\) are not in /u)]);
});

test('bytes that differ from the set staging QA played fail; the channel-bound spawn books and lists do not', async () => {
  const staged = indexOf(content.keys(), path => path === 'assets/grid-seam-plans-aced7c9a.json' || /^assets\/spawn\/[^/]*\.json$|^assets\/spawn\/code\//u.test(path) ? 'other' : `sha-${path}`);
  const {get} = cdn(content.keys(), content.keys(), staged);
  const reach = await contentReach({origin, readPage, get, stagingBase});
  expect(reach.differ).toEqual(['assets/grid-seam-plans-aced7c9a.json']);
  expect(reachProblems(reach)).toEqual([expect.stringMatching(/^1 named content path\(s\) differ from the set staging QA played \(https:\/\/packs\.wildshard\.io\/content\/d21a64ad329cfe38\/\)/u)]);
});

test('a page with no content base, or CORS for another origin, is refused', async () => {
  await expect(contentReach({origin, readPage: path => path === 'index.html' ? Promise.resolve(`<script>globalThis.__WS_BUILD_ID__="${build}";</script>`) : readPage(path),
    get: cdn(content.keys(), content.keys()).get})).rejects.toThrow(/no content base/u);
  const {get} = cdn(content.keys(), content.keys());
  const reach = await contentReach({origin: 'https://staging.wildshard.io', readPage, get: (url, _from) => get(url, origin)});
  expect(reach.misses).toHaveLength(content.size);
  expect(reach.misses[0]).toMatch(/^CORS https:\/\/play\.wildshard\.io /u);
});
