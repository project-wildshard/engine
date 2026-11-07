import { expect, test } from 'vitest';
import { bindQuestTableSpots } from '../../../shared/game/plugin/quests';
import { Flags, bindInteractionTransitions } from '@wildshard/engine/world/interact/flags';
import type { InteractTable } from '@wildshard/engine/world/interact/types';

test('quest spot intake preflights identity and lends live interaction laws without writes', () => {
  const flags = new Flags('spot-intake', false);
  const table: InteractTable = { external: ['met'], rows: [
    { id: 'handle', kind: 'lever', latch: true, at: { poi: 'world', x: 0, z: 0 }, requires: { all: ['met'] } },
    { id: 'gate', kind: 'door', latch: true, look: 'sluice', w: 2, h: 2, at: { poi: 'world', x: 0, z: 0 }, opensWhen: { all: ['lever:handle'] } },
  ] };
  const handle = { id: 'handle', kind: 'lever', x: 1 }, gate = { id: 'gate', kind: 'door', x: 2 };
  const bound = bindQuestTableSpots(table, [gate, handle], flags);
  const lever = bound.get('handle'), door = bound.get('gate');
  if (lever === undefined || door === undefined) throw new Error('Missing bound quest row');
  expect(lever.spot).toBe(handle); expect(lever.locked()).not.toBeNull();
  flags.set('met'); expect(lever.locked()).toBeNull();
  flags.set('lever:handle'); expect(door.d.kind === 'door' && door.d.opensWhen?.all).toContain('lever:handle');
  expect([...bound.values()].map(row => row.d.id)).toEqual(table.rows.map(row => row.id));
  const pickup: InteractTable = { external: ['open:gate'], rows: [{ id: 'glass', kind: 'pickup', look: 'seaglass', label: 'Glass',
    at: { poi: 'world', x: 0, z: 0 }, touch: true, item: 'glass', showWhen: { all: ['open:gate'] } }] };
  const captured = { id: 'glass', kind: 'pickup', x: 3 }, grant: string[] = [];
  const take = bindQuestTableSpots(pickup, [captured], flags);
  const transitions = bindInteractionTransitions([...take.values(), door], flags, { touch: 'direct',
    touched: row => row.spot === captured, commit: () => { throw new Error('Direct pickup must not invoke another command owner'); },
    item: id => { grant.push(id); } });
  transitions.step([...take.values()]); expect(grant).toEqual([]);
  transitions.latch(door); transitions.step([...take.values()]);
  expect(flags.has('open:gate')).toBe(true); expect(flags.has('taken:glass')).toBe(true); expect(grant).toEqual(['glass']);
  transitions.step([...take.values()]); expect(grant).toEqual(['glass']); // Repeated frames never duplicate a pickup.
  const before = flags.all;
  expect(() => bindQuestTableSpots(table, [gate, handle], flags, { ordered: true })).toThrow();
  expect(() => bindQuestTableSpots(table, [handle, { ...gate, id: 'unknown' }], flags)).toThrow();
  expect(() => bindQuestTableSpots(table, [handle, { ...gate, kind: 'key' }], flags)).toThrow();
  expect(() => bindQuestTableSpots(table, [handle, handle], flags)).toThrow();
  expect(() => bindQuestTableSpots(table, [handle], flags)).toThrow();
  expect(() => bindQuestTableSpots(table, [handle, gate], flags, { rows: 1 })).toThrow();
  expect(() => bindQuestTableSpots({ ...table, rows: [table.rows[0], table.rows[0]].filter(row => row !== undefined) }, [handle, gate], flags)).toThrow();
  const chest: InteractTable = { external: [], rows: [{ id: 'chest', kind: 'chest', at: { poi: 'world', x: 0, z: 0 }, contents: [{ item: 'coin' }] }] };
  expect(() => bindQuestTableSpots(chest, [{ id: 'chest', kind: 'chest' }], flags, { items: 0 })).toThrow();
  expect(flags.all).toEqual(before);
});
