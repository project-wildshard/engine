// @vitest-environment node
// Standalone shardfiles SF11 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md, J525): once pins
// publish nothing under public/, the page's own art is what engine git holds. Every file on the engine list
// (`src/scripts/public-engine.json`, SF1) is therefore a tracked engine file, never one a pin happens to publish: the cloud
// field (Nalati's mount) and the water ripples were, and every zone reads them (`shared/engine/boot/bakedUrls.ts`).
/* oxlint-disable import/no-nodejs-modules -- Read the committed list and Git's index. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
/* oxlint-enable import/no-nodejs-modules */
import {expect, test} from 'vitest';
import {CLOUD_FIELD_URL, WATER_RIPPLES_URL} from '../src/shared/engine/boot/bakedUrls';

const tracked = new Set(execFileSync('git', ['ls-files', '-z', 'public'], {encoding: 'utf8', maxBuffer: 64 << 20}).split('\0').filter(Boolean));

test('every file on the engine list is in engine git, so no engine art leans on a pin', () => {
  const {files} = JSON.parse(readFileSync('src/scripts/public-engine.json', 'utf8')) as {files: string[]};
  expect(files.length).toBeGreaterThan(100);
  // the Basis transcoder is copied from its package by the build, never committed
  expect(files.filter(path => !tracked.has(`public/${path}`) && !path.startsWith('basis/'))).toEqual([]);
});

test('the baked cloud field and water ripples every zone reads are tracked engine files', () => {
  expect([CLOUD_FIELD_URL, WATER_RIPPLES_URL].filter(url => !tracked.has(`public${url}`))).toEqual([]);
});
