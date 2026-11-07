// oxlint-disable-next-line import/no-nodejs-modules -- Verify the real prepare workflow's shell admission without packaging or a network request.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own one small command fixture under repository scratch.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture's executable and output paths.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import * as v from 'valibot';

test('prepare enables Vercel only on push and binds both packs to the exact source run', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const prepare = workflow.split('\n  prepare:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
  if (prepare === undefined) throw new Error('Missing prepare producer');
  const pack = prepare.split('      - name: Pack the exact web build for boot smoke\n')[1]?.split('      - uses:')[0];
  const body = /run: \|\n((?: {10}[^\n]*\n)+)/u.exec(pack ?? '')?.[1];
  if (body === undefined) throw new Error('Missing release packaging admission');
  const script = body.split('\n').map(line => line.slice(10)).join('\n');
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/prepare-release-shell-')), output = join(root, 'argv');
  try {
    const executable = join(root, 'python3');
    writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@" > "$PACK_ARGS"\n');
    chmodSync(executable, 0o755);
    for (const event of ['push', 'pull_request']) {
      const sha = 'a'.repeat(40), run = '123';
      const result = spawnSync('/bin/bash', ['-eu', '-c', script], { encoding: 'utf8', env: {
        ...process.env, PATH: `${root}:/usr/bin:/bin`, PACK_ARGS: output,
        GITHUB_EVENT_NAME: event, GITHUB_SHA: sha, GITHUB_RUN_ID: run, RUNNER_TEMP: root,
      } });
      expect(result.status, result.stderr).toBe(0);
      const args = readFileSync(output, 'utf8').trim().split('\n');
      expect(args.slice(0, 4)).toEqual(['scripts/ci-fail-fast.py', '--', 'node', 'scripts/prepare-release-packs.mjs']);
      expect(args.slice(4)).toEqual(['--sha', sha, '--run', run, ...(event === 'push' ? ['--vercel', '--cli-ready', join(root, 'prepare-vercel-cli.txt')] : [])]);
    }
    const producer = prepare.indexOf('      - name: Pack the exact web build for boot smoke');
    expect(producer).toBeGreaterThan(prepare.indexOf('scripts/check-css.mjs'));
    for (const artifact of ['boot-dist-manifest', 'boot-dist-boot-public', 'boot-dist-boot-developer', 'boot-dist-worlds', 'boot-dist-phone-route', 'vercel-prebuilt'])
      expect(prepare.indexOf(`name: ${artifact}\n`), artifact).toBeGreaterThan(producer);
    expect(prepare).not.toContain('npm install --global vercel');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepare overlaps only tokenless pinned CLI installation with the original app check', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const step = workflow.split('      - name: Verify preparation, checks and build (parallel)\n')[1]?.split('\n      - name:')[0];
  const body = /run: \|\n((?: {10}[^\n]*\n)+)/u.exec(step ?? '')?.[1];
  if (body === undefined) throw new Error('Missing parallel prepare checks');
  const script = body.split('\n').map(line => line.slice(10)).join('\n');
  mkdirSync('tmp', {recursive:true});
  const root = mkdtempSync(resolve('tmp/prepare-cli-overlap-')), output = join(root, 'argv'), installed = join(root, 'installed');
  try {
    const python = join(root, 'python3'), node = join(root, 'node');
    writeFileSync(python, '#!/bin/sh\nif [ "$1" = scripts/ci-disk-census.py ]; then printf "%s\\n" "$2" >> "$DISK_PHASES"; else printf "%s\\n" "$@" > "$CHECK_ARGS"; exit "$CHECK_STATUS"; fi\n');
    writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CLI_ARGS"\n');
    chmodSync(python, 0o755); chmodSync(node, 0o755);
    for (const event of ['push', 'pull_request']) for (const status of [0, 23]) {
      rmSync(installed, {force:true});
      const phases = join(root, 'disk-phases'); rmSync(phases, { force: true });
      const sha = 'b'.repeat(40), run = '123';
      const env = {...process.env, PATH:`${root}:/usr/bin:/bin`, CHECK_ARGS:output, CLI_ARGS:installed, DISK_PHASES:phases, CHECK_STATUS:String(status),
        GITHUB_EVENT_NAME:event, GITHUB_SHA:sha, GITHUB_RUN_ID:run, RUNNER_TEMP:root};
      const result = spawnSync('/bin/bash', ['-eu', '-c', script], {encoding:'utf8', env});
      expect(result.status, result.stderr).toBe(status);
      expect(readFileSync(phases, 'utf8').trim().split('\n')).toEqual(['prepare-before-parallel', 'prepare-after-parallel']);
      const args = readFileSync(output, 'utf8').trim().split('\n');
      expect(args.slice(0, 8)).toEqual(['scripts/ci-fail-fast.py', '--', 'node', 'scripts/build-without-browser.mjs', '--', 'node', 'scripts/ci-checks.mjs', '--prepared']);
      expect(args[8]).toBe('python3 scripts/heavy-lane.py build -- node scripts/build-app.mjs && node scripts/check-devserver.mjs dist');
      expect(args).toHaveLength(10);
      const prerequisite = args[9]; if (prerequisite === undefined) throw new Error('Missing tokenless prerequisite');
      expect(step).not.toContain('secrets.');
      const install = spawnSync('/bin/bash', ['-eu', '-c', prerequisite], {encoding:'utf8', env});
      expect(install.status, install.stderr).toBe(0);
      if (event === 'push') expect(readFileSync(installed, 'utf8').trim().split('\n')).toEqual([
        'scripts/prepare-release-packs.mjs', '--sha', sha, '--run', run, '--install-cli', '--cli-ready', join(root, 'prepare-vercel-cli.txt')]);
      else expect(() => readFileSync(installed)).toThrow();
    }
  } finally { rmSync(root, {recursive:true, force:true}); }
});

test('prepare cache compression keeps every restored family and its native bytes', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const prepare = workflow.split('\n  prepare:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
  const cache = prepare?.split('      - uses: actions/cache@v4\n')[1]?.split('\n      - ')[0];
  const level = /^ {10}ZSTD_CLEVEL: '(\d+)'$/mu.exec(cache ?? '')?.[1];
  if (level === undefined) throw new Error('Missing preparation cache compression environment');
  const paths = /^ {10}path: \|\n((?: {12}[^\n]+\n)+)/mu.exec(cache ?? '')?.[1]
    ?.trim().split('\n').map(path => path.trim());
  const families = ['generate', 'gen', 'compiler-code/1', 'shardfiles', 'basis'];
  expect(new Set(paths)).toEqual(new Set(families.map(family => `~/.cache/wildshard/${family}`)));
  // Step-local tuning must not change other archive producers or native codecs.
  expect(workflow.match(/ZSTD_CLEVEL:/gu)).toHaveLength(1);
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/prepare-cache-roundtrip-'));
  try {
    const source = join(root, 'source'), restored = join(root, 'restored'), archive = join(root, 'cache.tzst');
    mkdirSync(source); mkdirSync(restored);
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
    for (const [index, family] of families.entries()) {
      const directory = join(source, family); mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'body'), Buffer.concat([Buffer.from(`${family}:\0`), bytes, Buffer.from([index])]));
    }
    const env = { ...process.env, ZSTD_CLEVEL: level };
    const packed = spawnSync('tar', ['--posix', '-cf', archive, '-C', source, '--use-compress-program', 'zstdmt', '.'],
      { encoding: 'utf8', env, timeout: 5000 });
    expect(packed.status, packed.stderr + String(packed.error ?? '')).toBe(0);
    const unpacked = spawnSync('tar', ['-xf', archive, '-C', restored, '--use-compress-program', 'unzstd'],
      { encoding: 'utf8', timeout: 5000 });
    expect(unpacked.status, unpacked.stderr + String(unpacked.error ?? '')).toBe(0);
    for (const family of families)
      expect(readFileSync(join(restored, family, 'body'))).toEqual(readFileSync(join(source, family, 'body')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('post-generation cache lookup preserves admitted bytes and every legacy restore family', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const prepare = workflow.split('\n  prepare:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
  if (prepare === undefined) throw new Error('Missing prepare producer');
  const restore = prepare.split('      - uses: actions/cache/restore@v4\n')[1]?.split('\n      - ')[0];
  const save = prepare.split('      - uses: actions/cache@v4\n')[1]?.split('\n      - ')[0];
  const paths = (step: string | undefined): string[] | undefined => /^ {10}path: \|\n((?: {12}[^\n]+\n)+)/mu.exec(step ?? '')?.[1]
    ?.trim().split('\n').map(path => path.trim());
  expect(paths(restore)).toBeDefined();
  expect(paths(save)).toEqual(paths(restore));
  // A second download would replace bytes already admitted by this run.
  expect(save).toContain('lookup-only: true');
  expect(save).not.toContain('restore-keys:');
  expect(save).toContain(`key: \${{ steps.preparation-save.outputs.key }}`);
  expect(restore).toContain(`preparation-v4-\${{ runner.os }}-\${{ runner.arch }}-node24-`);
  expect(restore).toContain(`preparation-v3-\${{ runner.os }}-\${{ runner.arch }}-node24-`);
  // Fixtures run beside prepare, so their read-only restore must find the
  // same admitted cache families rather than silently rebuilding from cold.
  const fixtures = workflow.split('\n  fixtures:\n')[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0];
  const fixtureRestore = fixtures?.split('      - uses: actions/cache/restore@v4\n')[1]?.split('\n      - ')[0];
  const prefixes = (step: string | undefined): string[] | undefined => /^ {10}restore-keys: \|\n((?: {12}[^\n]+(?:\n|$))+)/mu.exec(step ?? '')?.[1]
    ?.trim().split('\n').map(key => key.trim());
  expect(paths(fixtureRestore)).toEqual(paths(restore));
  expect(prefixes(restore)).toBeDefined();
  expect(prefixes(fixtureRestore)).toEqual(prefixes(restore));
  expect(fixtures).not.toContain('uses: actions/cache@v4');
  const binding = prepare.split('      - name: Bind preparation save to admitted inputs\n')[1]?.split('\n      - ')[0];
  expect(binding).toContain('id: preparation-save');
  expect(binding).toContain(`WS_PREPARATION_PRUNE_STATUS: \${{ steps.generation-cache.outputs.status }}`);
  const retention=prepare.split('      - name: Retain current cache generations\n')[1]?.split('\n      - ')[0];
  expect(retention).toContain('id: generation-cache');
  expect(retention).toContain('node scripts/ci-product-cache.mjs --prune-generation');
  expect(prepare.indexOf('Retain current cache generations')).toBeGreaterThan(prepare.indexOf('node scripts/gen.mjs --reuse'));
  expect(prepare.indexOf('Bind preparation save to admitted inputs')).toBeGreaterThan(prepare.indexOf('Retain current cache generations'));
  expect(binding).toContain('PREPARATION_FALLBACK_KEY: preparation-v3-');
  expect(binding).toContain('if ! node scripts/preparation-cache-key.mjs; then');
  expect(prepare.indexOf('Bind preparation save to admitted inputs')).toBeGreaterThan(prepare.indexOf('node scripts/gen.mjs --reuse'));
});

test('an unavailable cache identity process preserves the legacy save rather than masking generation', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const binding = workflow.split('      - name: Bind preparation save to admitted inputs\n')[1]?.split('\n      - ')[0];
  const body = /run: \|\n((?: {10}[^\n]*\n)+)/u.exec(binding ?? '')?.[1];
  if (body === undefined) throw new Error('Missing preparation save fallback');
  const script = body.split('\n').map(line => line.slice(10)).join('\n');
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/prepare-cache-process-'));
  try {
    const executable = join(root, 'node'), output = join(root, 'output');
    writeFileSync(executable, '#!/bin/sh\nexit 7\n'); chmodSync(executable, 0o755);
    const fallback = `preparation-v3-Linux-X64-node24-${'a'.repeat(40)}`;
    const child = spawnSync('/bin/bash', ['-eu', '-c', script], { encoding: 'utf8', env: {
      ...process.env, PATH: `${root}:/usr/bin:/bin`, GITHUB_OUTPUT: output, PREPARATION_FALLBACK_KEY: fallback,
    } });
    expect(child.status, child.stderr).toBe(0);
    expect(readFileSync(output, 'utf8').trim().split('\n')).toEqual([`key=${fallback}`, 'qualified=false']);
    expect(binding).not.toContain('always()');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cache metadata reports byte totals and candidates without claiming payload identity', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const step = workflow.split('      - name: Report preparation cache family metadata\n')[1]?.split('      - name:')[0];
  const body = /<<'PY'\n([\s\S]+?)\n {10}PY/u.exec(step ?? '')?.[1];
  if (body === undefined) throw new Error('Missing cache metadata producer');
  const script = body.split('\n').map(line => line.slice(10)).join('\n');
  const schema = v.array(v.object({
    cacheFamily: v.string(), bytes: v.number(), files: v.number(), complete: v.boolean(),
    fileListSHA256: v.nullable(v.string()), metadataOnly: v.literal(true), elapsedMs: v.number(),
  }));
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/cache-metadata-'));
  try {
    const families = ['generate', 'gen', 'compiler-code/1', 'shardfiles'];
    for (const family of families) {
      mkdirSync(join(root, family), { recursive: true });
      writeFileSync(join(root, family, 'data'), 'abcd');
    }
    const read = () => {
      const result = spawnSync('python3', ['-', root], { input: script, encoding: 'utf8', timeout: 5000 });
      expect(result.status, result.stderr + String(result.error ?? '')).toBe(0);
      return v.parse(schema, result.stdout.trim().split('\n').map((line: string): unknown => JSON.parse(line)));
    };
    const first = read();
    expect(new Set(first.map(row => row.cacheFamily))).toEqual(new Set(families));
    for (const row of first) {
      expect(row.complete).toBe(true);
      expect(row.files).toBe(1);
      expect(row.bytes).toBe(4);
      expect(row.fileListSHA256).toMatch(/^[a-f0-9]{64}$/u);
    }
    // Deliberately expose the limitation: equal-size changes cannot qualify a real cache key.
    writeFileSync(join(root, 'gen/data'), 'dcba');
    expect(read().map(row => row.fileListSHA256)).toEqual(first.map(row => row.fileListSHA256));
    writeFileSync(join(root, 'gen/data'), 'longer');
    const changed = read().find(row => row.cacheFamily === 'gen');
    expect(changed?.bytes).toBe(6);
    expect(changed?.fileListSHA256).not.toBe(first.find(row => row.cacheFamily === 'gen')?.fileListSHA256);
    symlinkSync(join(root, 'gen/data'), join(root, 'gen/linked'));
    const linked = read().find(row => row.cacheFamily === 'gen');
    expect(linked?.complete).toBe(false);
    expect(linked?.fileListSHA256).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
