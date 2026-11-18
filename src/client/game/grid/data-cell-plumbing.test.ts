// @vitest-environment node
// SHARD-SOURCE SS-GP4c: a grid data cell's declared input. A one-shard page installs its `plumbing` input contexts (the keys
// and touch buttons its tools and scenes answer to); a grid copy had none, so the Template's lantern had no L key on a grid
// cell. While the feet stand in the copy its contexts are the page's, live only while the wire is this cell's; an item's
// request goes to the cell server; all of it leaves with the stay.
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { InputService } from '@wildshard/engine/input/InputService';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { hasPlumbing, installCellPlumbing } from './dataCellPlumbing';

// the Template's built `plumbing` (sdk 0.4.8, `new`), plus a bell rung by a scene the server takes as an item request
const plumbing = { debug: [], knobs: [{ desktop: 20, id: 'template.propCount', phone: 10 }], namespace: 'template', input: [
  { actions: [{ id: 'template.lantern.toggle', keys: ['KeyL'], scene: 'template.lantern.toggle' }], id: 'template.lantern', priority: 20,
    touch: { action: 'template.lantern.toggle', icon: '', label: 'LANTERN', slot: 'verb.1' } },
  { actions: [{ id: 'template.bell.ring', keys: ['KeyB'], scene: 'template.bell.ring' }], id: 'template.bell', priority: 21 },
] };
const source = { plumbing,
  items: { rows: [{ kind: 'tool', id: 'tool.lantern', action: 'template.lantern.toggle' }] },
  targets: { itemActions: [{ scene: 'template.lantern.toggle', item: 'tool.lantern', action: 3 }, { scene: 'template.bell.ring', item: 'tool.bell', action: 4 }] } } as unknown as Shardfile;

test('a copy\'s input contexts are the page\'s while entered, live only while the wire is this cell\'s, and leave with the stay', () => {
  expect(hasPlumbing(source)).toBe(true);
  expect(hasPlumbing({ plumbing: null })).toBe(false);
  const home = new Scope('home'), input = new InputService(() => 1), sent: string[] = [], lantern: string[] = [];
  // the kit's lantern binds its own toggle (`installDeclaredItems`); plumbing gives it the key
  input.bind('template.lantern.toggle', () => { lantern.push('toggle'); }, home);
  const stay = new Scope('grid.data-plumbing.fixture');
  let here = true;
  const handles = installCellPlumbing(source, 'template-2', stay, () => here, { input, playing: () => true,
    observation: { mode: 'walk', item: null, flags: [] }, send: (scene) => { sent.push(scene); }, system: () => undefined });
  expect(handles?.contexts.get('template.lantern')).toBe('template-2.template.lantern'); // named for the cell, never the home's
  expect(input.active('template-2.template.lantern')).toBe(true);
  const press = (code: string, at: number): void => {
    input.executeCommand({ kind: 'physical', code, on: true, at }); input.executeCommand({ kind: 'physical', code, on: false, at: at + 0.1 });
  };
  press('KeyL', 1);
  expect(lantern).toEqual(['toggle']); // the lantern's own toggle, not a second scene callback
  press('KeyB', 2);
  expect(sent).toEqual(['template.bell.ring']); // an item request goes to the cell server
  // mid-crossing the wire is another cell's: the copy's keys do nothing
  here = false;
  press('KeyL', 3); press('KeyB', 4);
  expect(lantern).toEqual(['toggle']);
  expect(sent).toEqual(['template.bell.ring']);
  here = true;
  // leaving the copy ends the stay: its contexts are gone
  stay.dispose();
  expect(input.has('template-2.template.lantern')).toBe(false);
  press('KeyL', 5);
  expect(lantern).toEqual(['toggle']);
  home.dispose();
});
