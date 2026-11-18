// @vitest-environment node
// SHARD-SOURCE SS-GP1: a grid data cell's quests. A one-shard page builds a quest's state and presentation for each declared
// quest (`client.ts`, `installDeclaredQuests`); a grid copy installed its talks (`dataCellTalks.ts`) but no quest, so a talk
// could start a quest the grid never tracked. While the feet stand in the copy its quests follow the cell server's flags and
// rows, their chip shows only while the wire is this cell's, and they leave with the stay.
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
import type { QuestState } from '@wildshard/engine/quest/core';
import { Flags } from '@wildshard/engine/world/interact/flags';
import type { QuestProgress } from '@wildshard/engine/quest/progress';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { QuestPresentationOptions } from '../plugin/ui';
import { wirePage } from '../shardfile/wirePage';
import { hasQuests } from '../shardfile/declaredQuests';
import { installCellQuests } from './dataCellQuests';

const SLUG = 'fixture-copy';
const lamp = {
  id: 'fixture.lamp', title: 'Light the lamp', completeFlag: 'lamp.done', startWhen: { all: ['lamp.start'] },
  steps: [
    { id: 'find', objective: 'Find the oil', chip: 'Find oil', done: { all: ['lamp.oil'] } },
    { id: 'light', objective: 'Light the lamp', chip: 'Light lamp', done: { all: ['lamp.lit'] } },
  ],
};
const quiet = { ...lamp, id: 'fixture.quiet', title: 'Quiet', completeFlag: 'quiet.done', track: false };
const source = { identity: { slug: SLUG, revision: 1 }, quests: { flags: [], quests: [lamp, quiet], triggers: [], dialogue: [] } } as unknown as Shardfile;

/** The cell server's word, as a client holds it: its frame, its flags and this player's quest rows. */
class Wire {
  tick = 1; readonly cell = 3;
  readonly quests = new Map<string, QuestProgress>();
  readonly raised = new Set<string>();
  readonly phased = new Set<string>();
  readonly owned = new Map<string, number>(); readonly ownedVersion = 0;
  get latest(): { tick: number; cell: number } { return { tick: this.tick, cell: this.cell }; }
  flags(): Iterable<string> { return this.raised; }
  stateField(): undefined { return undefined; }
}

afterEach(() => { wirePage.unbind(); wirePage.following = false; Flags.made = null; });

test('a copy with quests follows the cell server for the stay, its chip only while the wire is this cell\'s', () => {
  expect(hasQuests(source)).toBe(true);
  expect(hasQuests({ quests: { ...source.quests, quests: [] } })).toBe(false);
  wirePage.followBooks();
  const wire = new Wire();
  wirePage.client = wire as unknown as NetClient;
  const presented: { quest: QuestState; options: QuestPresentationOptions }[] = [], stay = new Scope('grid.data-quests.fixture');
  let here = true;
  const frame = (): void => { wire.tick++; wirePage.frame(here ? SLUG : null, here); };
  installCellQuests(source, stay, () => here, { present: (quest, options) => { presented.push({ quest, options }); } });
  expect(presented.map(row => row.quest.def.id)).toEqual([lamp.id, quiet.id]);
  const shown = presented[0], hidden = presented[1];
  if (shown === undefined || hidden === undefined) throw new Error('Each declared quest is presented');
  const chip = (): string => shown.options.chip?.().label ?? 'no chip';
  frame(); // the cell's first frame: nothing started
  expect(shown.quest.isStarted).toBe(false);
  // a talk on the cell's server starts the quest: its flag and its row
  wire.raised.add('lamp.start'); wire.quests.set(lamp.id, { quest: lamp.id, started: true, step: 'find', n: 0 });
  frame();
  expect(shown.quest.current?.id).toBe('find');
  expect(chip()).toContain('Find oil');
  expect(hidden.options.chip?.()).toEqual({ label: '', count: '' }); // `track: false` keeps its chip blank
  // a gate the cell's server raises advances it
  wire.raised.add('lamp.oil'); wire.quests.set(lamp.id, { quest: lamp.id, started: true, step: 'light', n: 0 });
  frame();
  expect(shown.quest.current?.id).toBe('light');
  expect(chip()).toContain('Light lamp');
  // mid-crossing the wire is another cell's: no chip, and its flags are not this quest's
  here = false;
  wire.raised.add('lamp.lit'); frame();
  expect(chip()).toBe('');
  expect(shown.quest.current?.id).toBe('light');
  here = true; frame();
  expect(shown.quest.isComplete || shown.quest.current === null).toBe(true);
  // leaving the copy ends the stay: the quest no longer follows the wire
  stay.dispose();
  wire.raised.clear(); frame();
  expect(shown.quest.isStarted).toBe(true);
});

test('a stay that starts once the cell\'s wire has settled reads where its quests stand at once', () => {
  wirePage.followBooks();
  const wire = new Wire();
  wirePage.client = wire as unknown as NetClient;
  wire.raised.add('lamp.start'); wire.raised.add('lamp.oil');
  wirePage.frame(SLUG, true); // the cell's first frame came before the feet did
  const presented: QuestState[] = [], stay = new Scope('grid.data-quests.fixture');
  installCellQuests(source, stay, () => true, { present: (quest) => { presented.push(quest); } });
  expect(presented[0]?.current?.id).toBe('light'); // no empty book that would read a finished step as news
  stay.dispose();
});
