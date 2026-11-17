// @vitest-environment node
import {expect, test} from 'vitest';
import {selectCookRelease} from '../scripts/release-cook.mjs';

const build = 'a'.repeat(40), staging = {tag: `server-staging-${build}`, build};

test('staging moves the cook from its signed server tag before a production tag exists', () => {
  expect(selectCookRelease(staging, {tag: 'v0.1.32', build: 'b'.repeat(40)}, {build})).toEqual(staging);
  expect(() => selectCookRelease(staging, staging, {build: 'b'.repeat(40)})).toThrow('exact signed staging');
  expect(() => selectCookRelease({...staging, tag: 'server-production-' + build}, staging, {build})).toThrow('exact signed staging');
});

test('finishing an older production train cannot rewind a cook already following newer staging', () => {
  const production = {tag: 'v0.1.33', build};
  expect(selectCookRelease(staging, production, {tag: 'v0.1.33'})).toEqual(production);
  expect(() => selectCookRelease({...staging, build: 'b'.repeat(40)}, production, {tag: 'v0.1.33'})).toThrow('Cook follows staging');
  expect(() => selectCookRelease(staging, production, {tag: 'v0.1.32'})).toThrow('Cook follows staging');
});
