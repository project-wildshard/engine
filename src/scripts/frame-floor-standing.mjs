import * as v from 'valibot';

const finite = v.pipe(v.number(), v.finite());
const pose = v.strictObject({
  name: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_.-]{1,128}$/u)),
  x: finite, y: finite, z: finite, yaw: finite, pitch: finite,
});
const catalogue = v.record(v.pipe(v.string(), v.regex(/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u)), v.pipe(v.array(pose), v.minLength(1), v.maxLength(8)));

/** Fixed caller-authored world poses; every requested shard must be covered.
 * Angles are radians, as in the existing live pose API. No camera override.
 * @param {unknown} input @param {readonly string[]} shards */
export function frameFloorStanding(input, shards) {
  const parsed = v.parse(catalogue, input);
  if (shards.length === 0 || Object.keys(parsed).length !== shards.length
    || shards.some(shard => !Object.hasOwn(parsed, shard))) throw new Error('Standing file must cover exactly the measured shards');
  for (const rows of Object.values(parsed))
    if (new Set(rows.map(row => row.name)).size !== rows.length) throw new Error('Duplicate standing pose');
  return parsed;
}
