// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary build outputs under ./tmp.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths under ./tmp.
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { CODE_ROOT, SHARED_CODE_DIRECTORY, codeDirectory, codeFolderBuild, engineVersionOf } from '../src/scripts/app-build/buildIdentity.mjs';
import { MAX_PAGE_FILES, checkCodeLayout } from '../src/scripts/app-build/codeLayout.mjs';
import { CHUNK, carryPreviousDeploy } from '../src/scripts/app-build/previousDeploy.mjs';
import { standaloneDirectory, standaloneServerFile, writeStandaloneOutput } from '../src/scripts/app-build/standaloneOutput.mjs';
import { buildCodeFolder, codeFolderBuildOf } from '../src/client/engine/boot/codeFolder';
import { staleChunkFailure } from '../src/client/engine/boot/chunkRecovery';
import { classify } from '../src/scripts/page-size.mjs';

/** A scratch out dir under ./tmp, removed after `body`. */
async function outDir(prefix: string, body: (root: string, put: (file: string, text: string) => void) => Promise<void> | void): Promise<void> {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve(`tmp/${prefix}-`));
  const put = (file: string, text: string): void => { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  try { await body(root, put); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('PV9: a build\'s code folder is builds/<engineVersion>/<build>/, its shared code builds/shared/', () => {
  expect(CODE_ROOT).toBe('builds');
  expect(codeDirectory('2476a98-mabc123', '0.1.97')).toBe('builds/0.1.97/2476a98-mabc123');
  expect(codeDirectory('x')).toBe(`builds/${engineVersionOf()}/x`);
  expect(SHARED_CODE_DIRECTORY).toBe('builds/shared');
  expect(() => codeDirectory('x', 'shared')).toThrow('Invalid engine version');
  expect(standaloneDirectory('x', '0.1.97')).toBe('builds/0.1.97/x/standalone');
  // the script side and the page side read a path's build the same way, in both layouts
  for (const [path, build] of [['builds/0.1.97/abc/main-x.js', 'abc'], ['builds/0.1.97/abc/standalone/online.js', 'abc'], ['b/old/main-x.js', 'old'],
    ['builds/shared/main-x.js', undefined], ['b/c/main-x.js', undefined], ['assets/x-12345678.js', undefined]] as const) {
    expect(codeFolderBuild(path), path).toBe(build);
    expect(codeFolderBuildOf(`/${path}`), path).toBe(build);
  }
  Reflect.set(globalThis, '__WS_BUILD_ID__', 'abc'); Reflect.set(globalThis, '__WS_CLIENT_VERSION__', '0.1.97');
  try { expect(buildCodeFolder()).toBe('/builds/0.1.97/abc'); } finally { Reflect.deleteProperty(globalThis, '__WS_BUILD_ID__'); Reflect.deleteProperty(globalThis, '__WS_CLIENT_VERSION__'); }
  // the old-tab readers know both layouts: a missing chunk of either is a stale build's, and both count as code
  for (const path of ['/builds/0.1.97/abc/main-AbCd1234.js', '/builds/shared/late-AbCd1234.js', '/b/old/main-AbCd1234.js'])
    expect(staleChunkFailure(new Error(`Failed to fetch dynamically imported module: https://play.test${path}`), 'https://play.test/'), path).toBe(true);
  expect(classify('builds/0.1.97/abc/main-x.js', new Set()).kind).toBe('code');
  for (const path of ['builds/0.1.97/abc/main-AbCd1234.js', 'builds/shared/x-AbCd1234.js', 'b/old/main-AbCd1234.js']) expect(CHUNK.test(path), path).toBe(true);
  expect(standaloneServerFile('builds/0.1.97/abc/standalone/shell.js')).toBe(true);
});

test('PV9: the emitted shell lands in the build\'s folder', async () => {
  await outDir('code-layout-shell', async root => {
    await writeStandaloneOutput(root, 'pv9', process.cwd());
    expect(readFileSync(join(root, standaloneDirectory('pv9'), 'online.js'), 'utf8').length).toBeGreaterThan(0);
  });
}, 60_000);

test('PV9: the build refuses code outside its folder, a graph under the legacy b/, and a page of 20,000 files', async () => {
  await outDir('code-layout', async (root, put) => {
    const own = 'builds/0.1.97/new';
    put('version.json', JSON.stringify({ build: 'new', clientVersion: '0.1.97' }));
    put(`${own}/main-AbCd1234.js`, 'import "/builds/shared/late-AbCd1234.js";');
    put('builds/shared/late-AbCd1234.js', '');
    put('assets/tex/ground-12345678.jpg', 'art');
    put('index.html', `<html><head><script type="module" src="/${own}/main-AbCd1234.js"></script><link rel="modulepreload" href="/builds/shared/late-AbCd1234.js"></head></html>`);
    // a build from before PV9, carried in from its legacy folder, sits beside the new one
    const old = join(root, 'old-deploy');
    mkdirSync(join(old, 'b/old'), { recursive: true }); mkdirSync(join(old, 'b/c'), { recursive: true });
    writeFileSync(join(old, 'version.json'), JSON.stringify({ build: 'old' }));
    writeFileSync(join(old, 'b/old/main-OldOld12.js'), 'old'); writeFileSync(join(old, 'b/c/late-OldOld12.js'), 'old');
    await carryPreviousDeploy(old);
    expect(await carryPreviousDeploy(root, { previousDirectory: old })).toMatchObject({ current: 3, builds: 2, carried: 2 });
    expect(readFileSync(join(root, 'b/old/main-OldOld12.js'), 'utf8')).toBe('old');
    rmSync(old, { recursive: true });
    expect(checkCodeLayout(root)).toEqual({ own, files: 8 });

    put('index.html', '<html><head><script type="module" src="/b/new/main-AbCd1234.js"></script></head></html>');
    expect(() => checkCodeLayout(root)).toThrow('PV9: index.html loads /b/new/main-AbCd1234.js');
    put('index.html', '<html><head><script type="module" src="/builds/0.1.96/new/main-AbCd1234.js"></script></head></html>');
    expect(() => checkCodeLayout(root)).toThrow('outside builds/0.1.97/new/');
    put('index.html', `<html><head><script type="module" src="/${own}/main-AbCd1234.js"></script></head></html>`);
    const manifest = JSON.parse(readFileSync(join(root, 'deploy-chunks.json'), 'utf8')) as { builds: { build: string; files: { path: string; bytes: number }[] }[] };
    manifest.builds[0]?.files.push({ path: 'b/new/late.js', bytes: 1 });
    put('deploy-chunks.json', JSON.stringify(manifest));
    expect(() => checkCodeLayout(root)).toThrow('PV9: this build\'s graph names b/new/late.js');
    manifest.builds[0]?.files.pop(); put('deploy-chunks.json', JSON.stringify(manifest));
    rmSync(join(root, own), { recursive: true });
    expect(() => checkCodeLayout(root)).toThrow('holds no code');
    put(`${own}/main-AbCd1234.js`, '');
    expect(MAX_PAGE_FILES).toBe(20_000);
    for (let index = 0; index < MAX_PAGE_FILES; index++) put(`assets/many/${index}.txt`, '');
    expect(() => checkCodeLayout(root)).toThrow('at or over Workers static assets\' 20000');
  });
}, 60_000);
