// @vitest-environment happy-dom
// SHARD-SOURCE SS-GP4a: a grid data cell's completion card. A one-shard page installs its declared card when `ui/completion`
// triggers on the quest (`client.ts`, `installCompletion`); a grid copy had none, so the Template's card never opened on a grid
// cell. While the feet stand in the copy the card opens once the cell server's done flag is up, and leaves with the stay.
import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { Flags } from '@wildshard/engine/world/interact/flags';
import type { CompletionRows } from '@wildshard/format/completion';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { completeEntry } from '../complete/ShardComplete';
import { installShards } from '../shard/list';
import type { CompletionContext } from '../complete/declared';
import { cellCompletionRows, installCellCompletion } from './dataCellCompletion';

// the Template's built `ui/completion` section (sdk 0.4.8, `new`)
const rows = { after: [], before: ['main.world'], card: { flavour: [], kicker: 'A first adventure · complete' }, coveredEvents: [], doneFlag: 'template.complete',
  groups: [], maximumTodo: 7, menuSubtitle: 'Your first adventure', more: 'more', pollSeconds: 1, safeRadius: 25, seenFlag: 'template.complete-card', stats: [],
  system: 'game.completion', title: 'Template shard', toastSuffix: ' complete', trigger: 'quest' } as unknown as CompletionRows;
const source = { identity: { slug: 'fixture-copy', revision: 1 } } as unknown as Shardfile;
const folder = (section: CompletionRows | null): Parameters<typeof cellCompletionRows>[0] => ({ has: () => section !== null, section: () => { if (section === null) throw new Error('no section'); return section; } });

afterEach(() => { document.body.replaceChildren(); });

test('a copy\'s card opens on the cell server\'s done flag while entered, with its menu row, and leaves with the stay', () => {
  installShards([]); // the page knows no title for the copy: the card's title is its rows'
  expect(cellCompletionRows(folder(rows))).toBe(rows);
  expect(cellCompletionRows(folder(null))).toBeNull();
  expect(cellCompletionRows(folder({ ...rows, trigger: 'toast' } as unknown as CompletionRows))).toBeNull(); // a toast card is not the grid's
  const systems: SystemSpec[] = [], stay = new Scope('grid.data-completion.fixture'), book = new Flags('fixture-copy', false);
  const player = { position: { x: 0, z: 0 }, velocity: { set: () => undefined }, carried: false };
  const play = { weapons: { visible: true }, audio: { worldMuted: false }, hud: { toast: () => undefined }, animals: { animals: [] } };
  const game = { runtime: { world: { player }, play } } as unknown as CompletionContext['game'];
  const card = installCellCompletion(source, rows, stay, book, { context: { system: (spec) => { systems.push(spec); }, game }, progress: undefined });
  const frame = (t: number): void => { for (const system of systems) system.run(1 / 60, t); };
  expect(systems.map(system => system.id)).toEqual(['game.completion']);
  frame(2);
  expect(card.up).toBe(false); // not done yet
  expect(completeEntry()).toBeNull();
  book.set('template.complete'); // the cell server's quest finished
  expect(completeEntry()?.label).toBe('Template shard complete'); // the pause menu's row
  frame(4);
  expect(card.up).toBe(true);
  expect(book.has('template.complete-card')).toBe(true);
  expect(player.carried).toBe(true);
  // leaving the copy ends the stay: the card closes and the menu row goes
  stay.dispose();
  expect(card.up).toBe(false);
  expect(completeEntry()).toBeNull();
});

test('the card waits for the talk box that set its flag to close (MZ37)', () => {
  installShards([]);
  const systems: SystemSpec[] = [], stay = new Scope('grid.data-completion.fixture'), book = new Flags('fixture-copy', false);
  const player = { position: { x: 0, z: 0 }, velocity: { set: () => undefined }, carried: false };
  const play = { weapons: { visible: true }, audio: { worldMuted: false }, hud: { toast: () => undefined }, animals: { animals: [] } };
  const game = { runtime: { world: { player }, play } } as unknown as CompletionContext['game'];
  const card = installCellCompletion(source, rows, stay, book, { context: { system: (spec) => { systems.push(spec); }, game }, progress: undefined });
  const frame = (t: number): void => { for (const system of systems) system.run(1 / 60, t); };
  const talk = new Scope('ui.dialogue'), root = document.createElement('div');
  document.body.append(root);
  app.ui.push('modal', { root, back: () => undefined }, talk); // the hermit's report, still on screen
  book.set('template.complete');
  frame(2);
  expect(card.up).toBe(false);
  talk.dispose();
  frame(4);
  expect(card.up).toBe(true);
  stay.dispose();
});
