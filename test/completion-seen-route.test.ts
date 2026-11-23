// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { questBooks } from '../src/shared/engine/quest/players';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { completionCardRows } from '../src/server/game/quest/completionSeen';

// meta QA 2026-11-22 (mini-zoneclose, 21:50 Cancún): a completion card writes its seen flag on the page, the page sends it as
// `story:<flag>`, and only the chapters answered `story`, for a flag a nearby talk sets. The server dropped it, the page's
// write lapsed, and the card opened again on every entry. The server now takes a card's seen flag from the player who holds
// its done flag, as that player's own.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
function shard() {
  const source = emptyShardfile({ slug: 'seen-cell', name: 'Seen cell', author: 'Test', seed: 7, revision: 1 });
  source.quests.flags = ['trail.walked', 'trail.done'];
  source.quests.quests = [{ id: 'trail', title: 'Walk the trail', completeFlag: 'trail.done', steps: [{ id: 'walk', objective: 'Walk', done: { all: ['trail.walked'] } }] }] as never;
  return source;
}
const SEEN = 'engine.completion.seen-cell.seen';
const story = (player: string, flag: string, seq: number) => ({ player, client: 1, command: null, acts: [{ kind: 'interact', seq, id: `story:${flag}` }] }) as never;

test('a card\'s seen flag is taken from the player who holds its done flag, and is theirs alone', async () => {
  const cell = await openCellWorld({ instance: 'seen-cell' }, { shard: shard(), assets: new Map(), sections: new Map(), rapier: await rapier } as never,
    undefined, { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
  try {
    const { host } = cell, lead = [...host.players.values()][0];
    if (lead === undefined) throw new Error('No lead seat');
    const book = questBooks(host).of(lead.id);
    cell.step([story(lead.id, SEEN, 1)]);
    expect(book.flags.has(SEEN)).toBe(false); // not done yet: the card has not opened
    book.flags.set('trail.done');
    cell.step([story(lead.id, SEEN, 2)]);
    expect(book.flags.has(SEEN)).toBe(true);
    // the player's own, not the world's: another player's book keeps its own copy
    expect(questBooks(host).personal(SEEN)).toBe(true);
    cell.step([story(lead.id, 'engine.completion.other.seen', 3)]);
    expect(book.flags.has('engine.completion.other.seen')).toBe(false);
  } finally { cell.dispose(); }
});

test('a declared card\'s rows win over the default card', () => {
  const declared = { doneFlag: 'mossgate.complete', seenFlag: 'mossgate.complete.seen' };
  const product = { has: (name: string) => name === 'ui/completion', section: () => declared };
  expect(completionCardRows(product as never, shard())).toMatchObject({ doneFlag: 'mossgate.complete', seenFlag: 'mossgate.complete.seen' });
  expect(completionCardRows(undefined, shard())).toMatchObject({ doneFlag: 'trail.done', seenFlag: SEEN });
  expect(completionCardRows(undefined, emptyShardfile({ slug: 'bare', name: 'Bare', author: 'Test', seed: 1, revision: 1 }))).toBeUndefined();
});
