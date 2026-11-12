import { afterEach, expect, test } from 'vitest';
import { OTHER_FILL, drawOther, othersOnMap } from './othersOnMap';

// REMOTE-PLAYERS RP3 (Jake, 2026-11-12 17:46: "we should show other players in the minimap"): every other live player in
// the minimap's radius is a marker with their facing; it moves with them and goes when they leave.

/** A body as OtherPlayers keeps it: where its row stands, and its figure's turn (facing +z at 0). */
const body = (x: number, z: number, facing: number) => ({ shown: { x, z }, group: { rotation: { y: facing } } });
afterEach(() => { othersOnMap.update([]); });

test('a marker sits at the other player\'s bearing and turns with their facing', () => {
  // Minimap convention: +Z north (screen up), -X east (screen right); 1 px per metre, the player at (100, 100).
  othersOnMap.update([body(-10, 10, 0), body(0, -20, Math.PI / 2)]);
  const seen = othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110);
  expect(seen).toHaveLength(2);
  const [ne, south] = seen;
  expect(ne?.sx).toBeCloseTo(110); expect(ne?.sy).toBeCloseTo(90);       // north-east: right and up
  expect(south?.sx).toBeCloseTo(100); expect(south?.sy).toBeCloseTo(120); // south: straight down
  // A figure turned 0 faces +z (north): its nose points up; turned a quarter (+x, west), it points left.
  expect(ne?.angle).toBeCloseTo(0);
  expect(Math.sin(south?.angle ?? 0)).toBeCloseTo(-1);
  // They turn 180 degrees: the marker turns with them.
  othersOnMap.update([body(-10, 10, Math.PI), body(0, -20, Math.PI / 2)]);
  expect(Math.cos(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)[0]?.angle ?? 0)).toBeCloseTo(-1);
});

test('a player past the rim draws nothing; one who leaves, or a page whose bodies stopped, is gone', () => {
  othersOnMap.update([body(-10, 10, 0), body(0, 200, 0)]);
  expect(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)).toHaveLength(1);
  othersOnMap.update([body(0, 200, 0)]);
  expect(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)).toHaveLength(0);
  othersOnMap.update([body(-10, 10, 0)]);
  expect(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)).toHaveLength(1);
  // The online world went away (its OtherPlayers no longer runs a frame): 30 minimap reads (frames) later, its marks are stale.
  for (let read = 0; read < 29; read++) expect(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)).toHaveLength(1);
  expect(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)).toHaveLength(0);
  othersOnMap.update([body(-10, 10, 0)]);
  expect(othersOnMap.inView({ x: 0, z: 0 }, 100, 1, 110)).toHaveLength(1);
});

test('the marker is its own colour and shape: not the white arrow, not a yellow or red dot, not a mark\'s diamond', () => {
  const calls: string[] = [], fills: string[] = [];
  const pen = {
    save: () => calls.push('save'), restore: () => calls.push('restore'), translate: () => calls.push('translate'), rotate: () => calls.push('rotate'),
    beginPath: () => calls.push('beginPath'), arc: () => calls.push('arc'), moveTo: () => calls.push('moveTo'), lineTo: () => calls.push('lineTo'),
    closePath: () => calls.push('closePath'), stroke: () => calls.push('stroke'), fill: () => { calls.push('fill'); fills.push(String(pen.fillStyle)); },
    fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, lineJoin: 'miter',
  };
  drawOther(pen as unknown as CanvasRenderingContext2D, 50, 60, 0.3, 3);
  // Minimap.ts: the own arrow is ARROW #ffffff (lines only), creatures are DOT_PASSIVE #ffe066 / DOT_AGGRESSIVE #ff5a4a (arcs only).
  for (const taken of ['#ffffff', '#ffe066', '#ff5a4a']) expect(OTHER_FILL.toLowerCase()).not.toBe(taken);
  expect(fills).toContain(OTHER_FILL);
  // A round body with a nose: an arc and straight edges in one path, which neither the arrow nor a dot nor a diamond is.
  expect(calls).toContain('arc'); expect(calls).toContain('moveTo'); expect(calls).toContain('closePath'); expect(calls).toContain('rotate');
});
