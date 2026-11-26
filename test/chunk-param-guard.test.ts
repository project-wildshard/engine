// CHUNK-PARAM-REMOVAL CP23 (J522): the guard refuses a URL-shaped `chunk` coming back, and nothing else named chunk.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRID_ARM, MEASURING, chunkParamCount, chunkParamOffenders, guardKey, judge, measuringEntryOffenders, oneShardBranches, titleEntries } from '../src/scripts/chunk-param-guard.mjs';

describe('chunk-param guard', () => {
  it('fails on the param in an address, a params call and a template', () => {
    expect(chunkParamCount("location.href = '/?chunk=x'")).toBe(1);
    expect(chunkParamCount("url.searchParams.set('chunk', z)")).toBe(1);
    expect(chunkParamCount('const query = `chunk=${slug}`')).toBe(1);
    expect(chunkParamCount("new URLSearchParams(location.search).get('chunk')")).toBe(1);
    expect(chunkParamCount("search.has(\"chunk\") && page.goto(base + '&chunk=' + slug)")).toBe(2);
    expect(chunkParamCount("open(`${origin}/(chunk=a)`)")).toBe(1);
    // MAIN RED 45762609780: a params object built the Nine load's address, and (a) and (b) read zero
    expect(chunkParamCount("for(const [key,value] of Object.entries({chunk:'nine-dragon-stack',mute:'1'}))url.searchParams.set(key,value);")).toBe(1);
    expect(chunkParamCount("url.search = new URLSearchParams({mute:'1', chunk:source.slug}).toString();")).toBe(1);
  });

  it('passes the music sting, Rollup\'s chunk type and a --chunk= flag', () => {
    expect(chunkParamCount("music.sting('chunk')")).toBe(0);
    expect(chunkParamCount("if (output.type === 'chunk') emit(output)")).toBe(0);
    expect(chunkParamCount('node bench.mjs --chunk=4')).toBe(0);
    expect(chunkParamCount('const chunkSize = 4; chunks.push(chunk)')).toBe(0);
    // a record or a bundle naming its chunk is no address
    expect(chunkParamCount("const run={chunk:'brasscap-mesa',ready:true}; build({chunk: 'export const a = 1'})")).toBe(0);
    // CP22: a variable named chunk compared or taken as an arrow's argument is not the param
    expect(chunkParamCount("if(chunk===undefined)throw e; rows.map(chunk=>chunk.bytes)")).toBe(0);
  });

  it('skips a line marked as an old-link proof, and only that line', () => {
    expect(chunkParamCount("expect(at('/?chunk=x')).toBe('/'); // chunk-param-guard: old link\nlocation.href = '/?chunk=y'")).toBe(1);
  });

  it('reads only its scope, never project/ or the calibration reports', () => {
    const files: Record<string, string> = {
      'src/a.ts': "params.get('chunk')", 'scripts/b.mjs': '?chunk=x&chunk=y', 'docs/c.md': 'open /?chunk=pine-hollow',
      'project/journal/d.md': '/?chunk=old', 'budgets/calibration-reports/e.json': '"/?chunk=old"', 'lint/f.json': '"?chunk="',
      'src/g.png': '?chunk=binary', 'index.html': "homeParams.has('chunk')",
      'test/parity/baselines/m5/h.json': '"/?chunk=old"', 'test/fixtures/phone-loading-a6701db71.json': '"/?chunk=old"',
    };
    expect(chunkParamOffenders({ paths: Object.keys(files), read: path => files[path] ?? '' }))
      .toEqual({ 'docs/c.md': 1, 'index.html': 1, 'scripts/b.mjs': 2, 'src/a.ts': 1 });
  });

  it('keys a moved script by its old path, so the lean layout\'s move is never a new offender', () => {
    expect(guardKey('src/scripts/bench.mjs')).toBe('scripts/bench.mjs');
    expect(guardKey('src/client/app/entry.ts')).toBe('src/client/app/entry.ts');
    expect(chunkParamOffenders({ paths: ['src/scripts/bench.mjs'], read: () => '?chunk=x' })).toEqual({ 'scripts/bench.mjs': 1 });
  });

  it('lets the baseline only shrink', () => {
    const baseline = { 'src/a.ts': 2, 'src/b.ts': 1 };
    expect(judge({ 'src/a.ts': 2, 'src/b.ts': 1 }, baseline)).toEqual({ added: [], shrunk: [] });
    expect(judge({ 'src/a.ts': 1 }, baseline)).toEqual({ added: [], shrunk: ['src/a.ts', 'src/b.ts'] });
    expect(judge({ 'src/a.ts': 3, 'src/c.ts': 1 }, baseline).added).toEqual(['src/a.ts (3, baseline 2)', 'src/c.ts (1, baseline 0)']);
  });

  it('counts the one-shard page\'s mode branches for Q2', () => {
    const files: Record<string, string> = { 'src/client/app/entry.ts': "mode === 'grid' ? a : b; path !== 'shardfile'", 'src/client/game/grid/pageEntry.ts': "x === 'shard'" };
    expect(oneShardBranches(path => { const text = files[path]; if (text === undefined) throw new Error('missing'); return text; })).toBe(3);
  });
});

