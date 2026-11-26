// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary build outputs under ./tmp.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths under ./tmp.
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { checkNoJunk, junkIn } from '../src/scripts/app-build/noJunk.mjs';

/** A scratch out dir under ./tmp, removed after `body`. */
function outDir(body: (root: string, put: (file: string) => void) => void): void {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/no-junk-'));
  const put = (file: string): void => { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'x'); };
  try { body(root, put); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('QA 11-26 row 14: a page build holding a video or the crossroads rig fails the build', () => {
  outDir((root, put) => {
    for (const file of ['index.html', 'b/1/main.js', 'assets/music/theme.ogg', 'assets/title/card.webp']) put(file);
    expect(junkIn(root)).toEqual([]);
    expect(() => checkNoJunk(root)).not.toThrow();
    put('trailer-15.mp4'); put('assets/video/intro.MP4'); put('crossroads-rig/index.html');
    expect(junkIn(root)).toEqual(['assets/video/intro.MP4', 'crossroads-rig/', 'trailer-15.mp4']);
    expect(() => checkNoJunk(root)).toThrow('The page build holds junk (QA 11-26 row 14): assets/video/intro.MP4, crossroads-rig/, trailer-15.mp4');
  });
});

test('QA 11-26 row 14: public/, which the build copies into dist, holds no video, and every page build runs the check', () => {
  const videos = readdirSync('public', { recursive: true }).map(String).filter(path => /\.mp4$/iu.test(path));
  expect(videos).toEqual([]);
  const pipeline = readFileSync('src/scripts/app-build-pipeline.mjs', 'utf8');
  expect(pipeline).toContain('checkNoJunk(outDir);');
  expect(pipeline).not.toContain('writeCrossroadsRig');
});
