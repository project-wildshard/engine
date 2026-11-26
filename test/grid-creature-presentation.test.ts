import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { authoredTargets } from '../src/shared/engine/combat/targets';
import { presentThrough } from '../src/client/game/grid/cellPresentation';
import type { TargetHit, Targets } from '../src/client/engine/combat/types';
import type { Events } from '../src/shared/engine/events/events';
import type { RowBodiesView } from '../src/client/engine/entities/RowBodies';

// QA 11-25 row 86 (b): on the grid a creature hit presented twice and with no number. The cell's weapons settled each blow
// on the page as well as on the server, and nothing on the page heard the cell's creatures.

const passThrough = { ask: (_name: string, value: { hit: TargetHit | null }) => value } as unknown as Events;
const HIT = { animal: {}, point: new Vector3(), distance: 1 } as unknown as TargetHit;

test('a blow on a creature leaves the page while a server owns the player', () => {
  const creatures: Targets = { raycast: () => HIT };
  let linked = true;
  const targets = authoredTargets(passThrough, creatures, () => null, () => !linked);
  expect(targets.raycast(new Vector3(), new Vector3(0, 0, -1), 5)).toBeNull();
  linked = false;
  expect(targets.raycast(new Vector3(), new Vector3(0, 0, -1), 5)).toBe(HIT);
});

test('a practice room keeps its own targets on the wire', () => {
  const room: Targets = { raycast: () => HIT };
  const targets = authoredTargets(passThrough, { raycast: () => null }, () => room, () => false);
  expect(targets.raycast(new Vector3(), new Vector3(0, 0, -1), 5)).toBe(HIT);
});

type Presented = Pick<RowBodiesView, 'onDamage' | 'onOthersHit' | 'onKill' | 'onSound'>;

test('an entered cell\'s creatures present through the page\'s HUD, once each, and stop when it leaves', () => {
  const heard: string[] = [], cell: Presented = { onKill: () => { heard.push('cell kill'); } };
  const page: Presented = {
    onDamage: (_a, amount, point) => { heard.push(`page damage ${String(amount)} at ${String(point.x)}`); },
    onOthersHit: (_a, amount) => { heard.push(`page other ${String(amount)}`); },
    onKill: () => { heard.push('page kill'); },
    onSound: name => { heard.push(`page sound ${name}`); },
  };
  const undo = presentThrough(cell, page, point => point.clone().add(new Vector3(100, 0, 0)));
  const body = {} as Parameters<NonNullable<Presented['onKill']>>[0], at = new Vector3(1, 0, 0);
  cell.onDamage?.(body, 12, at, false, false);
  cell.onOthersHit?.(body, 7, at, false);
  cell.onKill?.(body);
  cell.onSound?.('boar_squeal', at);
  expect(heard).toEqual(['page damage 12 at 101', 'page other 7', 'cell kill', 'page kill', 'page sound boar_squeal']);
  expect(at.x).toBe(1);
  undo();
  heard.length = 0;
  cell.onKill?.(body);
  expect(heard).toEqual(['cell kill']);
  expect(cell.onDamage).toBeUndefined();
});
