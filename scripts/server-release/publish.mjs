// One CAS-protected signed object per channel in wildshard-packs. No VPS access.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import * as v from 'valibot';
import { readServerPackBook, serverPackBookPath } from '../../src/shared/game/shardfile/serverPack.ts';
import { bundleDescriptor, COMMIT, publication, readPublication, releasePublicKey, releaseShards, signRelease } from './sign.mjs';

/** @typedef {import('../../src/shared/host/releaseRows.ts').ReleaseFile} ReleaseFile */
/** @typedef {{client: S3Client, bucket: string, candidate: ReleaseFile, privateKey: string, publicKey: string, isAncestor: (older: string, newer: string) => boolean,
 *   packsReady: (release: ReleaseFile) => Promise<string | null>, align?: boolean}} PublishOptions */

/** @param {unknown} error @returns {boolean} */
const missing = error => error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.name === 'NotFound' || error.$metadata.httpStatusCode === 404);

/** Every channel's order (J234, Jake 2026-11-10: "we never switch a build whose files aren't uploaded"): packs first, the signed
 *  file last. The server preloads the
 *  named build's book and parts before its grace and stays on its old build while they are missing, so a file naming a build with
 *  no book strands every check behind it. Null when the book and every part the release's shards and grid need are in the bucket.
 * @param {S3Client} client @param {string} bucket @param {ReleaseFile} release @returns {Promise<string | null>} */
export async function serverPacksReady(client, bucket, release) {
  const key = serverPackBookPath(release.engineBuild);
  let text;
  try { text = await (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body?.transformToString(); }
  catch (error) { if (missing(error)) return `no server book at ${key}`; throw error; }
  if (text === undefined) return `empty server book at ${key}`;
  const book = readServerPackBook(JSON.parse(text));
  if (book.build !== release.engineBuild) return `${key} names build ${book.build}`;
  /** @type {Set<string>} */
  const parts = new Set();
  for (const row of release.shards) {
    const pack = book.shards[row.slug];
    if (pack === undefined) return `${key} has no ${row.slug}`;
    for (const part of [pack, ...pack.more ?? []]) parts.add(part.url.slice(1));
  }
  if (book.grid !== undefined) for (const part of [book.grid, ...book.grid.more ?? []]) parts.add(part.url.slice(1));
  for (const part of parts) {
    try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: part })); }
    catch (error) { if (missing(error)) return `no server part at ${part}`; throw error; }
  }
  return null;
}

/** Fix forward only (J179, J234): no publication moves a channel to an older build. Older completed CI is `stale`; a staging
 *  alignment that names one is refused. Repeated bytes are a no-op. A candidate whose packs are not published leaves the channel
 *  as it is (`held`), on every channel.
 * @param {PublishOptions} options @returns {Promise<{status: string, release: ReleaseFile, signed: string, reason?: string}>} */
