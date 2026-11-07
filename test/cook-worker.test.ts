// oxlint-disable-next-line import/no-nodejs-modules -- The cook worker supervises real child processes.
import {createHash, createHmac} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A stub of api-server's notify call and of R2.
import {createServer, type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readTar, writeTar} from '@wildshard/format/tar';
import {productTarball} from '../src/cook/game/productTarball';
import {collectGarbage, createCookWorker, indexKey, notifyServer, objectHeaders, readCapped, runJob, storeUsage, type CookIndex, type JobLauncher, type ShardfileSource} from '../src/cook/game/cookWorker';
import {runCookJob, ShardfileRefusedError} from '../src/cook/game/cookJob';
import {folderStore, r2Store, type PackStore} from '../src/cook/game/packStore';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. */
const root = process.cwd(), slug = 'sunscar-dunes', hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const launcher = (script: string = join(root, 'scripts/cook-job.mjs'), limits: Partial<JobLauncher['limits']> = {}): JobLauncher => ({root, execPath: process.execPath, loader: join(root, 'scripts/bake-loader.mjs'), script, wrap: [], limits: {seconds: 120, memoryMB: 4096, heapMB: 2048, ...limits}});
const pack = (files: ReadonlyMap<string, Uint8Array>): Uint8Array => writeTar(files);

/** A ustar with one entry `writeTar` would never write, its checksum right, so only a reader's rules refuse it. */
function rawTar(name: string, body: Uint8Array, type = '0'): Uint8Array {
  const header = new Uint8Array(512), put = (at: number, text: string): void => { header.set(new TextEncoder().encode(text), at); };
  put(0, name); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0'); put(124, `${body.length.toString(8).padStart(11, '0')}\0`); put(136, '00000000000\0');
  put(148, '        '); put(156, type); put(257, 'ustar\0'); put(263, '00');
  put(148, `${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `);
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512); padded.set(body);
  const whole = new Uint8Array(512 + padded.length + 1024); whole.set(header); whole.set(padded, 512);
  return whole;
}

