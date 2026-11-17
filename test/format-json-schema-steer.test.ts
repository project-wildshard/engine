import { MoversSchema } from '@wildshard/format/movers';
import { expect, test } from 'vitest';
import { formatJsonSchema } from '../src/shared/host/formatJsonSchema';

// SHARD-SOURCE SS-MS2a2 (format 0.21.0): a steer sail's wind is a tuple that blows toward some direction (`someItem`), which
// the JSON Schema bridge had no lowering for, so every movers document failed to convert (sharddev dev's platform families).
test('the movers document converts, and its sail wind refuses the zero direction', () => {
  const text = JSON.stringify(formatJsonSchema(MoversSchema));
  expect(text).toContain('"not":{"items":{"const":0}}');
});
