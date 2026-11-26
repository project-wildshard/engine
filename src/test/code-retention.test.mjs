import { afterAll, expect, test } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { signCodeRetention } from '../scripts/code-retention.mjs';
import { CodeRetentionSchema, codeAvailability, retirementDeadline } from '../shared/host/codeRetention.ts';
import { readSignedCodeRetention, fetchCodeRetention } from '../client/host/online/codeRetention.ts';
import * as v from 'valibot';

const base = resolve('tmp/codex-pagesize'); mkdirSync(base, { recursive: true });
const root = mkdtempSync(resolve(base, 'retention-'));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const current = 'a'.repeat(40), older = 'b'.repeat(40), gone = 'c'.repeat(40);
const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({type: 'pkcs8', format: 'pem'}), publicKey = pair.publicKey.export({type: 'spki', format: 'der'}).toString('hex');
const expected = { channel: 'staging', engineBuild: current };
const graphs = [current, older].map(build => ({ build, files: [{ path: `b/${build}/entry.js`, bytes: 1 }], content: true }));
for (const graph of graphs) { const path = resolve(root, graph.files[0].path); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, 'x'); }
writeFileSync(resolve(root, 'version.json'), JSON.stringify({build: current}));
const manifest = () => writeFileSync(resolve(root, 'deploy-chunks.json'), JSON.stringify({format: 2, builds: graphs}));
manifest();
const produce = () => signCodeRetention({directory: root, channel: 'staging', privateKey, publicKey, now: 1000});

test('actual producer and WebCrypto reader agree on kept, excluded and unknown legacy code', async () => {
  const metadata = await readSignedCodeRetention(produce(), publicKey, expected);
  expect(metadata.keptBuilds).toEqual([current, older]);
  expect(codeAvailability(metadata, current)).toBe('kept');
  expect(codeAvailability(metadata, gone)).toBe('retired');
  expect(codeAvailability(null, current)).toBe('unknown');
  expect(codeAvailability(metadata, 'not-a-build')).toBe('unknown');
  expect(retirementDeadline(metadata)).toBeNull();
  expect(metadata.issuedAt).toBe(1000);
});

test('signature tampering, wrong channels, old release documents and another trust root refuse', async () => {
  const good = produce(), changed = JSON.parse(good);
  changed.body = changed.body.replace(older, gone);
  await expect(readSignedCodeRetention(JSON.stringify(changed), publicKey, expected)).rejects.toThrow('signature');
  await expect(readSignedCodeRetention(good, publicKey, {...expected, channel: 'production'})).rejects.toThrow('channel/build');
  await expect(readSignedCodeRetention(good, publicKey, {...expected, engineBuild: gone})).rejects.toThrow('channel/build');
  expect(() => signCodeRetention({directory: root, channel: 'staging', privateKey, publicKey: '00'})).toThrow('trust root');
});

test('retention is distinct, bounded at five, current included; a missing carried file is never signed', () => {
  const basic = JSON.parse(JSON.parse(produce()).body);
  for (const keptBuilds of [[], [older], [current,current], [current, older, gone, 'd'.repeat(40), 'e'.repeat(40), 'f'.repeat(40)]]) {
    expect(() => v.parse(CodeRetentionSchema, {...basic, keptBuilds})).toThrow();
  }
  const file = resolve(root, graphs[1].files[0].path); rmSync(file);
  try { expect(produce).toThrow(); } finally { writeFileSync(file, 'x'); }
});

test('only an explicitly authenticated publisher schedule supplies a deadline', async () => {
  const metadata = {...JSON.parse(JSON.parse(produce()).body), retireAt: 5000};
  const body = JSON.stringify(metadata), signature = sign(null, Buffer.from(body), pair.privateKey).toString('hex');
  const read = await readSignedCodeRetention(JSON.stringify({body,signature}), publicKey, expected);
  expect(retirementDeadline(read)).toBe(5000);
  expect(() => v.parse(CodeRetentionSchema, {...metadata, retireAt: -1})).toThrow();
  expect(retirementDeadline(null)).toBeNull();
});

test('a legacy 404 is unknown; no-store and redirect refusal protect the relative same-origin read', async () => {
  let request;
  expect(await fetchCodeRetention(publicKey, expected, async (...args) => {request=args; return new Response('', {status:404});})).toBeNull();
  expect(request[0]).toBe('/code-retention.json');
  expect(request[1]).toMatchObject({cache:'no-store',redirect:'error'});
  await expect(fetchCodeRetention(publicKey, expected, async () => new Response('<html>legacy fallback</html>'))).rejects.toThrow();
});
