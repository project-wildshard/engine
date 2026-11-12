// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Group } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '../src/shared/engine/app/scope';
import type { SystemSpec } from '../src/client/engine/app/systems';
import type { Interactable } from '../src/shared/engine/world/interact/types';
import type { DialogueChoice } from '../src/client/engine/quest/view/ui';
import { installDeclaredTalks, type TalkBox } from '../src/client/game/shardfile/declaredTalks';
import { talkChoice, talkFinish, talkLine } from '../src/shared/game/shardfile/talks';

// TE-ENG3, the page's half: the talk's prompt waits for the server's node, opens its lines and the choices whose conditions hold,
// sends an answer by name and opens the next node at once, and ends the talk only on a node with no choices at all.
type Tree = Shardfile['quests']['dialogue'][number];
type Talk = NonNullable<Shardfile['targets']['talks']>[number];
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is the author's rows, typed as the format reads them.
const { dialogue, talk } = JSON.parse(readFileSync('test/fixtures/declared-talk/rows.json', 'utf8')) as { dialogue: Tree; talk: Talk };
const node = (id: string): number => dialogue.nodes.findIndex(row => row.id === id) + 1;

class Box implements TalkBox {
  shown: { lines: string[]; choices: readonly DialogueChoice[]; done: () => void } | null = null;
  get isOpen(): boolean { return this.shown !== null; }
  open(_name: string, lines: string[], onDone: () => void, choices: readonly DialogueChoice[] = []): void { this.shown = { lines, choices, done: onDone }; }
  close(finished = false): void { const shown = this.shown; this.shown = null; if (finished) shown?.done(); }
  update(): void { /* the page's box types its lines; this one shows them whole */ }
  offer(choices: readonly DialogueChoice[]): void { if (this.shown !== null) this.shown = { ...this.shown, choices }; }
  pick(index: number): void { const choice = this.shown?.choices[index]; this.shown = null; choice?.pick(); }
}
function page(rows: readonly Talk[]) {
  const box = new Box(), sent: string[] = [], flags = new Set<string>(), lines = new Map<string, number>(), interactables: Interactable[] = [], root = new Group(), systems: SystemSpec[] = [];
  const scope = new Scope('talks');
  const talks = installDeclaredTalks({ targets: { panels: [], interactions: [], talks: [...rows] }, quests: { flags: [], quests: [], triggers: [], dialogue: [dialogue] } }, {
    root, scope, interactables, system: spec => { systems.push(spec); }, flags, line: name => lines.get(name) ?? 0, send: id => { sent.push(id); }, box: () => box, player: () => ({ x: talk.at[0], z: talk.at[2] }) });
  const frame = (dt = 1 / 60): void => { for (const system of systems) system.run(dt, 0); };
  return { box, sent, flags, lines, interactables, root, scope, talks, frame };
}
const LINE = talkLine(dialogue.id);

test('the talk: the server\'s node, its choices, an answer by position, the next node once the server says it', () => {
  const { box, sent, flags, lines, interactables, root, scope, talks, frame } = page([talk]);
  const [prompt] = interactables; if (prompt === undefined) throw new Error('The talk adds its prompt');
  expect(root.children).toHaveLength(1); // the stand-in figure, since the row names none
  expect(prompt.position.y).toBeGreaterThan(talk.at[1]);
  expect(prompt.radius).toBe(0); // the server has not said a node yet
  lines.set(LINE, node('offer'));
  expect(prompt.radius).toBe(talk.radius);
  expect(talks[0]?.node()).toBe('offer');

  prompt.onInteract();
  expect(box.shown?.lines).toEqual(['The lamp went out.', 'Will you light it?']);
  expect(box.shown?.choices.map(choice => choice.label)).toEqual(['I will.']);
  expect(prompt.radius).toBe(0); // hidden while it talks
  box.pick(0);
  expect(sent).toEqual([talkChoice(0, 0, 0)]);
  frame();
  expect(box.isOpen).toBe(false); // nothing moves until the server says the next node
  expect(prompt.radius).toBe(0);
  // the server's node, with the flag it raised: the waiting node, whose report waits on the lamp
  lines.set(LINE, node('waiting')); flags.add('fixture.keeper.accepted'); frame();
  expect(box.shown?.lines).toEqual(['The lamp is still dark.']);
  expect(box.shown?.choices).toEqual([]);
  // the lamp is lit while the box is open: the box offers the report without reopening
  flags.add('fixture.keeper.lamp'); frame();
  expect(box.shown?.lines).toEqual(['The lamp is still dark.']);
  expect(box.shown?.choices.map(choice => choice.label)).toEqual(['It\'s lit.']);
  box.pick(0);
  lines.set(LINE, node('thanks')); frame();
  expect(box.shown?.lines).toEqual(['Thank you. Take these.']);
  box.close(true); // a node with no choices: read, the talk is over
  expect(sent).toEqual([talkChoice(0, 0, 0), talkChoice(0, 1, 0), talkFinish(0)]);
  lines.set(LINE, dialogue.nodes.length + 1);
  expect(prompt.radius).toBe(0);
  expect(talks[0]?.node()).toBeNull();

  scope.dispose();
  expect(interactables).toHaveLength(0);
  expect(root.children).toHaveLength(0);
});

test('a refused answer moves nothing, and a node whose choices all wait closes without ending the talk', () => {
  const { box, sent, lines, interactables, frame } = page([talk]);
  const [prompt] = interactables; if (prompt === undefined) throw new Error('The talk adds its prompt');
  lines.set(LINE, node('offer'));
  prompt.onInteract(); box.pick(0);
  for (let i = 0; i < 60 * 4; i++) frame(); // the server never moves the node
  expect(box.isOpen).toBe(false);
  expect(prompt.radius).toBe(talk.radius); // the talk is offered again
  lines.set(LINE, node('waiting'));
  prompt.onInteract(); box.close(true);
  expect(sent).toEqual([talkChoice(0, 0, 0)]); // no finish: the waiting node stays
});

test('a talk that names its props figure draws no stand-in', () => {
  const { root } = page([{ ...talk, figure: 'keeper.figure' }]);
  expect(root.children).toHaveLength(0);
});
