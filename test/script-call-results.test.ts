import { expect, test } from 'vitest';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { ScriptHost, type ScriptDisabled } from '../src/shared/engine/script/host';
import { ScriptWorld, type ScriptEffect, type EffectTransaction } from '../src/shared/engine/script/effects';

const bytes=fixtureBytes(new URL('./fixtures/wasm/script-call-results.wasm',import.meta.url));
class RecordingWorld extends ScriptWorld {
  readonly reads: string[] = [];
  constructor() { super({ fields: { 1: [-10, 10] }, archetypes: [], events: [9], maxEntities: 1 },
    [{ id: 1, name: 'real owner', position: [0, 0, 0], fields: { 1: 0 }, frozen: false, interactive: true }]); }
  override prepare(effects: readonly ScriptEffect[], self: number, spawns: number, events: number): EffectTransaction {
    const tx = super.prepare(effects, self, spawns, events), reads = this.reads;
    return { spawns: tx.spawns, get events() { reads.push('events'); return tx.events; }, commit: tx.commit };
  }
}
function fixture() {
  const world = new RecordingWorld(), toasts: string[] = [], disabled: ScriptDisabled[] = [];
  const host = new ScriptHost({ world, query: () => [], development: true, toast: value => { toasts.push(value); }, onDisabled: row => { disabled.push(row); } });
  host.install('real', bytes, 3, 5); return { host, world, toasts, disabled };
}

test('discarding only results preserves complete native execution, events, failure history and snapshots', () => {
  const kept = fixture(), dropped = fixture();
  dropped.host.callWithoutResult('missing', 1, []); expect(kept.host.call('missing', 1, []).ok).toBe(false);
  for (let tick = 0; tick < 32; tick++) {
    expect(dropped.host.beginTick(tick)).toEqual(kept.host.beginTick(tick));
    // Range refusal, native trap and a third refusal disable the actual module.
    const value = tick === 7 || tick === 19 ? 20 : tick === 13 ? 99 : tick % 10;
    const input = [tick, 1 / 60, 0, 1, value], result = kept.host.call('real', 1, input);
    dropped.host.callWithoutResult('real', 1, input);
    expect(dropped.host.checkpoint()).toEqual(kept.host.checkpoint()); expect(dropped.world.state()).toEqual(kept.world.state());
    expect(dropped.host.failureCount).toBe(kept.host.failureCount); expect(dropped.world.contentRevision).toBe(kept.world.contentRevision);
    expect(dropped.world.reads).toEqual(kept.world.reads); expect(dropped.toasts).toEqual(kept.toasts); expect(dropped.disabled).toEqual(kept.disabled);
    if (tick === 7 || tick === 13) { expect(result.ok).toBe(false); kept.host.resume('real', 1); dropped.host.resume('real', 1); }
  }
  expect(dropped.disabled).toHaveLength(1); expect(dropped.host.failureCount).toBe(3);
  expect(() => dropped.host.resume('real', 1)).toThrow('Disabled or active module');
});
