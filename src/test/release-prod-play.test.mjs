import { describe, expect, test } from 'vitest';
import { PRODUCTION_PLAY_TICKS, replayProductionHeads } from '../scripts/release-prod-play.ts';

const old = { slug: 'old-cell', uploadNumber: 2, hash: 'a'.repeat(64) };
const other = { slug: 'other-cell', uploadNumber: 1, hash: 'b'.repeat(64) };
const brasscap = { slug: 'brasscap-mesa', uploadNumber: 17, hash: 'c'.repeat(64) };
const build = 'd'.repeat(40);
const cell = { ...brasscap, instance: 'blender-template', cell: [-1, -1] };

function cookIndex(head, engine = build) {
  return { ...head, build: engine, check: { pass: true },
    manifests: [{ tier: 'phone', set: 'entry' }, { tier: 'desktop', set: 'entry' }] };
}

describe('production release play preflight', () => {
  test('a proposed hidden head holds on a missing exact index even when every advertised head plays', async () => {
    const played = [];
    const rows = await replayProductionHeads([old], async head => {
      played.push(head.slug);
      return PRODUCTION_PLAY_TICKS;
    }, { build, cells: [cell], readIndex: async () => { throw new Error('Cook index answered HTTP 404'); } });
    expect(played).toEqual([old.slug]);
    expect(rows).toMatchObject([
      { ...old, pass: true, ticks: PRODUCTION_PLAY_TICKS },
      { ...brasscap, pass: false, reason: 'Cook index answered HTTP 404' },
    ]);
  });

  test('a changed head still plays alongside its advertised uploadNumber and needs an exact index', async () => {
    const kept = { ...brasscap, uploadNumber: 16, hash: 'e'.repeat(64) };
    const rows = await replayProductionHeads([kept], async () => PRODUCTION_PLAY_TICKS, {
      build, cells: [cell], readIndex: async head => cookIndex(head, 'f'.repeat(40)),
    });
    expect(rows).toMatchObject([
      { ...kept, pass: true, ticks: PRODUCTION_PLAY_TICKS },
      { ...brasscap, pass: false, reason: 'Cook index: another build or head' },
    ]);
    const played = [];
    const accepted = await replayProductionHeads([kept], async head => {
      played.push(head.uploadNumber);
      return PRODUCTION_PLAY_TICKS;
    }, { build, cells: [cell], readIndex: async head => cookIndex(head) });
    expect(played).toEqual([16, 17]);
    expect(accepted.every(row => row.pass && row.ticks === PRODUCTION_PLAY_TICKS)).toBe(true);
  });

  test('a status-only change checks the index and still requires 600 ticks', async () => {
    let indexed = 0;
    const rows = await replayProductionHeads([brasscap], async () => PRODUCTION_PLAY_TICKS - 1, {
      build, cells: [cell], readIndex: async head => { indexed++; return cookIndex(head); },
    });
    expect(indexed).toBe(1);
    expect(rows).toMatchObject([{ ...brasscap, pass: false, reason: 'Room advanced 599 ticks; expected 600' }]);
  });

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
