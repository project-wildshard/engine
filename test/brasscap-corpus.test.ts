// J506 (Jake, 2026-11-23 ~20:55 Cancún): engine's pinned copy of Brasscap Mesa, test/fixtures/corpus/brasscap-mesa/, is
// `wildshard build` of one shard-brasscap commit, written by scripts/brasscap-export.mjs (never by hand). This test earns
// the copy its place: the folder is exactly what the pin says, every section its index lists is there with the bytes it
// names, and the build says Brasscap is a player zone (QA-FEEDBACK-2026-11-23-b row 3, "brasscap is not developer only").
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned folder is files.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned folder is files.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { listFiles, treeHash } from '../scripts/brasscap-export.mjs';

const FOLDER = 'test/fixtures/corpus/brasscap-mesa';
type Pin = { repo: string; commit: string; folder: string; files: number; tree: string;
  omitted: { prefix: string; files: number; bytes: number }; kept: { files: number; tree: string } };
const pin = JSON.parse(readFileSync(`${FOLDER}.pin.json`, 'utf8')) as Pin;
const json = (file: string): unknown => JSON.parse(readFileSync(`${FOLDER}/${file}`, 'utf8'));

test('the Brasscap copy is the pinned build, less only the GLB blobs', (): void => {
  expect(pin.folder).toBe(FOLDER);
  expect(pin.repo).toBe('https://github.com/project-wildshard/shard-brasscap');
  expect(pin.commit).toMatch(/^[0-9a-f]{40}$/u);
  const files = listFiles(FOLDER);
  expect(files.filter(file => file.startsWith(pin.omitted.prefix)), 'an omitted file came back').toEqual([]);
  expect(files.length + pin.omitted.files).toBe(pin.files);
  expect({ files: files.length, tree: treeHash(FOLDER, files) }, 'edited by hand: re-run node scripts/brasscap-export.mjs').toEqual(pin.kept);
});

test("every section Brasscap's index lists is in the copy with the bytes it names", (): void => {
  const index = json('shard.json') as { identity: { slug: string }; sections: { path: string; hash: string; bytes: number }[] };
  expect(index.identity.slug).toBe('brasscap-mesa');
  expect(index.sections.length).toBeGreaterThan(10);
  const wrong = index.sections.filter(({ path, hash, bytes }) => {
    if (!existsSync(`${FOLDER}/${path}`)) return true;
    const body = readFileSync(`${FOLDER}/${path}`);
    return body.length !== bytes || createHash('sha256').update(body).digest('hex') !== hash;
  }).map(row => row.path);
  expect(wrong).toEqual([]);
});

test('the pinned Brasscap build is a player zone, never hidden', (): void => {
  const level = json('sections/ui/level.json') as { manifest: { slug: string; status: string } };
  const discovery = json('mounts/shardfiles/brasscap-mesa/discovery.json') as { data: { status: string } };
  expect(level.manifest.slug).toBe('brasscap-mesa');
  expect([level.manifest.status, discovery.data.status]).toEqual(['earlyAccess', 'earlyAccess']);
});
