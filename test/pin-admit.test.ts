import {describe, expect, it} from 'vitest';
import {readTar} from '@wildshard/format/tar';
import {admitPin} from '../scripts/pin-admit';
import {hashOf, legacyMigrationFixture, useCookHarness} from './fixtures/cookWorkerHarness';

/** SHARD-COMPAT FE9b: `pins.ts install` admits a pin as the cook does, through the chain when this validator refuses it. */
describe('a pin install admits through the chain', () => {
  const h = useCookHarness(legacyMigrationFixture.folder);
  const refuse = (): never => { throw new Error('refused as stored'); };

  it('installs a pin this validator admits as it is', () => {
    const files = readTar(h.real), admitted = admitPin(files, hashOf, () => ({warnings: ['grandfathered']}));
    expect(admitted.files).toBe(files);
    expect(admitted.applied).toEqual([]);
    expect(admitted.warnings).toEqual(['grandfathered']);
  });

  it('installs the chain copy of a pin this validator refuses, with no build receipt', () => {
    const files = readTar(h.real), admitted = admitPin(files, hashOf, refuse);
    expect(admitted.applied.length).toBeGreaterThan(0);
    expect(admitted.files.has('validation.json')).toBe(false);
    expect(admitted.files.get('shard.json')).not.toEqual(files.get('shard.json'));
  }, 60_000);

  it('keeps the pin its own refusal when the chain cannot read it', () => {
    expect(() => admitPin(new Map([['shard.json', new Uint8Array([1])]]), hashOf, refuse)).toThrow('refused as stored');
  });
});
