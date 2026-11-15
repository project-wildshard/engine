// PZ6 D2: a deployment-only signed preview release. The solo page never reads it.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {HeadObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {publishChannel} from '../server-release/publish.mjs';
import {COMMIT, releaseShards} from '../server-release/sign.mjs';
import {RELEASE_PUBLIC_KEY} from './flow.mjs';

const {values} = parseArgs({options: {build: {type: 'string'}}});
const build = values.build;
if (build === undefined || !COMMIT.test(build)) throw new Error('Preview needs --build=<full SHA>');
if (execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== build) throw new Error('Preview build must be HEAD');
const state = JSON.parse(readFileSync(`tmp/page-release/preview-${build}.json`, 'utf8'));
if (state.build?.build !== build || state.upload?.build !== build || state.upload?.channel !== 'preview'
  || typeof state.upload?.deployment?.id !== 'string') throw new Error('Preview must upload this page before signing');
const base = state.build.contentBase;
if (base !== undefined && (typeof base !== 'string' || !/^https:\/\/packs\.wildshard\.io\/content\/[0-9a-f]{16}\/$/u.test(base)
  || state.upload.content?.base !== base)) throw new Error('Preview content upload does not match the built page');
const need = (/** @type {string} */ name) => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') throw new Error(`Missing ${name}`);
  return value;
};
const account = need('R2_ACCOUNT_ID');
if (!/^[0-9a-f]{32}$/u.test(account)) throw new Error('Invalid R2_ACCOUNT_ID');
const privateKey = need('E7_RELEASE_SIGNING_KEY');
const publicKey = process.env.E7_RELEASE_PUBLIC_KEY?.trim() || RELEASE_PUBLIC_KEY;
const client = new S3Client({region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: {accessKeyId: need('R2_PACKS_ACCESS_KEY_ID'), secretAccessKey: need('R2_PACKS_SECRET_ACCESS_KEY')}});
const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8'));
try {
  const result = await publishChannel({client, bucket: 'wildshard-packs', privateKey, publicKey,
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
      if (base !== undefined) await client.send(new HeadObjectCommand({Bucket: 'wildshard-packs', Key: `${new URL(base).pathname.slice(1)}content.json`}));
      return null;
    },
  });
  if (result.release.engineBuild !== build) throw new Error('Preview publication is stale; alias stays unchanged');
  console.log(`preview ${result.status}: ${build} signed at serial ${result.release.serial}, no socket`);
} finally { client.destroy(); }
