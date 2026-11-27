// oxlint-disable-next-line import/no-nodejs-modules -- Real request signing for the R2 store stub.
import {createHash, createHmac} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A stub of R2 and a host network endpoint.
import {createServer} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {writeTar} from '@wildshard/format/tar';
import {createCookWorker, indexKey, objectHeaders, runJob, type JobLauncher} from '../src/cook/game/cookWorker';
import {validateShardfileFolder} from '@wildshard/format/shardfileValidation';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {admission, runCookJob, ShardfileRefusedError} from '../src/cook/game/cookJob';
import {folderStore, r2Store} from '../src/cook/game/packStore';
import {hashOf, rawTar, slug, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. */
// Hostile archives, job limits and the R2 store. Real cooks are in cook-worker.test.ts and cook-worker-publish*.test.ts.
const pack = (files: ReadonlyMap<string, Uint8Array>): Uint8Array => writeTar(files);

describe('the cook worker', () => {
  const h = useCookHarness();

  const tampered = (change: (rows: Map<string, Uint8Array>) => void): Uint8Array => { const rows = new Map(h.files); change(rows); return pack(rows); };
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
    const bytes = make(), hash = hashOf(bytes), cook = h.worker(new Map([[hash, bytes]]), 'b-hostile', 'hostile-store');
    const row = await cook.cook({slug, hash});
    expect(row.state, `${name}: ${row.detail ?? ''}`).toBe('refused');
    expect(await folderStore(join(h.scratch, 'hostile-store')).has(indexKey('b-hostile', hash))).toBe(false);
  }, 60_000);

  it('takes a failed simulation proof as a refusal: another try walks the same lanes', async () => {
    const ports = {check: (shard: Parameters<typeof checkShardfile>[0], assets: ReadonlyMap<string, Uint8Array>) => checkShardfile(shard, assets, {validate: () => Promise.reject(new Error('Blocked edge entry north lane 1'))}), wireBytes: (): number => 0, now: (): number => 0};
    await expect(runCookJob(h.real, join(h.scratch, 'unproved'), ports)).rejects.toThrow(ShardfileRefusedError);
  }, 60_000);

  it.each(['budget', 'entry'] as const)('keeps the shared %s refusal unchanged before any pack is published', async failure => {
    const product = validateShardfileFolder({read: path => {const value = h.files.get(path); if (value === undefined) throw new Error(path); return value;}, paths: () => h.files.keys()}, admission());
    const message = `Blocked portal route: ${'edge detail '.repeat(200)}`;
    const validate = failure === 'entry' ? (): Promise<never> => Promise.reject(new Error(message))
      : () => Promise.resolve({ticks: 240, lanes: 4, steps: 16, scripts: {p95Micros: 1e9, maxMicros: 1e9, samples: 180}, fuel: {p95: 10, max: 20, samples: 240}});
    const check = (shard: typeof product.shard, assets: ReadonlyMap<string, Uint8Array>) => checkShardfile(shard, assets, {validate});
    const author = await check(product.shard, product.assets);
    expect(author.pass).toBe(false);
    try {
      await runCookJob(h.real, join(h.scratch, `refused-${failure}`), {check, wireBytes: () => 0, now: () => 0});
      throw new Error('The cook admitted a refused shard');
    } catch (error) {
      expect(error).toBeInstanceOf(ShardfileRefusedError);
      expect((error as ShardfileRefusedError).report).toEqual(author);
      expect((error as Error).message).toEqual(author.failures.map(row => row.message).join('\n'));
    }
  });

  it('refuses a shardfile for another slug: a notice cannot put bytes on a shard', async () => {
    const hash = hashOf(h.real), cook = createCookWorker({build: 'b3', store: folderStore(join(h.scratch, 'other')), source: h.source(new Map([[hash, h.real]])), launcher: h.launcher(), serverPacks: join(h.scratch, 'server-other'), scratch: join(h.scratch, 'work')});
    expect(await cook.cook({slug: 'pine-hollow', hash})).toMatchObject({state: 'refused', detail: 'A shardfile for sunscar-dunes under pine-hollow'});
    expect(await folderStore(join(h.scratch, 'other')).has(indexKey('b3', hash))).toBe(false);
  }, 60_000);

  const job = (name: string, text: string, limits: Partial<JobLauncher['limits']> = {}, wrap: readonly string[] = [], reportPhases?: (phases: string) => void): ReturnType<typeof runJob> => {
    const work = join(mkdtempSync(join(h.scratch, 'limit-')), 'job'), script = join(work, name);
    mkdirSync(work);
    writeFileSync(script, text);
    return runJob({...h.launcher(script, limits), wrap}, join(work, 'x.tar'), join(work, 'out'), undefined, reportPhases);
  };

  it('keeps a complete refusal beyond the diagnostic capture cap', async () => {
    const outcome = await job('report.mjs', `import {writeFileSync} from 'node:fs'; const detail = 'entry '.repeat(400000); writeFileSync(process.argv[3] + '.result.json', JSON.stringify({refused: detail})); console.log('diagnostic'); process.exit(3);`);
    expect(outcome).toEqual({kind: 'refused', reason: 'entry '.repeat(400000)});
  }, 30_000);

  it('kills a job past its clock', async () => {
    const phases: string[] = [];
    const script = `import {writeSync} from 'node:fs';
      writeSync(1, 'phase validation 0ms\\nuncharted contents\\nphase textures 125ms\\n');
      for (;;) { /* a bomb the cook never ended */ }`;
    const outcome = await job('hang.mjs', script, {seconds: 2}, [], line => {phases.push(line);});
    expect(outcome).toEqual({kind: 'killed', reason: 'past 2 s'});
    expect(phases).toEqual(['validation@0ms, textures@125ms']);
  }, 30_000);

  it('kills a job past its resident memory', async () => {
    const outcome = await job('grow.mjs', 'const held = []; for (;;) { held.push(Buffer.alloc(32e6, 1)); await new Promise(done => setTimeout(done, 5)); }', {memoryMB: 400});
    expect(outcome).toEqual({kind: 'killed', reason: 'past 400 MB resident'});
  }, 30_000);

  it('reports a crash as a failure of that job alone', async () => {
    // A h.real SIGABRT, but no core: under `ulimit -c unlimited` this one line wrote 6.5 GB to /cores on every run.
    // The service sets LimitCORE=0 (wildshard-cook in src/scripts/vps/rebuild.sh), so only this test needs the wrap.
    const outcome = await job('crash.mjs', 'process.abort();', {}, ['sh', '-c', 'ulimit -c 0; exec "$@"', 'sh']);
    expect(outcome.kind).toBe('killed');
  }, 30_000);

  it('gives a job no files outside its folder, no children and no credentials', async () => {
    process.env['R2_PACKS_SECRET_ACCESS_KEY'] = 'hunter2';
    process.env['COOK_SIGNING_KEY'] = 'fixture-parent-signing-key-not-for-child';
    const outcome = await job('probe.mjs', `import {readFileSync, writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process'; import {homedir} from 'node:os';
      const denied = run => { try { run(); return false; } catch (error) { return error.code === 'ERR_ACCESS_DENIED'; } };
      console.log(JSON.stringify({refused: JSON.stringify({home: denied(() => readFileSync(homedir() + '/.ssh/config')), hosts: denied(() => readFileSync('/etc/hosts')), write: denied(() => writeFileSync('/tmp/cook-escape', 'x')), child: denied(() => spawnSync('/bin/ls')), secret: process.env.R2_PACKS_SECRET_ACCESS_KEY ?? null, cookKey: process.env.COOK_SIGNING_KEY ?? null, token: process.env.HOME ?? null})}));
      process.exit(3);`);
    delete process.env['R2_PACKS_SECRET_ACCESS_KEY'];
    delete process.env['COOK_SIGNING_KEY'];
    expect(outcome.kind).toBe('refused');
    expect(JSON.parse(outcome.kind === 'refused' ? outcome.reason : '{}')).toEqual({home: true, hosts: true, write: true, child: true, secret: null, cookKey: null, token: null});
  }, 30_000);

  // QA 11-25 row 57: this test failed on CI only on runners whose image caches Node 26 (setup-node resolves engines
  // `<27` to whichever major the image holds: run 45731753083 gave tests (4) 26.13.1 and the rest 24.22.3). From Node 25,
  // `--permission` also denies the network unless `--allow-net` is given, so the open arm itself was refused
  // (`false ERR_ACCESS_DENIED`). A real cook job keeps that denial. Here both arms grant `--allow-net` where Node has it,
  // so the open arm reaches the host and the shut arm proves the OS wrap alone. A miss prints a `row57` line.
  it('takes a job off the network through the host wrap', {timeout: 30_000}, async () => {
    const work = join(mkdtempSync(join(h.scratch, 'limit-')), 'job'), script = join(work, 'net.mjs');
    mkdirSync(work);
    let reached = 0;
    const network = createServer((_request, response) => { reached++; response.end('reachable'); });
    await new Promise<void>(resolve => { network.listen(0, '127.0.0.1', resolve); });
    const address = network.address();
    if (address === null || typeof address === 'string') throw new Error('Missing host network address');
    writeFileSync(script, `let reached = false, why = 'not ok'; try { const response = await fetch('http://127.0.0.1:${address.port}', {signal: AbortSignal.timeout(4000)}); reached = response.ok; } catch (error) { why = String(error?.cause?.code ?? error?.name); } (await import('node:fs')).writeFileSync(process.argv[3] + '.result.json', JSON.stringify({refused: reached ? 'true' : 'false ' + why})); process.exit(3);`);
    // Same OS namespace boundary as the installed author proof. Linux's
    // runner can create it with sudo, then drops back to the original uid/gid.
    // Neither arm mocks sockets, fetch or the h.real process permission flags.
    const wrap = process.platform === 'darwin'
      ? ['sandbox-exec', '-p', '(version 1)(allow default)(deny network*)']
      : process.platform === 'linux' && process.getuid !== undefined && process.getgid !== undefined
        ? ['sudo', '-n', 'unshare', '--net', '--', 'setpriv', `--reuid=${process.getuid()}`, `--regid=${process.getgid()}`, '--init-groups', '--reset-env']
        : undefined;
    try {
      if (wrap === undefined) throw new Error('Cook network proof requires an actual OS network boundary');
      // Node 25+ denies the network under --permission by itself: grant it, so only the wrap can take it away.
      const allowNet = process.allowedNodeEnvironmentFlags.has('--allow-net') ? ['sh', '-c', 'exec "$0" --allow-net "$@"'] : [];
      const open = await runJob({...h.launcher(script), wrap: allowNet}, join(work, 'x.tar'), join(work, 'open')), openReached = reached;
      const shut = await runJob({...h.launcher(script), wrap: [...wrap, ...allowNet]}, join(work, 'x.tar'), join(work, 'shut'));
      if (!(open.kind === 'refused' && open.reason === 'true' && openReached === 1 && shut.kind === 'refused' && shut.reason.startsWith('false ') && reached === 1))
        console.error(JSON.stringify({row57: {open, openReached, shut, reached}}).slice(0, 4000));
      expect(open).toEqual({kind: 'refused', reason: 'true'});
      expect(openReached).toBe(1);
      expect(shut).toMatchObject({kind: 'refused', reason: expect.stringMatching(/^false /)});
      expect(reached, 'the isolated child cannot reach the proven live host endpoint').toBe(1);
    } finally { await new Promise<void>(resolve => { network.close(() => { resolve(); }); }); }
  });

});

