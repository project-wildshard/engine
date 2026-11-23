// @vitest-environment happy-dom
// SHARD-COMPAT CP6 (Q10): a shard without `ui/completion` plays with the engine's default card. Installed the way the page
// installs a declared one, it opens once the shard's last tracked quest completes, with its menu row.
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { Flags } from '@wildshard/engine/world/interact/flags';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { completeEntry } from './ShardComplete';
import { installShards } from '../shard/list';
import type { CompletionContext } from './declared';
import { defaultCompletionRows } from '../../../shared/game/quest/defaultCard';
import { installCellCompletion } from '../grid/dataCellCompletion';

afterEach(() => { document.body.replaceChildren(); });

test('the default card opens on the last quest, with its menu row', () => {
  installShards([]);
  const rows = defaultCompletionRows('meadow', 'Meadow', [{ id: 'gather', completeFlag: 'gather.done' }, { id: 'return', completeFlag: 'return.done' }]);
  if (rows === undefined) throw new Error('a shard with quests gets a default card');
  const source = { identity: { slug: 'meadow', revision: 1 } } as unknown as Shardfile;
  const systems: SystemSpec[] = [], stay = new Scope('complete.default.meadow'), book = new Flags('meadow', false);
  const player = { position: { x: 0, z: 0 }, velocity: { set: () => undefined }, carried: false };
  const play = { weapons: { visible: true }, audio: { worldMuted: false }, hud: { toast: () => undefined }, animals: { animals: [] } };
  const game = { runtime: { world: { player }, play } } as unknown as CompletionContext['game'];
  const card = installCellCompletion(source, rows, stay, book, { context: { system: (spec) => { systems.push(spec); }, game }, progress: undefined });
  const frame = (t: number): void => { for (const system of systems) system.run(1 / 60, t); };
  book.set('gather.done');
  frame(1);
  expect(card.up).toBe(false);
  book.set('return.done');
  expect(completeEntry()?.label).toBe('Meadow complete');
  frame(2);
  expect(card.up).toBe(true);
  expect(book.has('engine.completion.meadow.seen')).toBe(true);
  stay.dispose();
});