describe('the cook worker', () => {
  let scratch = '', real: Uint8Array = new Uint8Array(), files = new Map<string, Uint8Array>(), store: PackStore;
  const source = (blobs: ReadonlyMap<string, Uint8Array>): ShardfileSource => ({
    heads: () => Promise.resolve([...blobs].map(([hash], row) => ({slug, revision: row + 1, hash}))),
    download: hash => { const bytes = blobs.get(hash); if (bytes === undefined) throw new Error('No such shardfile'); return Promise.resolve(bytes); },
  });
  const worker = (blobs: ReadonlyMap<string, Uint8Array>, build = 'b1', folder = 'store', budgetBytes?: number): ReturnType<typeof createCookWorker> => createCookWorker({build, store: folderStore(join(scratch, folder)), source: source(blobs), launcher: launcher(), serverPacks: join(scratch, 'server'), scratch: join(scratch, 'work'), ...(budgetBytes === undefined ? {} : {budgetBytes})});

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cook-worker-'));
    real = productTarball(join('out', slug)); files = new Map(readTar(real)); store = folderStore(join(scratch, 'store'));
  });
  afterAll(() => { rmSync(scratch, {recursive: true, force: true}); });

  it('cooks a real shard: parts and index in the store, a server pack for the room, no second cook', async () => {
    const hash = hashOf(real), cook = worker(new Map([[hash, real]]));
    const row = await cook.cook({slug, hash});
    expect(row.state, row.detail).toBe('cooked');
    const index = JSON.parse(new TextDecoder().decode(await store.get(indexKey('b1', hash)))) as CookIndex;
    expect(index).toMatchObject({version: 1, build: 'b1', slug, hash, proof: 'proved'});
    expect(index.manifests).toHaveLength(4);
    for (const key of index.keys) expect(await store.has(key), key).toBe(true);
    expect(index.keys.filter(key => key.endsWith('.pack.br')).length).toBeGreaterThan(0);
    const room = join(scratch, 'server', slug, hash), held = readdirSync(room, {recursive: true}).map(String);
    expect(held).toContain('shard.json');
    expect(index.server.bytes).toBeLessThan(real.length / 4);
    expect(held.filter(path => /\.(?:ktx2|glb|webp|png|jpe?g|mp3|m4a)$/u.test(path))).toEqual([]);
    expect((await cook.cook({slug, hash})).state).toBe('present');
    // A new engine build cooks its own index, and its parts are the ones already stored (J83).
    const before = (await store.list('assets/spawn/parts/')).length, next = worker(new Map([[hash, real]]), 'b2');
    expect((await next.recook(['live'])).map(item => item.state)).toEqual(['cooked']);
    expect((await store.list('assets/spawn/parts/')).length).toBe(before);
    expect(await store.has(indexKey('b2', hash))).toBe(true);
  }, 120_000);

  const tampered = (change: (rows: Map<string, Uint8Array>) => void): Uint8Array => { const rows = new Map(files); change(rows); return pack(rows); };
  const firstSection = (rows: ReadonlyMap<string, Uint8Array>): string => [...rows.keys()].find(path => path.startsWith('sections/')) ?? '';
  const hostile: readonly (readonly [string, () => Uint8Array])[] = [
    ['random bytes', () => Uint8Array.from({length: 4096}, (_, at) => (at * 31) % 251)],
    ['a path out of the tree', () => rawTar('../../evil.json', new TextEncoder().encode('{}'))],
    ['an absolute path', () => rawTar('/etc/evil', new TextEncoder().encode('{}'))],
    ['a symlink', () => rawTar('shard.json', new Uint8Array(), '2')],
    ['a section changed under its hash', () => tampered(rows => { const path = firstSection(rows), body = rows.get(path) ?? new Uint8Array(); const copy = Uint8Array.from(body); copy[copy.length - 2] = 0x20; rows.set(path, copy); })],
    ['an unlisted file', () => tampered(rows => { rows.set('sections/payload.js', new TextEncoder().encode('alert(1)')); })],
    ['a missing section', () => tampered(rows => { rows.delete(firstSection(rows)); })],
    ['a JSON nesting bomb', () => tampered(rows => { rows.set('shard.json', new TextEncoder().encode('['.repeat(1_500_000))); })],
    ['a header past its cap', () => tampered(rows => { rows.set('shard.json', new Uint8Array(3_000_000).fill(0x20)); })],
    ['an index with its prototype polluted', () => tampered(rows => { rows.set('shard.json', new TextEncoder().encode('{"__proto__":{"admin":true},"format":2}')); })],
  ];
  it.each(hostile)('refuses %s and stays up', async (name, make) => {
    const bytes = make(), hash = hashOf(bytes), cook = worker(new Map([[hash, bytes]]), 'b-hostile', 'hostile-store');
    const row = await cook.cook({slug, hash});
    expect(row.state, `${name}: ${row.detail ?? ''}`).toBe('refused');
    expect(await folderStore(join(scratch, 'hostile-store')).has(indexKey('b-hostile', hash))).toBe(false);
  }, 60_000);

  it('takes a failed simulation proof as a refusal: another try walks the same lanes', async () => {
    const ports = {prove: (): Promise<never> => Promise.reject(new Error('Blocked edge entry north lane 1')), wireBytes: (): number => 0, now: (): number => 0};
    await expect(runCookJob(real, join(scratch, 'unproved'), ports)).rejects.toThrow(ShardfileRefusedError);
  }, 60_000);

  it('refuses a shardfile for another slug: a notice cannot put bytes on a shard', async () => {
    const hash = hashOf(real), cook = createCookWorker({build: 'b3', store: folderStore(join(scratch, 'other')), source: source(new Map([[hash, real]])), launcher: launcher(), serverPacks: join(scratch, 'server-other'), scratch: join(scratch, 'work')});
    expect((await cook.cook({slug: 'pine-hollow', hash})).state).toBe('refused');
    expect(await folderStore(join(scratch, 'other')).has(indexKey('b3', hash))).toBe(false);
  }, 60_000);

  const job = (name: string, text: string, limits: Partial<JobLauncher['limits']> = {}, wrap: readonly string[] = []): ReturnType<typeof runJob> => {
    const work = join(mkdtempSync(join(scratch, 'limit-')), 'job'), script = join(work, name);
    mkdirSync(work);
    writeFileSync(script, text);
    return runJob({...launcher(script, limits), wrap}, join(work, 'x.tar'), join(work, 'out'));
  };

  it('kills a job past its clock', async () => {
    const outcome = await job('hang.mjs', 'for (;;) { /* a bomb the proof never ended */ }', {seconds: 2});
    expect(outcome).toEqual({kind: 'killed', reason: 'past 2 s'});
  }, 30_000);

  it('kills a job past its resident memory', async () => {
    const outcome = await job('grow.mjs', 'const held = []; for (;;) { held.push(Buffer.alloc(32e6, 1)); await new Promise(done => setTimeout(done, 5)); }', {memoryMB: 400});
    expect(outcome).toEqual({kind: 'killed', reason: 'past 400 MB resident'});
  }, 30_000);

  it('reports a crash as a failure of that job alone', async () => {
    // A real SIGABRT, but no core: under `ulimit -c unlimited` this one line wrote 6.5 GB to /cores on every run.
    // The service sets LimitCORE=0 (scripts/cook-worker.service), so only this test needs the wrap.
    const outcome = await job('crash.mjs', 'process.abort();', {}, ['sh', '-c', 'ulimit -c 0; exec "$@"', 'sh']);
    expect(outcome.kind).toBe('killed');
  }, 30_000);

  it('gives a job no files outside its folder, no children and no credentials', async () => {
    process.env['R2_PACKS_SECRET_ACCESS_KEY'] = 'hunter2';
    const outcome = await job('probe.mjs', `import {readFileSync, writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; import {homedir} from 'node:os';
      const denied = run => { try { run(); return false; } catch (error) { return error.code === 'ERR_ACCESS_DENIED'; } };
      console.log(JSON.stringify({refused: JSON.stringify({home: denied(() => readFileSync(homedir() + '/.ssh/config')), hosts: denied(() => readFileSync('/etc/hosts')), write: denied(() => writeFileSync('/tmp/cook-escape', 'x')), child: denied(() => spawnSync('/bin/ls')), secret: process.env.R2_PACKS_SECRET_ACCESS_KEY ?? null, token: process.env.HOME ?? null})}));
      process.exit(3);`);
    delete process.env['R2_PACKS_SECRET_ACCESS_KEY'];
    expect(outcome.kind).toBe('refused');
    expect(JSON.parse(outcome.kind === 'refused' ? outcome.reason : '{}')).toEqual({home: true, hosts: true, write: true, child: true, secret: null, token: null});
  }, 30_000);

  it.runIf(process.platform === 'darwin')('takes a job off the network through the host wrap', async () => {
    const work = join(mkdtempSync(join(scratch, 'limit-')), 'job'), script = join(work, 'net.mjs');
    mkdirSync(work);
    writeFileSync(script, `let reached = false; try { await fetch('https://example.com/', {signal: AbortSignal.timeout(4000)}); reached = true; } catch { /* denied */ } console.log(JSON.stringify({refused: String(reached)})); process.exit(3);`);
    const outcome = await runJob({...launcher(script), wrap: ['sandbox-exec', '-p', '(version 1)(allow default)(deny network*)']}, join(work, 'x.tar'), join(work, 'out'));
    expect(outcome).toEqual({kind: 'refused', reason: 'false'});
  }, 30_000);

  it('takes a notice over HTTP, with its token, and cooks it', async () => {
    const hash = hashOf(real), cook = worker(new Map([[hash, real]]), 'b4'), server: Server = notifyServer(cook, 'a-long-enough-test-token');
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(), port = typeof address === 'object' && address !== null ? address.port : 0, url = `http://127.0.0.1:${port}`;
    const notice = {event: 'shardfile.new', stage: 'preview', shard: slug, revision: 1, hash};
    const post = (token: string, value: unknown): Promise<Response> => fetch(`${url}/notify`, {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify(value)});
    try {
      expect((await post('wrong', notice)).status).toBe(401);
      expect((await post('a-long-enough-test-token', {...notice, hash: '../..'})).status).toBe(422);
      expect((await post('a-long-enough-test-token', {...notice, extra: 1})).status).toBe(422);
      expect((await fetch(`${url}/notify`, {method: 'POST', headers: {authorization: 'Bearer a-long-enough-test-token'}, body: 'x'.repeat(9000)}).catch(() => ({status: 400}))).status).toBe(400);
      expect((await post('a-long-enough-test-token', notice)).status).toBe(202);
      await cook.idle();
      expect(cook.rows().map(row => row.state)).toEqual(['cooked']);
      expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ok: true, failed: 0});
    } finally { await new Promise(resolve => { server.close(resolve); }); }
  }, 60_000);

  it('holds the budget: nothing is published past it', async () => {
    const hash = hashOf(real), row = await worker(new Map([[hash, real]]), 'b5', 'small', 1024).cook({slug, hash});
    expect(row).toMatchObject({state: 'failed'});
    expect(row.detail).toContain('Over the pack budget');
    expect(existsSync(join(scratch, 'small', 'index'))).toBe(false);
  }, 120_000);

  it('collects what no kept build names, and leaves young objects to a running cook', async () => {
    const put = (key: string): Promise<void> => store.put(key, new Uint8Array(10), objectHeaders(key));
    await put('assets/spawn/parts/0000000000000000000000000000000000000000000000000000000000000000.pack.br');
    await expect(collectGarbage(store, [], 1e9, Date.now())).rejects.toThrow('builds to keep');
    const young = await collectGarbage(store, ['b1'], 1e9, Date.now());
    expect(young.deleted).toBe(0);
    const report = await collectGarbage(store, ['b1'], 1e9, Date.now() + 7_200_000);
    expect(report.deleted).toBeGreaterThanOrEqual(2); // the stray part and b2's index
    expect(await store.has(indexKey('b1', hashOf(real)))).toBe(true);
    expect(await store.has(indexKey('b2', hashOf(real)))).toBe(false);
    const usage = await storeUsage(store, 1e9);
    expect(usage.byPrefix['assets/spawn/parts']?.count).toBeGreaterThan(0);
    expect(usage.share).toBeGreaterThan(0);
  }, 30_000);

  it('caps a download on its decoded bytes', async () => {
    await expect(readCapped(new Response(new Uint8Array(2048)), 1024)).rejects.toThrow('passes 1024');
    expect(await readCapped(new Response(new Uint8Array(1024)), 1024)).toHaveLength(1024);
  });
});

