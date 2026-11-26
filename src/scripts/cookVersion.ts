import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cookHash } from './cookHash.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const LOCK = 'src/cook/game/cook-version.json';
const DIGEST = /^[a-f0-9]{64}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

export interface CookVersion {
  readonly cookVersion: string;
  readonly cookHash: string;
  readonly formatVersion: string;
  readonly goldenDigest: string;
  readonly sameOutputFrom?: string;
}

function readVersion(text: string): CookVersion {
  const row = JSON.parse(text) as Partial<CookVersion>;
  if (typeof row.cookVersion !== 'string' || !VERSION.test(row.cookVersion)
    || typeof row.cookHash !== 'string' || !DIGEST.test(row.cookHash)
    || typeof row.goldenDigest !== 'string' || !DIGEST.test(row.goldenDigest)
    || typeof row.formatVersion !== 'string' || row.formatVersion === ''
    || row.sameOutputFrom !== undefined && (!DIGEST.test(row.sameOutputFrom) || row.sameOutputFrom === row.cookHash)) {
    throw new Error('Invalid cook-version.json');
  }
  return { cookVersion: row.cookVersion, cookHash: row.cookHash, formatVersion: row.formatVersion, goldenDigest: row.goldenDigest,
    ...(row.sameOutputFrom === undefined ? {} : {sameOutputFrom: row.sameOutputFrom}) };
}

function newer(version: string, previous: string): boolean {
  const before = previous.split('.');
  const difference = version.split('.').map((value, index) => BigInt(value) - BigInt(before[index] ?? '0')).find(delta => delta !== 0n);
  return difference !== undefined && difference > 0n;
}

/** Validate the record and require a fresh golden cook for every same-output declaration. */
export async function checkCookVersion(current: CookVersion, actual: Readonly<{cookHash: string; formatVersion: string}>,
  previous: CookVersion | undefined, golden: () => Promise<string>): Promise<void> {
  if (current.cookHash !== actual.cookHash || current.formatVersion !== actual.formatVersion) {
    throw new Error('Cook inputs moved. Bump cookVersion or record a same-output declaration.');
  }
  if (previous === undefined) return;
  if (current.cookVersion !== previous.cookVersion) {
    if (!newer(current.cookVersion, previous.cookVersion) || current.sameOutputFrom !== undefined) throw new Error('A cook version bump must increase semver');
    if (current.goldenDigest !== await golden()) throw new Error('Golden cook differs from the recorded digest');
    return;
  }
  if (current.formatVersion !== previous.formatVersion) throw new Error('A shard format change requires a cook version bump');
  if (current.goldenDigest !== previous.goldenDigest) throw new Error('The golden digest can change only with the cook version');
  if (current.cookHash === previous.cookHash) {
    if (current.sameOutputFrom !== previous.sameOutputFrom) throw new Error('A same-output declaration must name a changed cook hash');
    return;
  }
  if (current.sameOutputFrom !== previous.cookHash) throw new Error('A changed cook hash needs a version bump or same-output declaration');
  if (current.goldenDigest !== await golden()) throw new Error('Golden cook differs from the recorded digest. Bump cookVersion.');
}

export function recordedCookVersion(root = ROOT): CookVersion {
  return readVersion(readFileSync(join(root, LOCK), 'utf8'));
}

async function goldenCook(): Promise<string> {
  await import(new URL('./bake-loader.mjs', import.meta.url).href);
  const { DEFAULT_LIMITS, cookOutputDigest, runJob } = await import('../cook/game/cookWorker.ts');
  const { folderTarball } = await import('../cook/game/folderTarball.ts');
  const scratch = resolve(process.env['COOK_VERSION_SCRATCH'] ?? join(ROOT, 'tmp/cook-version'));
  mkdirSync(scratch, {recursive: true});
  const work = mkdtempSync(join(scratch, 'golden-')), tar = join(work, 'input.tar'), out = join(work, 'out');
  try {
    writeFileSync(tar, folderTarball(join(ROOT, 'test/fixtures/made-up-old')));
    const result = await runJob({ root: ROOT, execPath: process.execPath, loader: join(ROOT, 'src/scripts/bake-loader.mjs'),
      script: join(ROOT, 'src/scripts/cook-job.mjs'), limits: DEFAULT_LIMITS, wrap: [] }, tar, out, 'cli-fixture');
    if (result.kind !== 'cooked') throw new Error(`Golden cook ${result.kind}: ${result.reason}`);
    return cookOutputDigest(out);
  } finally { rmSync(work, {recursive: true, force: true}); }
}

function fromBase(base: string): CookVersion | undefined {
  const git = (args: string[]): string => execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const file = git(['ls-tree', commit, '--', LOCK]);
  return file === '' ? undefined : readVersion(git(['show', `${commit}:${LOCK}`]));
}

async function main(): Promise<void> {
  const {values} = parseArgs({options: {base: {type: 'string'}, bump: {type: 'string'}, same: {type: 'boolean'}}});
  if (values.bump !== undefined && values.same === true) throw new Error('Choose either --bump VERSION or --same');
  await import(new URL('./format-hook.mjs', import.meta.url).href);
  const {SHARDFILE_VERSION: formatVersion} = await import('@wildshard/format/version');
  const actual = {cookHash: cookHash(ROOT).cookHash, formatVersion};
  const previous = fromBase(values.base === undefined ? 'HEAD' : /^0+$/u.test(values.base) ? 'HEAD~1' : values.base);
  if (values.bump === undefined && values.same !== true) {
    const current = recordedCookVersion();
    await checkCookVersion(current, actual, previous, goldenCook);
    console.log(`Cook ${current.cookVersion} ${current.cookHash}`);
    return;
  }
  if (values.same === true && previous === undefined) throw new Error('The first cook version needs --bump VERSION');
  const version = values.bump ?? previous?.cookVersion ?? '';
  if (!VERSION.test(version)) throw new Error('cookVersion must be X.Y.Z');
  if (values.bump !== undefined && previous !== undefined && !newer(version, previous.cookVersion)) throw new Error('Choose a higher cook version');
  if (values.same === true && previous?.cookHash === actual.cookHash) throw new Error('The cook hash is unchanged');
  const goldenDigest = await goldenCook();
  const current: CookVersion = {cookVersion: version, ...actual, goldenDigest,
    ...(values.same === true && previous !== undefined ? {sameOutputFrom: previous.cookHash} : {})};
  await checkCookVersion(current, actual, previous, () => Promise.resolve(goldenDigest));
  writeFileSync(join(ROOT, LOCK), `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Recorded cook ${version} ${actual.cookHash}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main();
