import { expect, test } from 'vitest';
import { CompendiumRules } from '../src/shared/game/compendium/rules';
import * as v from 'valibot';
import { JournalRowSchema } from '@wildshard/format/compendiumRows';
import { declaredCompendium } from '../src/shared/game/shard/declaredRows';
import { emptyShardfile } from '../src/shared/host/author';
import { PINE_JOURNAL as journalRows } from './fixtures/pine-program';

const row = v.parse(JournalRowSchema, journalRows.row);
const PINE_HOLLOW_COMPENDIUM = declaredCompendium(row, emptyShardfile({slug:'journal-test',name:'Journal',author:'Test',revision:1,seed:1}).rows, row.chunkId, hash => `https://test.invalid/${hash}.webp`);

test('authored journal pages retain elite matching and place discovery on the shared host', () => {
  const journal = new CompendiumRules(PINE_HOLLOW_COMPENDIUM);
  journal.animalKilled('deer', 'ghost', 110);
  expect(journal.state('ghost-stag')).toBe('taken');
  expect(journal.state('red-deer')).toBe('unknown');
  expect(journal.entry('ghost-stag')?.plate.model).toEqual({ id: 'deer', variant: 'ghost' });
  journal.placeVisited('pond');
  expect(journal.state('pond')).toBe('seen');
  expect(journal.take('pond')).toBe(false);
  const restored = new CompendiumRules(PINE_HOLLOW_COMPENDIUM);
  restored.restore(journal.snapshot());
  expect(restored.count('elites', 'taken')).toBe(1);
  expect(restored.count('places', 'seen')).toBe(1);
});
