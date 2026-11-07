import * as v from 'valibot';
import { nameBlob, type NamedBlob } from '../../src/sharddev/blobs';
import { encodeCanonicalJson } from '../../src/shared/host/immutable';

const scalar = v.number();
const sourceRows = v.object({ places: v.object({ rows: v.array(v.object({
  name: v.string(), members: v.array(v.tuple([v.string(), v.unknown()])),
})) }) });
const hull = v.object({ kind: v.literal('hull'), x: scalar, y: scalar, z: scalar, points: v.array(scalar), surface: v.literal('rock') });
const owner = v.object({ boxes: v.array(scalar), solid: v.array(hull), descs: v.array(hull) });
const sceneRows = v.looseObject({ statics: v.array(v.looseObject({ name: v.string(), members: v.array(v.looseObject({
  model: v.string(), boxes: v.exactOptional(v.array(scalar)), contacts: v.exactOptional(v.unknown()),
})) })) });

/** Preserve the full frozen scene except the exact box/origin fields owned by native outcrop metadata.
 * Both complete old scene pins are checked before this transport; no rounding or tolerance is applied. */
export function sceneWithNativeOutcrops(before: NamedBlob, runtime: unknown): NamedBlob {
  const name = before.file.name;
  if (name === undefined || before.file.kind !== 'json') throw new Error('Expected a named dressing scene');
  const source = v.parse(sourceRows, runtime).places.rows.find(row => row.name === 'outcrops');
  const scene = v.parse(sceneRows, JSON.parse(new TextDecoder().decode(before.bytes)));
  const target = scene.statics.find(row => row.name === 'outcrops');
  if (source === undefined || target === undefined || source.members.length !== target.members.length) throw new Error('Missing owned outcrop members');
  for (const [model, input] of source.members) {
    const current = v.parse(owner, input), member = target.members.find(row => row.model === model);
    if (member === undefined) throw new Error('Missing exact outcrop member identity');
    const contacts = v.parse(v.looseObject({ kind: v.literal('packed-hulls'), origins: v.array(v.tuple([scalar, scalar, scalar, scalar])) }), member.contacts);
    member.boxes = current.boxes;
    contacts.origins = [...current.solid, ...current.descs].map((row): [number, number, number, number] => [row.x, row.y, row.z, row.points.length]);
    member.contacts = contacts;
  }
  return nameBlob(name, 'json', new TextEncoder().encode(encodeCanonicalJson(scene)),
    before.file.jsonSchema === undefined ? {} : { jsonSchema: before.file.jsonSchema });
}