describe('the R2 store', () => {
  it('retries the same cooked object when R2 temporarily refuses its PUT', async () => {
    const requests: {readonly url: string; readonly bytes: number[]}[] = [];
    const send: typeof fetch = async (input, init) => {
      requests.push({url: String(input), bytes: [...new Uint8Array(await new Response(init?.body ?? null).arrayBuffer())]});
      return new Response(null, {status: requests.length === 1 ? 503 : 200});
    };
    const store = r2Store({endpoint: 'https://r2.invalid', bucket: 'packs', accessKeyId: 'key', secretAccessKey: 'secret', fetch: send});
    const key = 'assets/spawn/pine-hollow-entry-phone-test.json';
    await store.put(key, new Uint8Array([1, 2, 3]), objectHeaders(key));
    const expected = {url: `https://r2.invalid/packs/${key}`, bytes: [1, 2, 3]};
    expect(requests).toEqual([expected, expected]);
  });

  it('fails permanent PUT refusals immediately and bounds transient retries', async () => {
    const key = 'assets/spawn/test.json';
    const put = async (status: number, attempts: number): Promise<void> => {
      let calls = 0;
      const send: typeof fetch = async () => { calls++; return new Response(null, {status}); };
      const store = r2Store({endpoint: 'https://r2.invalid', bucket: 'packs', accessKeyId: 'key', secretAccessKey: 'secret', fetch: send});
      await expect(store.put(key, new Uint8Array([1]), objectHeaders(key))).rejects.toThrow(`R2 PUT ${key} answered ${status}`);
      expect(calls).toBe(attempts);
    };
    await put(403, 1);
    await put(503, 3);
  });

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
