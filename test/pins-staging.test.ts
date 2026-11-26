/* oxlint-disable import/no-nodejs-modules -- Exercise the pin CLI against a local API in an isolated checkout. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {expect, test} from 'vitest';
import {checkStaging, RELEASE_HASH_HEADER, type StagingPins} from '../src/scripts/pins-staging.ts';

const script = resolve('src/scripts/pins.ts'), selector = resolve('src/scripts/pins-staging.ts');
const prod = 'production sentinel';
const release = 'c'.repeat(64);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const execute = (cli: string, root: string, api: string, ...args: string[]): Promise<{code: number | null; output: string}> => new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {cwd: root, env: {...process.env, WILDSHARD_API: api}});
  let output = '';
  child.stdout.on('data', (bytes: Buffer) => {output += bytes.toString();});
  child.stderr.on('data', (bytes: Buffer) => {output += bytes.toString();});
  child.on('error', reject);
  child.on('close', code => {resolveResult({code, output});});
});

async function fixture(run: (root: string, api: string, requests: string[], document: StagingPins['catalogue'], live: {release: string | null}) => Promise<void>): Promise<void> {
  mkdirSync('tmp/codex-pins', {recursive: true});
  const root = mkdtempSync(resolve('tmp/codex-pins/staging-')), requests: string[] = [], live: {release: string | null} = {release};
  // A slug whose folder is its own name: the Template's `template` → `_template` alias went with its staging cell (meta TEMPLATE-E2E TR-9).
  const document = {shards: [{slug: 'open-plot-thin-ice', revision: 6, hash: 'a'.repeat(64)}], missing: [], placements: [{slug: 'open-plot-thin-ice'}], grid: {cells: [{slug: 'open-plot-thin-ice'}]}};
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    const body = request.url === '/api/catalogue.json?channel=staging' ? document : request.url === '/api/shardfiles' ? {shardfiles: [{hash: 'a'.repeat(64), bytes: 512}]} : undefined;
    const headers: Record<string, string> = {'content-type': 'application/json'};
    if (body === document && live.release !== null) headers[RELEASE_HASH_HEADER] = live.release;
    response.writeHead(body === undefined ? 404 : 200, headers).end(JSON.stringify(body ?? {}));
  });
  try {
    mkdirSync(join(root, 'test/pins'), {recursive: true});
    writeFileSync(join(root, 'test/pins/shardfiles.json'), prod);
    writeFileSync(join(root, 'test/pins/catalogue.json'), prod);
    await new Promise<void>(ready => {server.listen(0, '127.0.0.1', ready);});
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No test port');
    await run(root, `http://127.0.0.1:${address.port}`, requests, document, live);
  } finally {await new Promise<void>(done => {server.close(() => {done();});}); rmSync(root, {recursive: true, force: true});}
}

test('refresh pins staging-only revisions, leaves production alone, and both rings select the exact snapshot', async () => fixture(async (root, api, requests, document) => {
  const refreshed = await execute(script, root, api, 'refresh', '--channel', 'staging');
  expect(refreshed.code, refreshed.output).toBe(0);
  expect(requests.sort()).toEqual(['/api/catalogue.json?channel=staging', '/api/shardfiles']);
  expect(readFileSync(join(root, 'test/pins/shardfiles.json'), 'utf8')).toBe(prod);
  expect(readFileSync(join(root, 'test/pins/catalogue.json'), 'utf8')).toBe(prod);
  const snapshot = JSON.parse(readFileSync(join(root, 'test/pins/staging.json'), 'utf8')) as StagingPins;
  expect(snapshot.shards).toEqual([{...document.shards[0], bytes: 512}]);
  expect(snapshot.releaseHash).toBe(release);
  expect(snapshot.catalogueHash).toBe(digest(document));
  const selected = await execute(selector, root, api, 'select');
  expect(selected.code, selected.output).toBe(0);
  expect(JSON.parse(readFileSync(join(root, 'test/pins/catalogue.json'), 'utf8'))).toEqual(document);
  expect(JSON.parse(readFileSync(join(root, 'test/pins/shardfiles.json'), 'utf8'))).toEqual({api, shards: snapshot.shards});
}), 15_000);

test('an incomplete refresh and a tampered snapshot refuse before replacing existing inputs', async () => fixture(async (root, api, _requests, document) => {
  await execute(script, root, api, 'refresh', '--channel', 'staging');
  const path = join(root, 'test/pins/staging.json'), before = readFileSync(path, 'utf8');
  const head = document.shards[0];
  if (head === undefined) throw new Error('Missing fixture head');
  head.hash = 'b'.repeat(64); // Listing has no bytes for this head.
  const refused = await execute(script, root, api, 'refresh', '--channel', 'staging');
  expect(refused.code).not.toBe(0);
  expect(readFileSync(path, 'utf8')).toBe(before);
  const changed = JSON.parse(before) as StagingPins;
  const changedHead = changed.catalogue.shards[0];
  if (changedHead === undefined) throw new Error('Missing exported head');
  changedHead.revision++;
  writeFileSync(path, JSON.stringify(changed));
  expect((await execute(selector, root, api, 'select')).code).not.toBe(0);
  expect(readFileSync(join(root, 'test/pins/shardfiles.json'), 'utf8')).toBe(prod);
}), 15_000);

test('verify passes while the live release is the snapshot\'s and refuses drift; refresh refuses a catalogue with no release hash', async () => fixture(async (root, api, _requests, _document, live) => {
  expect((await execute(script, root, api, 'refresh', '--channel', 'staging')).code).toBe(0);
  const matched = await execute(selector, root, api, 'verify');
  expect(matched.code, matched.output).toBe(0);
  live.release = 'd'.repeat(64);
  const drifted = await execute(selector, root, api, 'verify');
  expect(drifted.code).not.toBe(0);
  expect(drifted.output).toContain('staging release drifted');
  const path = join(root, 'test/pins/staging.json'), before = readFileSync(path, 'utf8');
  live.release = null;
  const unnamed = await execute(script, root, api, 'refresh', '--channel', 'staging');
  expect(unnamed.code).not.toBe(0);
  expect(unnamed.output).toContain(RELEASE_HASH_HEADER);
  expect(readFileSync(path, 'utf8')).toBe(before);
}), 15_000);

test('the committed staging export is complete and internally consistent', () => {
  const snapshot = JSON.parse(readFileSync('test/pins/staging.json', 'utf8')) as StagingPins;
  expect(() => {checkStaging(snapshot);}).not.toThrow();
  expect(snapshot.releaseHash).toMatch(/^[a-f0-9]{64}$/u);
});
