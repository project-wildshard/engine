// @vitest-environment node
// TEMPLATE-E2E TC-E8: a grid data cell's talks. On staging (v0.1.28, serial 92) Brasscap's sheriff and poster and Mossgate's
// Lamplighter and hermit had no prompt inside the grid: a copy offered only its interactions. While the feet stand in the copy
// its talks join its prompts in its frame, open on the node the cell's server says, answer that server, and leave with the stay.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { Group } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { DialogueChoice } from '@wildshard/engine/quest/view/ui';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { talkStandIns, type TalkBox } from '../shardfile/declaredTalks';
import { wirePage } from '../shardfile/wirePage';
import { talkChoice, talkLine } from '../../../shared/game/shardfile/talks';
import { copyPrompts } from './copyPrompts';
import { PLAY_INSTALLS, hasTalks, installPlay } from '../shardfile/playInstalls';
import { cellPlayPort } from './dataCellPlay';

type Tree = Shardfile['quests']['dialogue'][number];
type Talk = NonNullable<Shardfile['targets']['talks']>[number];
const { dialogue, talk } = JSON.parse(readFileSync('test/fixtures/declared-talk/rows.json', 'utf8')) as { dialogue: Tree; talk: Talk };
const named: Talk = { ...talk, id: `${talk.id}.named`, figure: 'fixture.keeper' };
const door = { id: 'fixture.door', at: [0, 0, 0], radius: 2, label: 'Open the door', scene: 'fixture.door' };
const source = { targets: { panels: [], interactions: [door], talks: [talk, named] }, quests: { flags: [], quests: [], triggers: [], dialogue: [dialogue] } } as unknown as Shardfile;

class Box implements TalkBox {
  shown: { lines: string[]; choices: readonly DialogueChoice[] } | null = null;
  get isOpen(): boolean { return this.shown !== null; }
  open(_name: string, lines: string[], _done: () => void, choices: readonly DialogueChoice[] = []): void { this.shown = { lines, choices }; }
  close(): void { this.shown = null; }
  update(): void { /* shown whole */ }
  offer(choices: readonly DialogueChoice[]): void { if (this.shown !== null) this.shown = { ...this.shown, choices }; }
  pick(index: number): void { const choice = this.shown?.choices[index]; this.shown = null; choice?.pick(); }
}

afterEach(() => { vi.restoreAllMocks(); });

test('a copy with talks joins them to its prompts for the stay, on the cell server\'s node, and answers that server', () => {
  expect(hasTalks(source)).toBe(true);
  expect(hasTalks({ targets: { ...source.targets, talks: [] } })).toBe(false);
  const lines = new Map<string, number>(), sent: string[] = [];
  vi.spyOn(wirePage, 'line').mockImplementation((name) => lines.get(name) ?? 0);
  vi.spyOn(wirePage, 'send').mockImplementation((id) => { sent.push(id); });
  const prompts: Interactable[] = copyPrompts(source), box = new Box(), systems: SystemSpec[] = [], scope = new Scope('grid.data-talks.fixture');
  let here = true;
  const feet = { x: talk.at[0], z: talk.at[2] };
  let exposed: { talks: () => { readonly node: string | null }[] } | null = null;
  installPlay(source, cellPlayPort(scope, () => here, { prompts, feet: () => feet, system: (spec) => { systems.push(spec); }, views: { talkBox: () => box },
    expose: (_name, value) => { exposed = value as typeof exposed; } }), PLAY_INSTALLS.filter(entry => entry.id === 'talks'));
  const talks = (): { readonly node: string | null }[] => exposed?.talks() ?? [];
  expect(prompts.map((row) => row.label)).toEqual([door.label, talk.label, named.label]);
  const prompt = prompts[1]; if (prompt === undefined) throw new Error('The talk joins the copy\'s prompts');
  expect([prompt.position.x, prompt.position.z]).toEqual([talk.at[0], talk.at[2]]); // the copy's own frame
  expect(prompt.radius).toBe(0); // the cell's server has said no node yet
  lines.set(talkLine(dialogue.id), 1);
  expect(prompt.radius).toBe(talk.radius);
  expect(talks()[0]?.node).toBe(dialogue.nodes[0]?.id);
  here = false; // mid-crossing the wire is another cell's: no node, no prompt
  expect(prompt.radius).toBe(0);
  here = true;
  prompt.onInteract();
  expect(box.shown?.lines).toEqual(dialogue.nodes[0]?.lines);
  box.pick(0);
  expect(sent).toEqual([talkChoice(0, 0, 0)]);
  for (const system of systems) system.run(1 / 60, 0);
  // walking off the cell's talk closes it, as on a one-shard page
  lines.set(talkLine(dialogue.id), 2); feet.x += 50;
  for (const system of systems) system.run(1 / 60, 0);
  expect(box.isOpen).toBe(false);
  scope.dispose();
  expect(prompts.map((row) => row.label)).toEqual([door.label]); // the stay is over: only the copy's own prompts remain
});

test('a cell\'s figure-less talks stand in its render root once each; a named figure is the cell\'s own', () => {
  const root = new Group(), scope = new Scope('grid.tiles');
  talkStandIns(source, root, scope);
  talkStandIns(source, root, scope); // a second admission of the same cell adds none
  expect(root.children.map((child) => child.name)).toEqual([`talk:${talk.id}`]);
  expect(root.children[0]?.position.toArray()).toEqual(talk.at);
  scope.dispose();
  expect(root.children).toHaveLength(0);
});