// J522 (4), QA 11-25 row 99: CP17 had budgets' phone frames enter through the title's tap (enterZone with no `alone`), into the
// zone's grid cell with neighbours, and budgets run 45755470720 never settled. A measuring tool enters its zone alone.
describe('chunk-param guard: measuring tools enter alone', () => {
  const CP17 = "await enterZone(page, { zone: slug, base: url.origin, flags: url.searchParams.toString(), waitUntil: 'domcontentloaded', timeout: READY_MS });";
  const ALONE = "await enterZone(page, { zone: slug, base: url.origin, flags: url.searchParams.toString(), alone: true, unplaced: true, waitUntil: 'domcontentloaded' });";

  it('counts an entry through the title: no alone, alone: false, or a tap written by hand', () => {
    expect(titleEntries(CP17)).toBe(1);
    expect(titleEntries("await enterZone(page, { zone, base, alone: false });")).toBe(1);
    expect(titleEntries("await page.addInitScript(initScript('pine-hollow'));")).toBe(1);
    expect(titleEntries("const raw = tapDocument({ zone }); sessionStorage.setItem(key, raw);")).toBe(1);
    expect(titleEntries("await page.evaluate(saveFixtureCode({ scope: 'session', key: 'titleArrival', data }));")).toBe(1);
    expect(titleEntries(`${CP17}\n${CP17}`)).toBe(2);
  });

  it('passes an entry alone, a conditional alone, a declaration, a comment and a marked grid arm', () => {
    expect(titleEntries(ALONE)).toBe(0);
    expect(titleEntries("enterZone(page, { zone: shard === 'grid' ? 'driftwood-isle' : shard, base, alone: shard !== 'grid' })")).toBe(0);
    expect(titleEntries('export async function enterZone(driver, { base, slug, slots }) {')).toBe(0);
    expect(titleEntries('// CP17 entered by enterZone(page, { zone }) and initScript(zone)')).toBe(0);
    expect(titleEntries(`const go = \`\${initScript('driftwood-isle')}\`; // ${GRID_ARM}`)).toBe(0);
  });

  it('reads only the measuring tools, by their old-path key', () => {
    const files: Record<string, string> = {
      'src/scripts/budgets/phone-frames.mjs': CP17, 'src/scripts/memory/measure.mjs': ALONE, 'src/scripts/goldens/capture.mjs': CP17,
      'src/scripts/hero-shots.mjs': CP17, 'src/scripts/memory/iphone/bench.mjs': CP17, 'src/scripts/budgets/phone-frames.d.mts': CP17,
    };
    expect(MEASURING.every(path => path.startsWith('scripts/'))).toBe(true); // script-paths: guardKey's keys keep the old spelling
    expect(measuringEntryOffenders({ paths: Object.keys(files), read: path => files[path] ?? '' }))
      .toEqual({ 'scripts/budgets/phone-frames.mjs': 1, 'scripts/goldens/capture.mjs': 1 }); // script-paths: guardKey's keys
  });

  it('finds no measuring tool entering through the title in this tree', () => {
    const root = join(import.meta.dirname, '..');
    const paths = execFileSync('git', ['ls-files', '--', 'src/scripts'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(measuringEntryOffenders({ paths, read: path => readFileSync(join(root, path), 'utf8') })).toEqual({});
  });
});
