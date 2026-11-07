import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { QuestState } from '@wildshard/engine/quest/core';
import { boundQuestServices, boundQuestState, findBoundQuestState, installBoundQuestFlags, publishBoundQuest, publishQuestFacts } from '../../../shared/game/quest/boundState';

test('retiring a quest entry refuses late publication without disturbing the next entry', () => {
  const retired = new Scope('old-quest-entry'), active = new Scope('new-quest-entry');
  const facts = Object.assign(() => { throw new Error('No fact is emitted by owner lookup'); },
    { flush: () => true, achievement: () => undefined });
  const def = { id: 'voyage', title: 'Voyage', completeFlag: 'arrived', steps: [] };
  try {
    const oldFlags = installBoundQuestFlags(retired, def.id, 'harbour');
    const oldQuest = new QuestState(def, oldFlags);
    publishBoundQuest(retired, oldQuest); publishQuestFacts(retired, def.id, facts);
    expect(installBoundQuestFlags(retired, def.id, 'harbour')).toBe(oldFlags);
    expect(() => installBoundQuestFlags(retired, def.id, 'other-level')).toThrow('differs');
    expect(boundQuestState(retired, def.id)).toBe(oldQuest);
    expect(boundQuestServices(retired, def.id)).toEqual({ flags: oldFlags, facts });
    const newFlags = installBoundQuestFlags(active, def.id, 'harbour');
    const newQuest = new QuestState(def, newFlags);
    publishBoundQuest(active, newQuest); publishQuestFacts(active, def.id, facts);
    expect(newFlags).not.toBe(oldFlags);

    retired.dispose();
    expect(() => publishBoundQuest(retired, oldQuest)).toThrow('live entry');
    expect(() => publishQuestFacts(retired, def.id, facts)).toThrow('live entry');
    expect(() => installBoundQuestFlags(retired, def.id, 'harbour')).toThrow('live declared owner');
    expect(() => boundQuestState(retired, def.id)).toThrow('not bound');
    expect(() => boundQuestServices(retired, def.id)).toThrow('not bound');
    expect(() => findBoundQuestState(retired, def.id)).toThrow('not bound');
    expect(boundQuestState(active, def.id)).toBe(newQuest);
    expect(boundQuestServices(active, def.id)).toEqual({ flags: newFlags, facts });
  } finally { retired.dispose(); active.dispose(); }
});
