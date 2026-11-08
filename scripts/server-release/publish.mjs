// One CAS-protected signed object per channel in wildshard-packs. No VPS access.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import * as v from 'valibot';
import { bundleDescriptor, COMMIT, publication, readPublication, releasePublicKey, releaseShards, signRelease } from './sign.mjs';

/** @typedef {import('../../src/shared/host/releaseRows.ts').ReleaseFile} ReleaseFile */
/** @typedef {{client: S3Client, bucket: string, candidate: ReleaseFile, privateKey: string, publicKey: string, isAncestor: (older: string, newer: string) => boolean}} PublishOptions */

/** Older completed CI must never replace a newer green commit. Repeated bytes are a no-op.
 * @param {PublishOptions} options @returns {Promise<{status: string, release: ReleaseFile, signed: string}>} */
export async function publishChannel(options) {
  const { client, bucket, privateKey, publicKey, isAncestor: ancestor } = options, candidate = publication(options.candidate), key = `releases/${candidate.channel}.json`;
  if (releasePublicKey(privateKey) !== publicKey.toLowerCase()) throw new Error('Signing key does not match E7_RELEASE_PUBLIC_KEY');
  for (let attempt = 0; attempt < 3; attempt++) {
    /** @type {{release: ReleaseFile, signed: string, etag: string} | null} */
    let previous = null;
    try {
      const held = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (held.Body === undefined || held.ETag === undefined) throw new Error('A channel object has no body or ETag');
      const signed = await held.Body.transformToString(), release = readPublication(signed, publicKey);
      if (release.channel !== candidate.channel) throw new Error('Stored release channel mismatch');
      previous = { release, signed, etag: held.ETag };
    } catch (error) { if (!(error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404))) throw error; }
    const prior = previous?.release;
    if (previous !== null && prior !== undefined) {
      if (prior.engineBuild !== candidate.engineBuild && !ancestor(prior.engineBuild, candidate.engineBuild)) {
        if (ancestor(candidate.engineBuild, prior.engineBuild)) return { status: 'stale', release: prior, signed: previous.signed };
        throw new Error('A channel cannot move to unrelated history');
      }
      if (prior.engineBuild === candidate.engineBuild && prior.bundle?.sha256 !== candidate.bundle?.sha256) throw new Error('The same engine build has different bundle bytes');
      if (JSON.stringify({ ...candidate, serial: prior.serial }) === JSON.stringify(prior)) return { status: 'unchanged', release: prior, signed: previous.signed };
      if (candidate.saveEpoch < prior.saveEpoch) throw new Error('A channel cannot lower its save epoch');
    }
    const release = publication({ ...candidate, serial: (prior?.serial ?? 0) + 1 }), signed = signRelease(release, privateKey);
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: signed, ContentType: 'application/json', CacheControl: 'no-store',
        ...(previous === null ? { IfNoneMatch: '*' } : { IfMatch: previous.etag }) }));
      return { status: 'published', release, signed };
    } catch (error) { if (!(error instanceof S3ServiceException && [409, 412].includes(error.$metadata.httpStatusCode ?? 0))) throw error; }
  }
  throw new Error('Channel changed concurrently; rerun publication');
}

/** @param {string} name @returns {string} */
const need = name => { const value = process.env[name]; if (value === undefined || value.trim() === '') throw new Error(`Missing ${name}`); return value; };
/** @param {string} older @param {string} newer @returns {boolean} */
function isAncestor(older, newer) {
  if (!COMMIT.test(older) || !COMMIT.test(newer)) throw new Error('Channel build is not a full commit SHA');
  const result = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { stdio: 'ignore' });
  if (result.status !== 0 && result.status !== 1) throw new Error('Cannot read channel commit history');
  return result.status === 0;
}

/** CLI runs only after CI has uploaded the exact immutable asset. @returns {Promise<void>} */
async function main() {
  const { values } = parseArgs({ options: { channel: { type: 'string' }, build: { type: 'string' }, tag: { type: 'string' }, bundle: { type: 'string' }, out: { type: 'string' }, check: { type: 'boolean', default: false } } });
  if (values.bundle === undefined || values.tag === undefined || values.out === undefined) throw new Error('Expected --bundle, --tag and --out');
  const privateKey = need('E7_RELEASE_SIGNING_KEY'), publicKey = need('E7_RELEASE_PUBLIC_KEY'), account = need('R2_ACCOUNT_ID'), bucket = need('R2_BUCKET_PACKS');
  const credentials = { accessKeyId: need('R2_PACKS_ACCESS_KEY_ID'), secretAccessKey: need('R2_PACKS_SECRET_ACCESS_KEY') };
  if (!/^[0-9a-f]{32}$/u.test(account)) throw new Error('Invalid R2_ACCOUNT_ID');
  if (bucket !== 'wildshard-packs') throw new Error('R2_BUCKET_PACKS must be wildshard-packs (C26)');
  const epoch = v.parse(v.object({ saveEpoch: v.pipe(v.number(), v.integer(), v.minValue(1)) }), JSON.parse(readFileSync('save-epoch.json', 'utf8'))).saveEpoch;
  const shardNames = process.env.E7_SERVER_SHARDS?.trim();
  const candidate = publication({ channel: values.channel, serial: 1, engineBuild: values.build, saveEpoch: epoch,
    shards: releaseShards(JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')), shardNames === undefined || shardNames === '' ? 'driftwood-isle,nalati-grasslands' : shardNames),
    bundle: bundleDescriptor(values.bundle, values.tag), socket: need('E7_RELEASE_SOCKET') });
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== candidate.engineBuild) throw new Error('Publication is not the checked-out build');
  if (releasePublicKey(privateKey) !== publicKey.toLowerCase()) throw new Error('Signing key does not match E7_RELEASE_PUBLIC_KEY');
  if (values.check) { console.log('Server release configuration admitted'); return; }
  const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials });
  try {
    const result = await publishChannel({ client, bucket, candidate, privateKey, publicKey, isAncestor });
    writeFileSync(values.out, `${result.signed}\n`);
    console.log(JSON.stringify({ status: result.status, channel: result.release.channel, serial: result.release.serial, engineBuild: result.release.engineBuild, object: `releases/${result.release.channel}.json` }));
  } finally { client.destroy(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Server release publication failed'); process.exitCode = 1; }
}