export async function publishChannel(options) {
  const { client, bucket, privateKey, publicKey, isAncestor: ancestor } = options, candidate = publication(options.candidate), key = `releases/${candidate.channel}.json`;
  if (releasePublicKey(privateKey) !== publicKey.toLowerCase()) throw new Error('Signing key does not match E7_RELEASE_PUBLIC_KEY');
  if (options.align === true && candidate.channel !== 'staging') throw new Error('Only staging can be aligned');
  if (typeof options.packsReady !== 'function') throw new Error('Every channel needs the packs gate (J234)');
  /** @type {string | null | undefined} */
  let blocked;
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
        if (!ancestor(candidate.engineBuild, prior.engineBuild)) throw new Error('A channel cannot move to unrelated history');
        // J234: the one rollback (staging serial 65, 2026-11-10) was allowed once; a person who names an older build is told no.
        if (options.align === true) throw new Error(`Staging alignment is forward-only: ${candidate.engineBuild} is older than the live ${prior.engineBuild}`);
        return { status: 'stale', release: prior, signed: previous.signed };
      }
      if (prior.engineBuild === candidate.engineBuild && prior.bundle?.sha256 !== candidate.bundle?.sha256) throw new Error('The same engine build has different bundle bytes');
      if (JSON.stringify({ ...candidate, serial: prior.serial }) === JSON.stringify(prior)) return { status: 'unchanged', release: prior, signed: previous.signed };
      if (candidate.saveEpoch < prior.saveEpoch) throw new Error('A channel cannot lower its save epoch');
    }
    blocked ??= await options.packsReady(candidate);
    if (blocked !== null) return { status: 'held', release: prior ?? candidate, signed: previous?.signed ?? '', reason: blocked };
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
  const { values } = parseArgs({ options: { channel: { type: 'string' }, build: { type: 'string' }, tag: { type: 'string' }, bundle: { type: 'string' }, out: { type: 'string' }, check: { type: 'boolean', default: false },
    align: { type: 'boolean', default: false } } });
  // J234: this publisher runs from main's checkout for every source, so its gate and fix-forward rules apply even to an older build.
  // The build's epoch and pins are read from that commit; the workflow builds its bundle in its own tree and checks the tag's asset.
  // `--align` (staging only) is a person naming a build, never older than the live one.
  const align = values.align, head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (values.build === undefined || !COMMIT.test(values.build) || !isAncestor(values.build, head)) throw new Error('The build must be a full commit on the checked-out main');
  if (align && values.channel !== 'staging') throw new Error('--align is staging only');
  /** @param {string} path @returns {string} */
  const sourceFile = path => execFileSync('git', ['show', `${values.build ?? ''}:${path}`], { encoding: 'utf8' });
  if (values.bundle === undefined || values.tag === undefined || values.out === undefined) throw new Error('Expected --bundle, --tag and --out');
  const privateKey = need('E7_RELEASE_SIGNING_KEY'), publicKey = need('E7_RELEASE_PUBLIC_KEY'), account = need('R2_ACCOUNT_ID'), bucket = need('R2_BUCKET_PACKS');
  const credentials = { accessKeyId: need('R2_PACKS_ACCESS_KEY_ID'), secretAccessKey: need('R2_PACKS_SECRET_ACCESS_KEY') };
  if (!/^[0-9a-f]{32}$/u.test(account)) throw new Error('Invalid R2_ACCOUNT_ID');
  if (bucket !== 'wildshard-packs') throw new Error('R2_BUCKET_PACKS must be wildshard-packs (C26)');
  const epoch = v.parse(v.object({ saveEpoch: v.pipe(v.number(), v.integer(), v.minValue(1)) }), JSON.parse(sourceFile('save-epoch.json'))).saveEpoch;
  const shardNames = process.env.E7_SERVER_SHARDS?.trim();
  const candidate = publication({ channel: values.channel, serial: 1, engineBuild: values.build, saveEpoch: epoch,
    shards: releaseShards(JSON.parse(sourceFile('test/pins/shardfiles.json')), shardNames === undefined || shardNames === '' ? 'driftwood-isle,nalati-grasslands' : shardNames),
    bundle: bundleDescriptor(values.bundle, values.tag), socket: need('E7_RELEASE_SOCKET') });
  if (releasePublicKey(privateKey) !== publicKey.toLowerCase()) throw new Error('Signing key does not match E7_RELEASE_PUBLIC_KEY');
  if (values.check) { console.log('Server release configuration admitted'); return; }
  const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials });
  try {
    const packsReady = (/** @type {ReleaseFile} */ release) => serverPacksReady(client, bucket, release);
    const result = await publishChannel({ client, bucket, candidate, privateKey, publicKey, isAncestor, align, packsReady });
    writeFileSync(values.out, `${result.signed}\n`);
    console.log(JSON.stringify({ status: result.status, channel: result.release.channel, serial: result.release.serial, engineBuild: result.release.engineBuild, object: `releases/${result.release.channel}.json`,
      ...result.reason === undefined ? {} : { held: candidate.engineBuild, reason: result.reason } }));
    if (result.status === 'held') {
      const next = candidate.channel === 'production' ? "re-run this tag's server-release run" : `run server-release with build=${candidate.engineBuild}`;
      console.log(`::notice title=${candidate.channel} held::${candidate.engineBuild.slice(0, 7)} is not signed: ${result.reason ?? ''}. Publish its packs, then ${next}.`);
    }
  } finally { client.destroy(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Server release publication failed'); process.exitCode = 1; }
}
