// @vitest-environment happy-dom
// QA-FEEDBACK-2026-11-23 row 8: the built-Home cache is keyed by the code that builds Home geometry, not the deploy. An edit to
// a listed decoder or assembler, or a decoder library bump, moves the key; an edit anywhere else (a new deploy of the same
// geometry code) leaves it, so the first boot after an update restores the Home instead of rebuilding it.
// oxlint-disable-next-line import/no-nodejs-modules -- Reads this checkout's sources.
import {existsSync, readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout paths.
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {HOME_GEOMETRY_INPUTS, HOME_GEOMETRY_PACKAGES, homeGeometryHash, homeGeometryRevision} from '../scripts/home-geometry-revision.mjs';
import {homeGeometryCode} from '../src/client/game/shardfile/homeBuildCache';

const root = resolve(import.meta.dirname, '..');
const disk = (path: string): Buffer => readFileSync(resolve(root, path));
const base = homeGeometryHash(disk);
const edited = (path: string): string => homeGeometryHash(file => file === path ? Buffer.from(`${disk(path).toString('utf8')}\n// one line\n`) : disk(file));

describe('Home geometry revision (QA 2026-11-23 row 8)', () => {
  it('lists files that exist and packages this engine depends on', () => {
    for (const path of HOME_GEOMETRY_INPUTS) expect(existsSync(resolve(root, path)), path).toBe(true);
    const pkg = JSON.parse(disk('package.json').toString('utf8')) as {dependencies: Record<string, string>};
    for (const name of HOME_GEOMETRY_PACKAGES) expect(pkg.dependencies[name], name).toBeTypeOf('string');
    expect(homeGeometryRevision(root)).toBe(base);
  });
  it('moves on an edit to the assembler, the snapshot codec or the GLB parser', () => {
    for (const path of ['src/client/game/plugin/geometry.ts', 'src/client/game/shardfile/homeGeometrySnapshot.ts', 'src/client/engine/anim/rigParser.ts']) expect(edited(path)).not.toBe(base);
  });
  it('moves on a decoder library bump', () => {
    const bumped = homeGeometryHash(file => {
      if (file !== 'package.json') return disk(file);
      const pkg = JSON.parse(disk(file).toString('utf8')) as {dependencies: Record<string, string>};
      pkg.dependencies['three'] = `${pkg.dependencies['three'] ?? ''}-next`;
      return Buffer.from(JSON.stringify(pkg));
    });
    expect(bumped).not.toBe(base);
  });
  it('stays on an edit outside the Home geometry code', () => {
    expect(edited('src/client/app/entry.ts')).toBe(base);
  });
});

describe('the built-Home cache key', () => {
  it('a new build with the same geometry code is the same key: an update keeps the Home', () => {
    expect(homeGeometryCode(base, 'build-A')).toBe(homeGeometryCode(base, 'build-B'));
    expect(homeGeometryCode('a'.repeat(64), 'build-A')).not.toBe(homeGeometryCode(base, 'build-A'));
  });
  it('a document with no stamp keys by its build, as before', () => {
    expect(homeGeometryCode(undefined, 'build-A')).toBe('build-A');
    expect(homeGeometryCode('not-a-hash', 'build-A')).not.toBe(homeGeometryCode('not-a-hash', 'build-B'));
  });
});
