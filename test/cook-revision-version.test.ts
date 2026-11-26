// Meta QA 11-24 row 44 (MA14b): v0.1.90's cook revision moved from v0.1.89's with package.json's version as the only
// changed input (FP47b's engine floor reads it, so the closure holds package.json), and every head recooked instead of
// carrying. Neither a release bump nor an `engines` pin (QA 11-25 row 41) may move the revision; a cook file still does.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, it} from 'vitest';
import {cookRevision, revisionBytes} from '../src/scripts/cook-revision';

const root = resolve('.'), pkgPath = resolve(root, 'package.json');
const real = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
/** The checkout as it is, but for one file's bytes. */
const swap = (path: string, bytes: Uint8Array) => (file: string): Uint8Array => (file === path ? bytes : readFileSync(file));
const json = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

it('a version bump, an engines pin or a script edit in package.json keeps the cook revision', () => {
  const now = cookRevision(root).revision;
  expect(cookRevision(root).files).toContain('package.json');
  expect(cookRevision(root, swap(pkgPath, json({...real, version: '9.9.9'}))).revision).toBe(now);
  expect(cookRevision(root, swap(pkgPath, json({...real, engines: {node: '24.18.1'}}))).revision).toBe(now);
  expect(cookRevision(root, swap(pkgPath, json({...real, scripts: {...real['scripts'] as object, x: 'true'}}))).revision).toBe(now);
}, 120_000);

it('a cook closure file still moves it, and only package.json is dropped', () => {
  const now = cookRevision(root).revision, job = resolve(root, 'src/cook/game/cookJob.ts');
  const edited = new TextEncoder().encode(`${readFileSync(job, 'utf8')}\n// moved\n`);
  expect(cookRevision(root, swap(job, edited)).revision).not.toBe(now);
  const lock = new TextEncoder().encode('version: 9\n');
  expect(revisionBytes('pnpm-lock.yaml', lock)).toBe(lock);
  expect(revisionBytes('package.json', lock).length).toBe(0);
}, 120_000);
