import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { nextFailmodeDeploy } from '../scripts/failmode-deploy-fixture.mjs';
import { fixtureScratch } from './.kit/owned-scratch.mjs';

test('FM11 changes the deployment documents while preserving compiled entry bytes', () => {
  const root = fixtureScratch('failmode-deploy');
  const first = join(root, 'first'), next = join(root, 'next');
  const assets = join(first, 'assets/spawn'), code = join(first, 'b/1234567-fixture');
  mkdirSync(assets, { recursive: true });
  mkdirSync(code, { recursive: true });
  const time = '2026-11-19T05:00:00.000Z';
  const html = '<meta name="ws-built-at" content="' + time + '"><script>globalThis.__WS_BUILD_ID__="1234567-fixture";globalThis.__WS_BUILT_AT__=' + String(Date.parse(time)) + ';</script><script src="/b/1234567-fixture/entry.js"></script>';
  writeFileSync(join(first, 'version.json'), JSON.stringify({ build: '1234567-fixture', time }));
  writeFileSync(join(first, 'index.html'), html);
  writeFileSync(join(code, 'entry.js'), 'globalThis.answer = 42');
  writeFileSync(join(assets, 'packs-1234567-fixture.json'), '{}');

  const nextBuild = nextFailmodeDeploy(first, next);
  assert.match(nextBuild, /^[0-9a-f]{7,40}(?:-[a-z0-9]+)?$/u);
  assert.notEqual(nextBuild, '1234567-fixture');
  assert.equal(readFileSync(join(first, 'index.html'), 'utf8'), html);
  const document = readFileSync(join(next, 'index.html'), 'utf8');
  assert.match(document, new RegExp(`__WS_BUILD_ID__="${nextBuild}";`, 'u'));
  assert.match(document, /2026-11-19T05:00:01.000Z/u);
  assert.match(document, /src="\/b\/1234567-fixture\/entry.js"/u);
  assert.equal(readFileSync(join(next, 'b/1234567-fixture/entry.js'), 'utf8'), 'globalThis.answer = 42');
  // meta QA 11-25 row 65: a page booted on the second build imports /b/{its build}/standalone/online.js by its own name
  assert.equal(readFileSync(join(next, `b/${nextBuild}/entry.js`), 'utf8'), 'globalThis.answer = 42');
  assert.equal(readFileSync(join(next, `assets/spawn/packs-${nextBuild}.json`), 'utf8'), '{}');
  assert.deepEqual(JSON.parse(readFileSync(join(next, 'version.json'), 'utf8')), {
    build: nextBuild, time: '2026-11-19T05:00:01.000Z',
  });
});
