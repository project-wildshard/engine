import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseWorldSceneWeld } from '@wildshard/format/worldSceneWeld';
import { parseWorldSceneModels } from '@wildshard/format/worldSceneModels';
import { admitWorldSceneModelGraphs } from '../src/client/game/shardfile/worldSceneWeld';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { frozenRuntimeJson } from './fixtures/frozen/snapshots';

// The five author/format cases live in the paired SDK file. This keeps the
// original private catalogue consumer on engine, with exact SDK-produced bytes.
test('native variants reconstruct from shared nodes with independent member identities', async () => {
  const captured = v.parse(v.object({ name: v.string(), wire: v.string(), catalogue: v.unknown(), expected: v.array(v.unknown()) }), frozenRuntimeJson('sdk-scene-graphs.json'));
  const bytes = new TextEncoder().encode(captured.wire), catalogue = parseWorldSceneModels(captured.catalogue);
  const original = captured.expected.map(row => parseWorldSceneWeld(row));
  expect(encodeCanonicalJson(original)).toBe(encodeCanonicalJson(captured.expected));
  const admitted = await admitWorldSceneModelGraphs({ hasFile: name => name === captured.name, file: () => Promise.resolve(bytes) }, catalogue);
  expect([...admitted.values()]).toEqual(original);
  await expect(admitWorldSceneModelGraphs({ hasFile: name => name === captured.name, file: () => Promise.resolve(new Uint8Array()) }, catalogue)).rejects.toThrow();
});
