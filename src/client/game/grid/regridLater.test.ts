import { expect, test } from 'vitest';
import { RegridLater } from './regridLater';

// MMO-PLAN GO5b: the door's `resume` names another cell while the grid page still boots, before its session can hand the link over and
// before the app's same-page entry is in place (control). The page waits for both, then enters the seat's cell in place; with no way in
// place in time, or a session that refuses, it takes GO4's reload.
const rig = (): { readonly later: Pick<RegridLater, 'session' | 'entry'> & { readonly ask: (cell: string) => () => void }; readonly reloads: string[]; readonly fire: () => void; readonly armed: () => number } => {
  const reloads: string[] = [];
  let run: (() => void) | null = null, armed = 0;
  const inner = new RegridLater({ waitMs: 45_000, timeout: (_ms, then) => { armed++; run = then; return () => { run = null; }; } });
  const later = { ask: (cell: string): (() => void) => inner.ask(cell, () => { reloads.push(cell); }), session: (here: Parameters<RegridLater['session']>[0]): void => { inner.session(here); }, entry: (): void => { inner.entry(); } };
  return { later, reloads, fire: () => { const then = run; run = null; then?.(); }, armed: () => armed };
};

test('a resume during the boot waits for the session and the same-page entry, then enters in place', () => {
  const { later, reloads, fire } = rig(), entered: string[] = [];
  later.ask('sunscar-dunes');
  later.session(cell => { entered.push(cell); return true; });
  expect(entered, 'no same-page entry yet').toEqual([]);
  later.entry();
  expect(entered).toEqual(['sunscar-dunes']);
  fire();
  expect(reloads, 'the wait ended with the entry').toEqual([]);
});

test('either order: the entry, then the session, then the resume', () => {
  const { later, reloads } = rig(), entered: string[] = [];
  later.entry(); later.session(cell => { entered.push(cell); return true; });
  later.ask('nalati-grasslands');
  expect(entered).toEqual(['nalati-grasslands']);
  expect(reloads).toEqual([]);
});

test('no same-page entry in time: the GO4 reload', () => {
  const { later, reloads, fire } = rig(), entered: string[] = [];
  later.session(cell => { entered.push(cell); return true; });
  later.ask('sunscar-dunes');
  fire();
  expect({ entered, reloads }).toEqual({ entered: [], reloads: ['sunscar-dunes'] });
  later.entry();
  expect(entered, 'a late entry runs nothing').toEqual([]);
});

test('a session that can\'t enter in place (a cell it can\'t open, re-entries spent) reloads at once', () => {
  const { later, reloads } = rig();
  later.entry(); later.session(() => false);
  later.ask('template-2');
  expect(reloads).toEqual(['template-2']);
});

test('a session that ends before the entry hands nothing over; the next one does', () => {
  const { later, reloads } = rig(), entered: string[] = [];
  later.ask('sunscar-dunes');
  later.session(() => { throw new Error('gone'); });
  later.session(null);
  later.session(cell => { entered.push(cell); return true; });
  later.entry();
  expect({ entered, reloads }).toEqual({ entered: ['sunscar-dunes'], reloads: [] });
});

test('a session that throws counts as one that can\'t: the reload', () => {
  const { later, reloads } = rig();
  later.entry(); later.session(() => { throw new Error('gone'); });
  later.ask('sunscar-dunes');
  expect(reloads).toEqual(['sunscar-dunes']);
});

test('a second resume while one waits keeps the newest cell and one timer', () => {
  const { later, armed } = rig(), entered: string[] = [];
  later.ask('sunscar-dunes'); later.ask('nalati-grasslands');
  expect(armed()).toBe(1);
  later.session(cell => { entered.push(cell); return true; }); later.entry();
  expect(entered).toEqual(['nalati-grasslands']);
});

// Review MUST: the boot that asked can go (back to the title mid-load): its ask goes with it, and no later session or timer runs it.
test('a cancelled ask runs nothing: no entry, no reload', () => {
  const { later, reloads, fire } = rig(), entered: string[] = [];
  const cancel = later.ask('sunscar-dunes');
  cancel();
  fire();
  later.session(cell => { entered.push(cell); return true; }); later.entry();
  expect({ entered, reloads }).toEqual({ entered: [], reloads: [] });
});

// Review SHOULD: once GO4's reload has started the page is leaving: a redial's later `resume` starts nothing more.
test('after a reload, a later ask is ignored', () => {
  const { later, reloads, fire } = rig(), entered: string[] = [];
  later.ask('sunscar-dunes'); fire();
  later.session(cell => { entered.push(cell); return true; }); later.entry();
  later.ask('nalati-grasslands');
  expect({ entered, reloads }).toEqual({ entered: [], reloads: ['sunscar-dunes'] });
});
