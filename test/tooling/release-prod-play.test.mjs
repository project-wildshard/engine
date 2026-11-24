import { describe, expect, test } from 'vitest';
import { PRODUCTION_PLAY_TICKS, replayProductionHeads } from '../../scripts/release-prod-play.ts';

const old = { slug: 'old-cell', revision: 2, hash: 'a'.repeat(64) };
const other = { slug: 'other-cell', revision: 1, hash: 'b'.repeat(64) };

describe('production release play preflight', () => {
  test('a cookable head that refuses at room boot still holds the release', async () => {
    const visited = [];
    const rows = await replayProductionHeads([old, other], async head => {
      visited.push(head.slug);
      if (head === old) throw new Error('The built shard has no section server/plan');
      return PRODUCTION_PLAY_TICKS;
    });
    expect(visited).toEqual([old.slug, other.slug]);
    expect(rows).toEqual([
      { ...old, pass: false, reason: 'The built shard has no section server/plan' },
      { ...other, pass: true, ticks: PRODUCTION_PLAY_TICKS },
    ]);
  });

  test('an empty catalogue and a no-op tick loop cannot pass', async () => {
    await expect(replayProductionHeads([], async () => PRODUCTION_PLAY_TICKS)).rejects.toThrow('nonempty');
    const [row] = await replayProductionHeads([old], async () => 0);
    expect(row).toMatchObject({ pass: false, reason: 'Room advanced 0 ticks; expected 600' });
  });
});
