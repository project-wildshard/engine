import { expect, test } from 'vitest';
import { parseCompletion } from '@wildshard/format/completion';
import { defaultCompletionRows } from '../src/client/game/complete/defaultCard';

// SHARD-COMPAT CP6 (Q10): a shard without `ui/completion` is admitted and gets the engine's default card, which opens when
// its last tracked quest completes; a shard with no quest gets none. The rows pass format's own completion schema.
test('the default card opens on the last tracked quest and passes the completion schema', () => {
  const rows = defaultCompletionRows('meadow', 'Meadow', [
    { id: 'first', completeFlag: 'first.done' }, { id: 'last', completeFlag: 'last.done' }, { id: 'side', completeFlag: 'side.done', track: false }]);
  expect(rows).toBeDefined();
  expect(parseCompletion(rows)).toEqual(rows);
  expect(rows).toMatchObject({ doneFlag: 'last.done', trigger: 'quest', title: 'Meadow', seenFlag: 'engine.completion.meadow.seen' });
});

test('untracked quests only still give a card; no quest gives none', () => {
  expect(defaultCompletionRows('cove', 'Cove', [{ id: 'side', completeFlag: 'side.done', track: false }])?.doneFlag).toBe('side.done');
  expect(defaultCompletionRows('empty', 'Empty', [])).toBeUndefined();
});
