// @vitest-environment node
// Fix preview PV15: content sets are history. content.mjs keeps only the packs bucket's names and S3 keys (for
// content-prune.mjs), and this guard fails if it, or any release path, publishes a content set again.
// oxlint-disable-next-line import/no-nodejs-modules -- The guard runs page-release.mjs itself.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The guard reads the release sources and workflows.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under tmp.
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import * as content from '../src/scripts/page-release/content.mjs';
import {contentKeys, missingKeysMessage} from '../src/scripts/page-release/content.mjs';

const root = resolve(import.meta.dirname, '..');
const scratchRoot = resolve(root, 'tmp/page-content-test');
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, {recursive: true, force: true}); });
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

test('CF2: the packs keys come from the environment, else the keys file, and the names still missing are listed', () => {
  mkdirSync(scratchRoot, {recursive: true});
  const dir = mkdtempSync(join(scratchRoot, 'keys-'));
  made.push(dir);
  const file = join(dir, 'cook.env'), account = 'a'.repeat(32), hidden = ['s', 'e', 'c', 'r', 'e', 't'].join('');
  writeFileSync(file, ["# the box's cook.env", `R2_ACCOUNT_ID=${account}`, 'R2_PACKS_ACCESS_KEY_ID=from-file', `R2_PACKS_SECRET_ACCESS_KEY=${hidden}`, 'COOK_NOTIFY_TOKEN=not-read', ''].join('\n'));
  const filled = contentKeys({R2_PACKS_ACCESS_KEY_ID: 'from-env'}, file);
  expect(filled.missing).toEqual([]);
  expect(filled.env['R2_ACCOUNT_ID']).toBe(account);
  expect(filled.env['R2_PACKS_ACCESS_KEY_ID']).toBe('from-env');
  expect(filled.env['R2_PACKS_SECRET_ACCESS_KEY']).toBe(hidden);
  expect(filled.env['COOK_NOTIFY_TOKEN']).toBeUndefined();
  const none = contentKeys({R2_ACCOUNT_ID: ' '}, join(dir, 'absent.env'));
  expect(none.missing).toEqual(['R2_ACCOUNT_ID', 'R2_PACKS_ACCESS_KEY_ID', 'R2_PACKS_SECRET_ACCESS_KEY']);
  expect(missingKeysMessage(none.missing)).toContain('R2_PACKS_SECRET_ACCESS_KEY');
  expect(missingKeysMessage(none.missing)).not.toContain(hidden);
});

test('PV15 guard: content.mjs names the sets and the keys and writes nothing', () => {
  expect(Object.keys(content).sort()).toEqual(['BUCKET', 'CONTENT_KEYS', 'CONTENT_ROOT', 'KEYS_FILE', 'contentKeys', 'missingKeysMessage']);
  const source = read('src/scripts/page-release/content.mjs');
  expect(source).not.toMatch(/@aws-sdk|PutObject|CopyObject|r2 object put|wrangler|fetch\(/u);
  expect(existsSync(resolve(root, 'src/scripts/page-release/stamp-content.mjs'))).toBe(false);
});

test('PV15 guard: no release path publishes a content set or stamps a page with one', () => {
  const flow = read('src/scripts/page-release/flow.mjs'), release = read('src/scripts/page-release.mjs');
  for (const source of [flow, release]) {
    expect(source).not.toMatch(/WS_CONTENT_BASE|stamp-content|deps\.content\b|content\.publish|publishContent|r2Content|r2Copies/u);
  }
  // Only content-prune.mjs reaches the packs bucket's content keys, and it writes only its state file.
  const scripts = (dir: string): string[] => readdirSync(resolve(root, dir), {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory() ? (entry.name === 'node_modules' ? [] : scripts(join(dir, entry.name)))
      : /\.(?:mjs|ts|mts)$/u.test(entry.name) && !entry.name.endsWith('.d.mts') ? [join(dir, entry.name)] : []);
  const importers = scripts('src').filter(path => /from ['"][./]*(?:page-release\/)?content\.mjs['"]/u.test(read(path)));
  expect(importers).toEqual(['src/scripts/content-prune.mjs']);
  const prune = read('src/scripts/content-prune.mjs');
  expect(prune.match(/new PutObjectCommand/gu)?.length).toBe(1);
  expect([...prune.matchAll(/bucket\.write\(([^,]+),/gu)].map(match => match[1])).toEqual(['STATE_KEY']);
  // No other R2 writer in the release scripts or the cook names a `content/` key.
  const writers = [...scripts('src/scripts'), ...scripts('src/cook')]
    .filter(path => /PutObjectCommand|CopyObjectCommand|'object', 'put'|r2 object put|'PUT'/u.test(read(path)))
    .filter(path => /[`'"]\/?content\/|CONTENT_ROOT/u.test(read(path)));
  expect(writers).toEqual(['src/scripts/content-prune.mjs']);
  // No workflow passes --content to a page release.
  for (const name of readdirSync(resolve(root, '.github/workflows'))) expect(read(join('.github/workflows', name))).not.toMatch(/page-release\.mjs[^\n]*--content\b/u);
});

test('PV15 guard: page-release refuses --content before any work', () => {
  const run = spawnSync(process.execPath, [resolve(root, 'src/scripts/page-release.mjs'), 'preview', 'build,upload', '--content', '--dry-run'],
    {cwd: root, encoding: 'utf8', timeout: 60_000});
  expect(run.status).toBe(2);
  expect(run.stderr).toMatch(/--content is retired: no channel publishes a content set \(fix preview PV15\)/u);
});
