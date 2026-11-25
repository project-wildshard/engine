// oxlint-disable-next-line import/no-nodejs-modules -- Shardfiles are addressed by their real hash.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The counting job and its store live in a folder of their own.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The counting job and its store live in a folder of their own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The counting job and its store live in a folder of their own.
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createCookWorker, indexKey, uncookedLiveRefusal, type CookIndex, type CookRow} from '../src/cook/game/cookWorker';
import {folderStore, type PackStore} from '../src/cook/game/packStore';

/** SHARD-COMPAT SP7, the recook rule: a build whose cook revision is unchanged copies the indexes another build cooked; a
 * moved revision recooks every head; a live head with no index stops the promotion by name. A counting double stands at the
 * real worker's child-process boundary: it writes real store bytes and performs no asset or sim cook. */
const root = process.cwd(), HEADS = 28;
const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const job = `import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
const [tar,out,slug]=process.argv.slice(2),body=readFileSync(tar),hash=createHash('sha256').update(body).digest('hex');
const counter=join(resolve(out,'../../cache'),'launches');
writeFileSync(counter,String((existsSync(counter)?Number(readFileSync(counter,'utf8')):0)+1));
const header='shardfiles/'+slug+'/shard.json',part='assets/spawn/parts/'+hash+'.pack.br';
// J450: a cook ends with its map, so the stand-in draws both sizes too.
const maps=['','-cell'].map(size=>'shardfiles/'+slug+'/cooked-map-v1'+size+'.png');
for(const [file,value] of [[header,JSON.stringify({hash})],[part,'part '+hash],...maps.map(map=>[map,'png'])]){const path=join(out,'client',file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);}
mkdirSync(join(out,'server'),{recursive:true});writeFileSync(join(out,'server/shard.json'),JSON.stringify({hash}));
console.log(JSON.stringify({slug,hash,proof:'unmeasured',check:{pass:true},cook:{manifests:[],map:{full:1,cell:1,drawn:'plain'}},header,server:{files:1,bytes:1},seconds:0}));`;

