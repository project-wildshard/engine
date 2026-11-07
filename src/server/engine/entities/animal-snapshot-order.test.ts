import { expect, test } from 'vitest';
import { AnimalSim } from '../../../shared/engine/entities/AnimalSim';

test('creature snapshots retain their bytes after admitted modifier key reordering', () => {
  const actor = () => new AnimalSim({ kind: 'fixture', label: 'Fixture', variant: 'plain', rarity: 'common', hp: 40, aggressive: false,
    dims: { bodyY: .5, bodyHalfLen: .5, bodyRadius: .2, headRadius: .1, legLen: .3, feet: [], halfWidth: .2 },
    // Canonical product JSON orders these keys differently from the snapshot decoder.
    mods: { chargeDamage: 20, chargeDist: 1.2, damageTaken: .8, relentless: false, speed: 1.1 } },
  7, 1, 'fixture.1', { heightAt: () => 0, random: () => .5 });
  const original = actor(), restored = actor(), saved = original.snapshot();
  restored.restore({ ...saved, mods: { speed: 1.1, chargeDist: 1.2, damageTaken: .8, chargeDamage: 20, relentless: false } });
  expect(JSON.stringify(restored.snapshot())).toBe(JSON.stringify(saved));
  expect(restored.mods).toEqual(original.mods);
});
