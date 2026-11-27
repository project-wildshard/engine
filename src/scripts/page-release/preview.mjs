// PZ6 D2: a deployment-only signed preview release. The solo page never reads it.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import * as v from 'valibot';
import {HeadObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {publishChannel, RELEASE_BUCKET} from '../server-release/publish.mjs';
import {COMMIT, releaseShards} from '../server-release/sign.mjs';
import {pinnedReleaseKey} from './flow.mjs';

const UploadState = v.object({
  build: v.object({build: v.string(), contentBase: v.optional(v.string())}),
  upload: v.object({build: v.string(), channel: v.literal('preview'),
    deployment: v.object({id: v.pipe(v.string(), v.minLength(1))}), content: v.optional(v.object({base: v.string()}))}),
});

/** Validate the completed page upload before granting the signer any work.
 * @param {unknown} state @param {string} build @param {boolean} onMain @returns {string|undefined} */
export function previewUpload(state, build, onMain) {
  if (!COMMIT.test(build) || !onMain) throw new Error('Preview build must be a full commit on origin/main');
  const row = v.parse(UploadState, state);
  if (row.build.build !== build || row.upload.build !== build) throw new Error('Preview must upload this page before signing');
  const base = row.build.contentBase;
  if (base !== undefined && (!/^https:\/\/packs\.wildshard\.io\/content\/[0-9a-f]{16}\/$/u.test(base)
    || row.upload.content?.base !== base)) throw new Error('Preview content upload does not match the built page');
  return base;
}

async function main() {
const {values} = parseArgs({options: {build: {type: 'string'}}});
const build = values.build;
if (build === undefined || !COMMIT.test(build)) throw new Error('Preview needs --build=<full SHA>');
if (execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== build) throw new Error('Preview build must be HEAD');
const onMain = spawnSync('git', ['merge-base', '--is-ancestor', build, 'origin/main'], {stdio: 'ignore'}).status === 0;
const base = previewUpload(JSON.parse(readFileSync(`tmp/page-release/preview-${build}.json`, 'utf8')), build, onMain);
const need = (/** @type {string} */ name) => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
};
const account = need('R2_ACCOUNT_ID');
if (!/^[0-9a-f]{32}$/u.test(account)) throw new Error('Invalid R2_ACCOUNT_ID');
const privateKey = need('E7_RELEASE_SIGNING_KEY');
const publicKey = pinnedReleaseKey(process.env.E7_RELEASE_PUBLIC_KEY);
const endpoint = `https://${account}.r2.cloudflarestorage.com`;
const packs = base === undefined ? undefined : new S3Client({region: 'auto', endpoint,
  credentials: {accessKeyId: need('R2_PACKS_ACCESS_KEY_ID'), secretAccessKey: need('R2_PACKS_SECRET_ACCESS_KEY')}});
const client = new S3Client({region: 'auto', endpoint,
  credentials: {accessKeyId: need('R2_RELEASES_ACCESS_KEY_ID'), secretAccessKey: need('R2_RELEASES_SECRET_ACCESS_KEY')}});
const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8'));
try {
  const result = await publishChannel({client, bucket: RELEASE_BUCKET, privateKey, publicKey,
    candidate: {channel: 'preview', serial: 1, engineBuild: build,
      saveEpoch: JSON.parse(readFileSync('save-epoch.json', 'utf8')).saveEpoch,
      shards: releaseShards(pins, pins.shards.map((/** @type {{slug: string}} */ row) => row.slug).join(','))},
    isAncestor: (older, newer) => {
      const check = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], {stdio: 'ignore'});
      if (check.status !== 0 && check.status !== 1) throw new Error('Cannot read preview commit history');
      return check.status === 0;
    },
    packsReady: async () => {
      // The index is the publisher's completion marker, written after every content file is verified.
      if (packs !== undefined && base !== undefined) await packs.send(new HeadObjectCommand({Bucket: 'wildshard-packs', Key: `${new URL(base).pathname.slice(1)}content.json`}));
      return null;
    },
  });
  if (!['published', 'unchanged'].includes(result.status) || result.release.engineBuild !== build) throw new Error('Preview publication is stale; alias stays unchanged');
  console.log(`preview ${result.status}: ${build} signed at serial ${result.release.serial}, no socket`);
} finally { client.destroy(); packs?.destroy(); }

}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Preview publication failed'); process.exitCode = 1; }
}