describe('the recook rule (SP7)', () => {
  let scratch = '', store: PackStore | undefined;
  const blobs = new Map<string, Uint8Array>(), heads: {slug: string; hash: string}[] = [];
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cook-recook-'));
    mkdirSync(join(scratch, 'jobs'), {recursive: true});
    writeFileSync(join(scratch, 'jobs/job.mjs'), job);
    // QA 11-25 row 33: the counting job is plain JavaScript, so it takes an empty loader in bake-loader's place; bake-loader's
    // TypeScript hooks cost each of the file's 58 launches about 0.2 s and checked nothing here.
    writeFileSync(join(scratch, 'jobs/loader.mjs'), '');
    store = folderStore(join(scratch, 'store'));
    for (let at = 0; at < HEADS; at++) {
      const bytes = new TextEncoder().encode(`shard ${String(at)}`), hash = hashOf(bytes);
      blobs.set(hash, bytes); heads.push({slug: `shard-${String(at)}`, hash});
    }
  });
  afterAll(() => { if (scratch !== '') rmSync(scratch, {recursive: true, force: true}); });
  const launches = (): number => { const file = join(scratch, 'jobs/cache/launches'); return existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0; };
  let downloads = 0;
  const worker = (build: string, cook: string | undefined): ReturnType<typeof createCookWorker> => {
    if (store === undefined) throw new Error('no store');
    return createCookWorker({build, store, serverPacks: join(scratch, 'server'), scratch: join(scratch, 'jobs'), validator: 'v1', ...(cook === undefined ? {} : {cook}),
      launcher: {root, execPath: process.execPath, loader: join(scratch, 'jobs/loader.mjs'), script: join(scratch, 'jobs/job.mjs'), wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024, cpuSlots: 1}},
      source: {heads: () => Promise.resolve(heads.map((head, at) => ({...head, revision: at + 1}))), download: hash => { downloads++; const bytes = blobs.get(hash); if (bytes === undefined) throw new Error('No such shardfile'); return Promise.resolve(bytes); }}});
  };
  const index = async (build: string, hash: string): Promise<CookIndex> => {
    const body = await store?.get(indexKey(build, hash));
    if (body === undefined) throw new Error(`no index ${build}/${hash}`);
    return JSON.parse(new TextDecoder().decode(body)) as CookIndex;
  };

  it('cooks 28 heads, then a docs-only build copies all 28 indexes with no job, under 30 s', async () => {
    const first = await worker('build-a', 'cook-1').recook(['live']);
    expect(first.map(row => row.state)).toEqual(Array.from({length: HEADS}, () => 'cooked'));
    expect(launches()).toBe(HEADS);
    expect((await index('build-a', heads[0]?.hash ?? '')).cook).toBe('cook-1+v1');
    const before = downloads, started = performance.now();
    const carried = await worker('build-b', 'cook-1').recook(['live']);
    const seconds = (performance.now() - started) / 1000;
    expect(carried.map(row => row.state)).toEqual(Array.from({length: HEADS}, () => 'present'));
    expect(carried.every(row => row.detail === 'carried from build-a')).toBe(true);
    expect(launches(), 'a carry launches no job').toBe(HEADS);
    expect(downloads, 'a carry downloads nothing').toBe(before);
    expect(seconds).toBeLessThan(30);
    for (const head of heads) {
      const copy = await index('build-b', head.hash), own = await index('build-a', head.hash);
      expect(copy).toEqual({...own, build: 'build-b', carried: 'build-a'});
      for (const key of copy.keys) expect(await store?.has(key), key).toBe(true);
    }
    console.log(JSON.stringify({criterion: 'docs-only carry', heads: HEADS, seconds: Number(seconds.toFixed(2)), launches: launches()}));
  }, 120_000);

  it('a moved cook revision recooks every head', async () => {
    const rows = await worker('build-c', 'cook-2').recook(['live']);
    expect(rows.map(row => row.state)).toEqual(Array.from({length: HEADS}, () => 'cooked'));
    expect(launches()).toBe(2 * HEADS);
    expect((await index('build-c', heads[0]?.hash ?? '')).carried).toBeUndefined();
  }, 120_000);

  it('a worker with no cook revision, or a different validator, never carries', async () => {
    const plain = await worker('build-d', undefined).cook(heads[0] ?? {slug: '', hash: ''});
    expect(plain.state).toBe('cooked');
    if (store === undefined) throw new Error('no store');
    const other = createCookWorker({build: 'build-e', store, serverPacks: join(scratch, 'server'), scratch: join(scratch, 'jobs'), validator: 'v2', cook: 'cook-2',
      launcher: {root, execPath: process.execPath, loader: join(scratch, 'jobs/loader.mjs'), script: join(scratch, 'jobs/job.mjs'), wrap: [], limits: {seconds: 30, memoryMB: 2048, heapMB: 1024, cpuSlots: 1}},
      source: {heads: () => Promise.resolve([]), download: hash => Promise.resolve(blobs.get(hash) ?? new Uint8Array())}});
    expect((await other.cook(heads[1] ?? {slug: '', hash: ''})).state).toBe('cooked');
  }, 120_000);

  it('promotion with an uncooked live shard is refused by name', () => {
    const rows: CookRow[] = [{slug: 'pine-hollow', hash: 'a', state: 'present'}, {slug: 'driftwood', hash: 'b', state: 'failed', detail: 'past 1500 s'}, {slug: 'nalati', hash: 'c', state: 'refused', detail: 'Invalid shardfile'}];
    expect(uncookedLiveRefusal('b1', rows)).toBe('Promotion refused: build b1 has no cook index for live shards driftwood (failed: past 1500 s), nalati (refused: Invalid shardfile)');
    expect(uncookedLiveRefusal('b1', rows.slice(0, 1))).toBeUndefined();
  });
});
