import { expect, expectTypeOf, test } from 'vitest';
import { ARENA_VIEW, arenaChainTell, type AuthorViewProgramRows } from '../src/sharddev/arenaView';
import { ELITE_VIEW_FIELDS, eliteViewSource, eliteViewTell } from '../src/sharddev/eliteEntryRows';
import type { SceneEffectField } from '../src/sharddev/worldScenes';
import { ARENA_VIEW as nativeArena, arenaChainTell as nativeChain } from '@wildshard/format/arenaView';
import { ELITE_VIEW_FIELDS as nativeFields, eliteViewSource as nativeSource, eliteViewTell as nativeTell } from '@wildshard/format/eliteFeature';
import type { ViewProgramRows } from '@wildshard/format/viewProgram';
import type { EffectFieldRow } from '../src/client/engine/fx/effectField';
import { viewAuthorObservation } from './fixtures/view-author-observation';
import original from './fixtures/view-author-original.json' with { type: 'json' };

test('view declarations and fire fields retain complete native contracts and metadata identity', () => {
  expectTypeOf<AuthorViewProgramRows>().toEqualTypeOf<ViewProgramRows>();
  expectTypeOf<SceneEffectField>().toEqualTypeOf<EffectFieldRow>();
  expectTypeOf<typeof ELITE_VIEW_FIELDS>().toEqualTypeOf<typeof nativeFields>();
  expect(ARENA_VIEW).toBe(nativeArena); expect(ELITE_VIEW_FIELDS).toBe(nativeFields);
  for (const index of [-1, 0, 1, 19, 1.25, Number.NaN, Infinity]) expect(arenaChainTell(index)).toBe(nativeChain(index));
  for (const elite of ['', 'qara-batyr', 'another.elite']) {
    expect(eliteViewSource(elite)).toBe(nativeSource(elite)); expect(eliteViewTell(elite)).toBe(nativeTell(elite));
  }
});

test('complete Titan, elite and four fire-profile wires retain every original field and order', () => {
  expect(viewAuthorObservation()).toEqual(original);
});
