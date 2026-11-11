import * as v from 'valibot';

// The 24-camera set ships in engine (scripts/perf/cameras24.json); each shard repo keeps its own copy beside its goldens.
export const DEFAULT_GOLDEN_CAMERAS = new URL('../perf/cameras24.json', import.meta.url).pathname;

/** The served artifact identifies a capture. HEAD may have moved, and a
 * working-tree candidate deliberately keeps its parent commit's build id.
 * @param {unknown} value @param {string} [expected] */
export function goldenPreviewIdentity(value, expected = '') {
  const {build} = v.parse(v.object({build:v.string()}), value);
  const matched = /^([a-f0-9]{7,40})(?:-|$)/u.exec(build), prefix = matched?.[1];
  if (prefix === undefined) throw new Error('Preview version has no source SHA');
  if (expected !== '' && !/^[a-f0-9]{40}$/u.test(expected)) throw new Error('--sha requires a full source SHA');
  if (expected !== '' && !expected.startsWith(prefix)) throw new Error(`Preview ${build} does not match --sha ${expected}`);
  return {build, sha:expected || prefix};
}

/** Reject a typo before launching a browser rather than silently capturing
 * nothing or falling back to another shard.
 * @param {Readonly<Record<string,unknown>>} cameras @param {string} [requested] */
export function selectGoldenShards(cameras, requested) {
  const shards = requested === undefined ? Object.keys(cameras) : requested.split(',');
  if (shards.length === 0 || new Set(shards).size !== shards.length
    || shards.some(slug => slug.length === 0 || !Object.hasOwn(cameras,slug))) throw new Error('--shards requires unique names from the camera set');
  return shards;
}

/** @param {string} value */
export function selectGoldenCameraNumbers(value) {
  if (value === '') return null;
  const words = value.split(',');
  if (words.some(word => !/^(?:[1-9]|1[0-9]|2[0-4])$/u.test(word)) || new Set(words).size !== words.length)
    throw new Error('--cams requires unique camera numbers 1..24');
  return new Set(words.map(Number));
}
