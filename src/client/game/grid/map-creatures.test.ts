import { describe, expect, it } from 'vitest';
import { MapCreatures } from './mapCreatures';

// QA 2026-11-23-b row 7: an online cell's creatures live in its region's manager, not the page's; the minimap shows them.
describe('the minimap creatures (QA 11-23-b row 7)', () => {
  const boar = { kind: 'boar', aggressive: true, alive: true, position: { x: 66, z: -132 } };

  it('shows the entered region\'s boars when the page holds none', () => {
    const seen = new MapCreatures().of([], { animals: [boar], dx: 0, dz: 0 });
    expect(seen.map(a => a.kind)).toEqual(['boar']);
    expect(seen[0]?.aggressive).toBe(true);
  });

  it('moves a neighbour cell\'s creatures into the home frame\'s metres and keeps what the map reads', () => {
    const seen = new MapCreatures().of([], { animals: [boar], dx: 256, dz: -256 });
    expect(seen[0]?.position).toEqual({ x: 322, z: -388 });
    expect(seen[0]).toMatchObject({ kind: 'boar', aggressive: true, alive: true });
    expect(boar.position).toEqual({ x: 66, z: -132 });
  });

  it('keeps the page\'s own creatures and adds the region\'s', () => {
    const deer = { kind: 'deer', position: { x: 1, z: 2 } };
    expect(new MapCreatures().of([deer], { animals: [boar], dx: 0, dz: 0 }).map(a => a.kind)).toEqual(['deer', 'boar']);
    expect(new MapCreatures().of([deer], null)).toEqual([deer]);
  });
});
