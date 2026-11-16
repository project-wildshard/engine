import { expect, test } from 'vitest';
import { FOOT, SPLASH_SLOTS, TELEPORT, WADE_EVERY, WaterSplash, insideOutline, type SplashPool } from './waterSplash';

// Meta SHARD-SOURCE SS6: a mover entering, wading in and leaving a pool throws droplets and rings.

const POND: SplashPool = { id: 'pond', level: 0, outline: [[-5, -5], [5, -5], [5, 5], [-5, 5]] };
const walk = (splash: WaterSplash, from: [number, number], to: [number, number], seconds: number, y = 0): void => {
  const steps = Math.round(seconds * 60);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    splash.update(1 / 60, [{ id: 'player', x: from[0] + (to[0] - from[0]) * t, y, z: from[1] + (to[1] - from[1]) * t }]);
  }
};

test('the outline test and the depth band say who is in the pool', () => {
  expect(insideOutline(POND.outline, 0, 0)).toBe(true);
  expect(insideOutline(POND.outline, 6, 0)).toBe(false);
  const splash = new WaterSplash([POND], { phone: false });
  expect(splash.poolAt(0, -0.5, 0)?.id).toBe('pond');
  expect(splash.poolAt(0, FOOT + 0.1, 0)).toBeNull(); // a bridge or a jump over it
  expect(splash.poolAt(0, -4, 0)).toBeNull();
});

test('walking in throws a burst and a ring; standing still throws nothing more; walking out throws again', () => {
  const splash = new WaterSplash([POND], { phone: false });
  walk(splash, [-8, 0], [-6, 0], 0.5);
  expect(splash.live()).toEqual({ drops: 0, rings: 0 });
  walk(splash, [-6, 0], [-4, 0], 0.2);
  const entered = splash.live();
  expect(entered.drops).toBeGreaterThan(10);
  expect(entered.rings).toBe(1);
  // still for 3 s: the droplets fall back and the ring spreads out
  walk(splash, [-4, 0], [-4, 0], 3);
  expect(splash.live()).toEqual({ drops: 0, rings: 0 });
  walk(splash, [-4, 0], [-7, 0], 0.4);
  expect(splash.live().drops).toBeGreaterThan(5);
  expect(splash.live().rings).toBe(1);
});

test('wading throws a ring every WADE_EVERY seconds; a slow step does not', () => {
  const splash = new WaterSplash([POND], { phone: false });
  walk(splash, [-4, 0], [-4, 0], 0.1); // first seen in the water: nothing
  expect(splash.live().rings).toBe(0);
  walk(splash, [-4, 0], [-4, 3 * 0.3], 3); // 0.3 m/s
  expect(splash.live().rings).toBe(0);
  walk(splash, [-4, 0.9], [3, 0.9], 2); // 3.5 m/s for 2 s: a ring every 0.4 s, each living 1.3 s
  expect(splash.live().rings).toBeGreaterThanOrEqual(3);
  expect(splash.live().rings).toBeLessThanOrEqual(Math.ceil(1.3 / WADE_EVERY));
});

test('wading counts the stretch, not the frame: a step every other frame still rings every WADE_EVERY seconds', () => {
  const splash = new WaterSplash([POND], { phone: false });
  splash.update(1 / 120, [{ id: 'p', x: -4, y: 0, z: 0 }]);
  // 120 Hz display, 60 Hz fixed step: the mover moves 2 m/s on alternate frames only
  let x = -4, rings = 0;
  for (let i = 0; i < 120 * 0.85; i++) { if (i % 2 === 0) x += 2 / 60; splash.update(1 / 120, [{ id: 'p', x, y: 0, z: 0 }]); rings = splash.live().rings; }
  expect(rings).toBe(2);
});

test('a teleport in or out of the water throws nothing; a leave splashes at the last point in the water', () => {
  const splash = new WaterSplash([POND], { phone: false });
  splash.update(1 / 60, [{ id: 'p', x: -20, y: 0, z: 0 }]);
  splash.update(1 / 60, [{ id: 'p', x: 0, y: 0, z: 0 }]); // a respawn into the pond
  splash.update(1 / 60, [{ id: 'p', x: 0, y: 0, z: 20 }]); // and out of it
  expect(splash.live()).toEqual({ drops: 0, rings: 0 });
  expect(TELEPORT).toBe(2);
  splash.update(1 / 60, [{ id: 'q', x: 4.9, y: 0, z: 0 }]);
  splash.update(1 / 60, [{ id: 'q', x: 6.4, y: 0, z: 0 }]); // out by 1.5 m: the ring sits where it left the water
  expect(splash.rings.instanceMatrix.array[12]).toBeCloseTo(4.9, 5); // ring slot 0's x
});

test('the phone holds half the slots, and every splash is two draws whatever the count', () => {
  const desk = new WaterSplash([POND], { phone: false }), phone = new WaterSplash([POND], { phone: true });
  expect(phone.rings.count).toBe(SPLASH_SLOTS.phone.rings);
  expect(phone.drops.geometry.getAttribute('position').count).toBe(SPLASH_SLOTS.phone.drops);
  expect(SPLASH_SLOTS.phone.drops * 2).toBe(SPLASH_SLOTS.desktop.drops);
  expect(SPLASH_SLOTS.phone.rings * 2).toBe(SPLASH_SLOTS.desktop.rings);
  // ten movers splashing at once reuse the same two objects
  const movers = (x: number): { id: string; x: number; y: number; z: number }[] => Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, x, y: 0, z: i - 4.5 }));
  desk.update(1 / 60, movers(-5.5)); desk.update(1 / 60, movers(-4.5));
  expect(desk.live()).toEqual({ drops: 180, rings: 10 });
  // they all step out at once: 100 more droplets, and the oldest slots are reused, never a new draw
  desk.update(1 / 60, movers(-5.5));
  expect(desk.live().drops).toBe(SPLASH_SLOTS.desktop.drops);
  expect(desk.live().rings).toBe(20);
  expect([desk.drops.type, desk.rings.type]).toEqual(['Points', 'Mesh']);
  desk.dispose(); phone.dispose();
});