describe('the R2 store', () => {
  it('signs what S3 checks, says Content-Encoding on a part, and pages a listing', async () => {
    const bucket = new Map<string, {body: Buffer; headers: Record<string, string | string[] | undefined>}>();
    const signingKey = (day: string): Uint8Array => ['auto', 's3', 'aws4_request'].reduce<Uint8Array>((key, text) => createHmac('sha256', key).update(text).digest(), createHmac('sha256', 'AWS4secret').update(day).digest());
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      request.on('end', () => {
        const url = new URL(request.url ?? '', 'http://x'), body = Buffer.concat(chunks), auth = request.headers.authorization ?? '';
        const signed = /SignedHeaders=([^,]+), Signature=(\w+)/u.exec(auth), scope = /Credential=key\/(\d{8})\/auto\/s3\/aws4_request/u.exec(auth), amz = String(request.headers['x-amz-date']);
        const names = signed?.[1]?.split(';') ?? [], hash = createHash('sha256').update(body).digest('hex');
        const canonical = [request.method, url.pathname, url.search.slice(1), ...names.map(name => `${name}:${String(request.headers[name])}`), '', names.join(';'), hash].join('\n');
        const expected = createHmac('sha256', signingKey(scope?.[1] ?? '')).update(['AWS4-HMAC-SHA256', amz, `${scope?.[1] ?? ''}/auto/s3/aws4_request`, createHash('sha256').update(canonical).digest('hex')].join('\n')).digest('hex');
        if (expected !== signed?.[2] || request.headers['x-amz-content-sha256'] !== hash) { response.writeHead(403); response.end(); return; }
        const key = url.pathname.replace(/^\/packs\/?/u, '');
        if (request.method === 'PUT') { bucket.set(key, {body, headers: request.headers}); response.writeHead(200); response.end(); return; }
        if (request.method === 'DELETE') { bucket.delete(key); response.writeHead(204); response.end(); return; }
        if (key === '') {
          const rows = [...bucket].filter(([name]) => name.startsWith(url.searchParams.get('prefix') ?? '')), start = Number(url.searchParams.get('continuation-token') ?? 0), page = rows.slice(start, start + 1), more = start + 1 < rows.length;
          response.writeHead(200); response.end(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 1}</NextContinuationToken>` : ''}${page.map(([name, row]) => `<Contents><Key>${name}</Key><LastModified>2026-11-05T00:00:00.000Z</LastModified><Size>${row.body.length}</Size></Contents>`).join('')}</ListBucketResult>`);
          return;
        }
        const row = bucket.get(key);
        if (row === undefined) { response.writeHead(404); response.end(); return; }
        response.writeHead(200); response.end(request.method === 'HEAD' ? undefined : row.body);
      });
    });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(), port = typeof address === 'object' && address !== null ? address.port : 0;
    const store = r2Store({endpoint: `http://127.0.0.1:${port}`, bucket: 'packs', accessKeyId: 'key', secretAccessKey: 'secret'});
    try {
      const part = `assets/spawn/parts/${'a'.repeat(64)}.pack.br`;
      await store.put(part, new Uint8Array([1, 2, 3]), objectHeaders(part));
      expect(bucket.get(part)?.headers['content-encoding']).toBe('br');
      expect(bucket.get(part)?.headers['cache-control']).toContain('immutable');
      await store.put('index/b/x.json', new Uint8Array([4]), objectHeaders('index/b/x.json'));
      expect(await store.has(part)).toBe(true);
      expect(await store.has('assets/none')).toBe(false);
      expect(await store.get(part)).toEqual(new Uint8Array([1, 2, 3]));
      expect((await store.list('')).map(row => row.key).sort()).toEqual([part, 'index/b/x.json'].sort());
      await store.remove(part);
      expect(await store.get(part)).toBeUndefined();
      await expect(store.put('../up', new Uint8Array(1), objectHeaders('x'))).rejects.toThrow('Bad store key');
    } finally { await new Promise(resolve => { server.close(resolve); }); }
  });
});
