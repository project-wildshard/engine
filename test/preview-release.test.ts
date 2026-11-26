// @vitest-environment node
import {expect, test} from 'vitest';
import {previewUpload} from '../src/scripts/page-release/preview.mjs';

const build = 'a'.repeat(40), base = 'https://packs.wildshard.io/content/0123456789abcdef/';
const state = () => ({build: {build, contentBase: base}, upload: {build, channel: 'preview', deployment: {id: 'version'}, content: {base}}});

test('preview signing admits only the uploaded main build and matching content base', () => {
  expect(previewUpload(state(), build, true)).toBe(base);
  expect(() => previewUpload(state(), build, false)).toThrow('origin/main');
  expect(() => previewUpload(state(), 'branch', true)).toThrow('origin/main');
  expect(() => previewUpload({}, build, true)).toThrow();
  expect(() => previewUpload({...state(), upload: undefined}, build, true)).toThrow();
  const wrongBuild = state(); wrongBuild.upload.build = 'b'.repeat(40);
  expect(() => previewUpload(wrongBuild, build, true)).toThrow('upload this page');
  const wrongChannel = {...state(), upload: {...state().upload, channel: 'staging'}};
  expect(() => previewUpload(wrongChannel, build, true)).toThrow();
  const wrongBase = state(); wrongBase.upload.content.base = base.replace('0123', '4567');
  expect(() => previewUpload(wrongBase, build, true)).toThrow('does not match');
  expect(() => previewUpload({...state(), build: {build, contentBase: 'https://other.example/content/x/'}}, build, true)).toThrow('does not match');
});
