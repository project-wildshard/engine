import { describe, expect, test } from 'vitest';
import { openWorldAdapter } from '../src/server/host/openWorld';
import { nativeCell } from '../src/server/host/standalone/cellWorld';
import { loadOpenWorldInput, openWorldPins } from './fixtures/engine-lift/openWorld';

// A saved room world continues identically: the bake worker and a shard's CI resume a native world from the adapter's commit,
// and every byte of the next steps (the physics included) matches the world that never stopped.
describe('open world: a saved world continues identically through the tick adapter', { concurrent: false }, () => {
  for (const slug of openWorldPins) test(slug, async () => {
    const input = await loadOpenWorldInput(slug);
    if (!nativeCell(input)) return;
    const control = await openWorldAdapter(input);
    try {
      for (let tick = 0; tick < 60; tick++) control.step([{ kind: 'player', moveX: 0, moveZ: -1, yaw: 0, commandVersion: 1 }]);
      const resumed = await openWorldAdapter(input, control.commit().snapshot);
      try {
        for (let tick = 0; tick < 3; tick++) {
          const commands = [{ kind: 'player' as const, moveX: 0, moveZ: -1, yaw: 0, commandVersion: 1 as const }];
          control.step(commands); resumed.step(commands);
          expect(resumed.commit(), `${slug}: tick ${tick} after the resume`).toEqual(control.commit());
        }
      } finally { resumed.dispose(); }
    } finally { control.dispose(); }
  }, 180_000);
});
