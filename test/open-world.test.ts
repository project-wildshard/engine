import { describe, expect, test } from 'vitest';
import { installedKeys } from '../src/server/game/shardfile/installedSides';
import { openWorld, openWorldAdapter } from '../src/server/host/openWorld';
import { loadOpenWorldInput, openWorldPins } from './fixtures/engine-lift/openWorld';

// SERVER-PARITY HS1 (meta docs/plans/SERVER-PARITY-PLAN.md): one world-build entry. Every pinned product boots as a room
// (`openWorld(input, { room: true })`, a dedicated room's own call) and, a native world, through the headless tick adapter a
// shard's CI journeys and the bake worker run; both hosts carry the same fixed-step owners and server halves. Before HS1 the adapter booted the bare
// resident: no chapters, doors, discoveries or owned book, so Nalati's taming journey installed its chapters by hand.
describe('open world: the room and the tick adapter step the same owners', { concurrent: false }, () => {
  for (const slug of openWorldPins) test(slug, async () => {
    const input = await loadOpenWorldInput(slug);
    const room = await openWorld(input, { room: true });
    try {
      const owners = room.host.stepIds();
      if (room.resident === undefined) { await expect(openWorldAdapter(input), `${slug}: a data cell`).rejects.toThrow('native world'); return; }
      const adapter = await openWorldAdapter(input);
      try {
        expect(adapter.host.stepIds(), `${slug}: the tick adapter`).toEqual(owners);
        expect([...installedKeys(adapter.host)].sort(), `${slug}: the tick adapter's server halves`).toEqual([...installedKeys(room.host)].sort());
        // the adapter steps: a CI journey ticks this world, and its lead's fall floor is the room's
        for (let tick = 0; tick < 3; tick++) adapter.step([]);
        expect(adapter.commit().tick).toBe(3);
      } finally { adapter.dispose(); }
    } finally { room.dispose(); }
  }, 180_000);
});

test('Nalati\'s tick adapter runs its story on the server with no hand-installed chapters', async () => {
  const adapter = await openWorldAdapter(await loadOpenWorldInput('nalati-grasslands'));
  try { expect(installedKeys(adapter.host).has('saves'), 'serverChapters registered its feat counts and bond').toBe(true); } finally { adapter.dispose(); }
}, 180_000);
