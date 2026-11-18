// SQ5: build the source and exercise a real signed world on loopback.
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeGateCopy } from './push-gate-copy.mjs';

/** @param {string} root @param {string} file @param {string[]} args @param {NodeJS.ProcessEnv} env @param {string} log */
async function run(root, file, args, env, log) {
  const fd = openSync(log, 'w', 0o600);
  try {
    const child = spawn(file, args, { cwd: root, env, stdio: ['ignore', fd, fd] });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve(undefined) : reject(new Error(`Local QA build failed. See ${log}`)));
    });
  } finally { closeSync(fd); }
}

/** @param {string} root @param {string} build */
export function checkLocalSource(root, build) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (head !== build) throw new Error('Local QA root must be checked out at the source build');
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (dirty !== '') throw new Error('Local QA needs clean tracked source');
}

/** @param {{root: string, build: string, out: string}} options */
export async function openQaRig({ root, build, out }) {
  const work = join(out, 'local'), dist = join(work, 'dist'), keyFile = join(work, 'fixture-key.json');
  mkdirSync(work, { recursive: true });
  const source = makeGateCopy(root, build, { directory: join(work, 'copies') });
  const checkout = source.path;
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  try {
    writeFileSync(keyFile, JSON.stringify({ private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), public: key }), { mode: 0o600, flag: 'wx' });
    // Both the app and server are built using this source checkout's tools.
    process.env.WS_RIG_PORTS ??= '19476';
    const { RELEASE_PORT, openRig } = await import(pathToFileURL(join(checkout, 'scripts', 'online-rig.mjs')).href);
    await run(checkout, 'pnpm', ['pins'], process.env, join(work, 'pins.log'));
    await run(checkout, 'python3', ['scripts/heavy-lane.py', 'build', '--', process.execPath, 'scripts/build-app.mjs', '--outDir', dist],
      { ...process.env, WS_BUILD_ID: build, WILDSHARD_RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, WILDSHARD_RELEASE_KEY: key },
      join(work, 'build.log'));
    checkLocalSource(checkout, build);
    const rig = await openRig({ dist, work: join(work, 'rig'), keyFile, pgBin: 'pglite:', more: ['pine-hollow', 'far-reach'], cells: 'grid', isolated: true });
    return { base: String(rig.base), source: checkout, close: async () => {
      try { await rig.close(); } finally { source.remove(); }
    } };
  } catch (error) {
    source.remove();
    throw error;
  } finally { rmSync(keyFile, { force: true }); }
}
