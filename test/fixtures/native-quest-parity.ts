import * as v from 'valibot';
import { expect, test, vi } from 'vitest';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
// oxlint-disable-next-line import/no-nodejs-modules -- Read only admitted product and native physics bytes.
import { readFileSync } from 'node:fs';
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import { createNativeProofResident, prepareProductPlan } from './headless-native';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import legacy from './quest-step-legacy-saves.json' with { type: 'json' };
import type { SimValue } from '../../src/server/engine/sim';

// Both witnesses regenerate and compare the recorded gameplay checkpoint payloads before replaying an existing
// save. Their retained recorder refuses any changed flags, rewards, effects or compressed save bytes on Darwin.
const Proof = v.object({ replay: v.object({ status: v.literal('passed'), checkpointCaptured: v.literal(true),
  hash: v.string(), replayHash: v.string(), suffixTicksExecuted: v.pipe(v.number(), v.minValue(1)) }) });
const SavedValue: v.GenericSchema<unknown, SimValue> = v.lazy(() => v.union([
  v.null(), v.boolean(), v.pipe(v.number(), v.finite()), v.string(), v.array(SavedValue), v.record(v.string(), SavedValue),
]));
// Cold recording and strict replay each keep their own bounded process deadline.
/** Register one shard's unchanged ordered native compatibility cases. */
export function nativeQuestParity(slug: 'driftwood-isle' | 'pine-hollow', witness: (mode: string) => { status: number | null; stdout: string; stderr: string }): void {
  test(`${slug}: recorded native checkpoints regenerate and verify before replay`, () => {
    const result = witness('cache-verify');
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(v.parse(v.object({ status: v.literal('generated') }), JSON.parse(result.stdout.split('\n').at(-1) ?? 'null')).status).toBe('generated');
  }, 300_000);
  test(`${slug}: recorded native quest saves restore and replay byte-identically`, () => {
    const result = witness('replay');
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    const proof = v.parse(Proof, JSON.parse(result.stdout.split('\n').at(-1) ?? 'null'));
    expect(proof.replay.replayHash).toBe(proof.replay.hash);
  }, 300_000);

  test(`${slug}: an existing native quest envelope retains its exact bytes`, async () => {
    const product = await loadHeadlessProduct(`out/${slug}`), descriptor = outputDescriptor(product.shardfile);
    if (descriptor === undefined) throw new Error('Missing admitted native product');
    const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash,
      Uint8Array.from(readFileSync(`out/${slug}/${file.path}`))]));
    const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
    const resident = await createNativeProofResident({ product, shard: product.shardfile, assets, rapier }, prepareProductPlan);
    try {
      const fixture = legacy[slug], owner = resident.host.adapters.get(fixture.adapter);
      if (owner === undefined) throw new Error('Missing existing quest save owner');
      owner.restore(v.parse(SavedValue, fixture.state));
      expect(JSON.stringify(owner.snapshot())).toBe(fixture.bytes);
      expect(resident.effects).toEqual([]);
      if (slug === 'pine-hollow') {
        // Saves made between bends retain the original wire, without entering
        // the v1 guest, publishing a follow flag, or paying a reward on restore.
        for (const mode of ['none', 'stare', 'trot', 'gone']) {
          const state = { ...legacy['pine-hollow'].state, stag: { i: 2, mode, t: 0.8 } };
          owner.restore(v.parse(SavedValue, state));
          expect(owner.snapshot()).toEqual(state);
          expect(resident.effects).toEqual([]);
        }
        const requests = vi.spyOn(ReturnProgram.prototype, 'project');
        try {
          for (let tick = 0; tick < 60; tick++) resident.host.step();
          expect(requests.mock.calls.filter(([signal]) => signal === 'lead')).toHaveLength(10);
        } finally { requests.mockRestore(); }
      }
    } finally { resident.dispose(); }
  }, 120_000);
}
