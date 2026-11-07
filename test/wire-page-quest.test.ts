import { expect, test, vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import type { DecodedFrame } from '../src/shared/engine/net/frame';
import type { Transport } from '../src/shared/engine/net/transport';
import type { QuestDef } from '../src/shared/engine/quest/core';
import type { QuestProgress } from '../src/shared/engine/quest/progress';
import { WirePage } from '../src/client/game/shardfile/wirePage';

// Flip checklist 9: a client's quest rows go with the cell it leaves, and come back with the first frame of the cell it returns
// to. A started quest it comes back to is where things stand, so the page must not hear it as "New quest".
const def: QuestDef = { id: 'sealed-ring', title: 'The Sealed Ring', completeFlag: 'done', steps: [{ id: 'find', objective: 'Find it', done: { all: ['found'] } }, { id: 'open', objective: 'Open it', done: { all: ['opened'] } }] };
const silent: Transport = { send: () => undefined, close: () => undefined, onMessage: () => () => undefined, onClose: () => () => undefined, stats: { rttMs: 0, lossPct: 0, sentBytes: 0, recvBytes: 0 } };
const at = (tick: number, cell: number): DecodedFrame => ({ tick, baselineTick: -1, cell, lastSeq: 0, owner: new Float64Array(0), rows: new Map(), ride: null, fresh: new Set() });
const row = (step: string): QuestProgress => ({ quest: def.id, started: true, step, n: 0 });
function seat(): { page: WirePage; client: NetClient; steps: ReturnType<typeof vi.fn> } {
  const page = new WirePage(), client = new NetClient(silent);
  page.bind(client, () => undefined, () => undefined, () => false);
  const steps = vi.fn();
  page.quest(def).observe({ step: () => { steps(); } });
  return { page, client, steps };
}

test('a crossing back into a cell with a started quest tells nobody', () => {
  const { page, client, steps } = seat();
  client.latest = at(2, 1); client.quests.set(def.id, row('find'));
  page.frame(null, true); page.frame(null, true);
  // to the road, where the rows go with the cell
  client.quests.clear(); client.latest = at(4, 0);
  page.frame(null, true); page.frame(null, true);
  // and back: the same step, heard again
  client.quests.set(def.id, row('find')); client.latest = at(6, 1);
  page.frame(null, true); page.frame(null, true);
  expect(steps).not.toHaveBeenCalled();
});

test('a first entry to a cell whose quest began in a save tells nobody', () => {
  const { page, client, steps } = seat();
  client.latest = at(2, 0);
  page.frame(null, true); page.frame(null, true);
  client.quests.set(def.id, row('open')); client.latest = at(4, 2);
  page.frame(null, true); page.frame(null, true);
  expect(steps).not.toHaveBeenCalled();
});

test('a quest that starts after the world opened is news', () => {
  const { page, client, steps } = seat();
  client.latest = at(2, 1);
  page.frame(null, true);
  client.quests.set(def.id, row('find')); client.latest = at(4, 1);
  page.frame(null, true);
  expect(steps).toHaveBeenCalledOnce();
});
