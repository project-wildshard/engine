/** ONE-FORMAT OF27c: Pine's thrall extras, built by sharddev `hullCreature` (look `variants.thrall.parts`, the
 * `boar_thrall` node of `thrall-extras.phone.glb` on the boar's phone rig; fixture from sharddev's hull-look test), load
 * on the skin path as two mapped part groups beside the hull: each part vertex carries its own colour and rides one bone. */
import { readFileSync } from 'node:fs';
import { MeshStandardMaterial } from 'three';
import { expect, test } from 'vitest';
import { prepareGlbCost } from '@wildshard/format/glbCost';
import type { SkinBinding, SkinRow } from '@wildshard/format/skinData';
import { Scope } from '@wildshard/engine/app/scope';
import { loadSkin } from '../src/client/game/shardfile/skinPlayback';

const glb = new Uint8Array(readFileSync(new URL('./fixtures/hull-parts/pine-boar-thrall.glb', import.meta.url)));
const { row, binding } = JSON.parse(readFileSync(new URL('./fixtures/hull-parts/pine-boar-thrall.skin.json', import.meta.url), 'utf8')) as { row: SkinRow; binding: SkinBinding };

test('a hull skin with rigid parts loads as the hull plus its plain and glowing part groups', async () => {
  await prepareGlbCost();
  const names = Object.keys(binding.materials ?? {});
  expect(names).toEqual(['parts', 'parts.glow']);
  const material = new MeshStandardMaterial(), scope = new Scope('hull-parts-proof');
  const player = await loadSkin(glb, row, binding, material, scope, names);
  try {
    const geometry = player.mesh.geometry, groups = geometry.groups;
    expect(new Set(groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1, 2]));
    expect(Array.isArray(player.mesh.material) ? player.mesh.material.length : 1).toBe(3);
    const colour = geometry.getAttribute('color'), joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const index = geometry.getIndex(); if (index === null) throw new Error('Missing merged skin index');
    for (const group of groups.filter((value) => value.materialIndex !== 0)) {
      const vertex = index.getX(group.start);
      expect(weights.getX(vertex)).toBeCloseTo(1); expect(weights.getY(vertex)).toBeCloseTo(0);
      expect(joints.getX(vertex)).toBeLessThan(row.rig.joints[0]?.length ?? 0);
    }
    // the hull draws white under its own colour map; the parts keep their painted colours
    const hull = index.getX(groups.find((group) => group.materialIndex === 0)?.start ?? 0);
    expect([colour.getX(hull), colour.getY(hull), colour.getZ(hull)]).toEqual([1, 1, 1]);
    const part = index.getX(groups.find((group) => group.materialIndex === 1)?.start ?? 0);
    expect([colour.getX(part), colour.getY(part), colour.getZ(part)]).not.toEqual([1, 1, 1]);
  } finally { player.dispose(); material.dispose(); scope.dispose(); }
});
