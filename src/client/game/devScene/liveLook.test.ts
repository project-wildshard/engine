import { expect, test } from 'vitest';
import * as THREE from 'three';
import { ToneMappingMode } from 'postprocessing';
import { Scope } from '@wildshard/engine/app/scope';
import type { ExtendLook, LookStrategy } from '@wildshard/engine/render/look';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { shardfileLook } from '../shardfile/look';
import { shardfileLiveLook } from './liveLook';

const look = (grade: Partial<Shardfile['look']['grade']> = {}, azimuth = 35, fog: { near?: number; far?: number } = {}): Shardfile['look'] => ({
  families: ['pbr'], materials: {}, clock: 'engine', dayOverride: 0.5, day: { minutes: 12, start: 0.5, maxElevation: 40, azimuth },
  grade: { exposure: 0.25, saturation: 1, contrast: 1, lut: null, tone: 'aces', ...grade },
  keys: [{ time: 0, sky: { zenith: [0.4, 0.5, 0.7], horizon: [0.8, 0.6, 0.6] }, fog: { colour: [0.8, 0.6, 0.6], density: fog.near === undefined ? 0.006 : 0, ...fog },
    sun: { colour: [1, 0.9, 0.8], intensity: 2 }, ambient: { sky: [0.7, 0.6, 0.9], ground: [0.4, 0.4, 0.2], intensity: 2.6 } }],
  light: {},
}) as unknown as Shardfile['look'];

/** A data look built as a page builds it (no light rows: `light` off), its backdrop and compose run on stand-in effects. */
async function built(source: Shardfile['look']): Promise<{ strategy: LookStrategy; fx: { tone: { mode: number }; vignette: { offset: number; darkness: number };
  bloom: { intensity: number; luminanceMaterial: { threshold: number }; mipmapBlurPass: { radius: number } } }; chain: unknown[]; clock: { azimuthOffset: number; maxElevation: number } }> {
  const strategy = shardfileLook(source, undefined, false);
  const sky = { setKeyLight: () => undefined, csm: undefined };
  const backdrop = await (strategy.backdrop as unknown as (c: { sky: typeof sky }) => Promise<{ clock: { azimuthOffset: number; maxElevation: number } }>)({ sky });
  const tone = { mode: ToneMappingMode.AGX }, fx = { tone, vignette: { offset: 0.32, darkness: 0.4 }, bloom: { intensity: 0, luminanceMaterial: { threshold: 1 }, mipmapBlurPass: { radius: 0.6 } } };
  // the engine chain's bloom as the level grade sets it at boot (plugin/context.ts: the look light's bloom; off here)
  const chain: unknown[] = [tone];
  const ctx = { engineChain: () => chain, scene: new THREE.Scene(), scope: new Scope('test.liveLook'), fx, renderer: null } as unknown as Parameters<ExtendLook['compose']>[0];
  (strategy as ExtendLook).compose(ctx);
  return { strategy, fx, chain, clock: backdrop.clock };
}
/** The data look's `liveLook` (an extend look's member; a replace look has none). */
const live = (strategy: LookStrategy): NonNullable<ExtendLook['liveLook']> => {
  if (!('liveLook' in strategy) || strategy.liveLook === undefined) throw new Error('not a data look');
  return strategy.liveLook;
};
const exposureOf = (chain: unknown[]): number | undefined => (chain.find(e => (e as { name?: string }).name === 'ExposureEffect') as { uniforms: Map<string, THREE.Uniform<number>> } | undefined)?.uniforms.get('uExposure')?.value;

test('AP17: the look a page booted from, set live again, changes nothing (the hook and shardfileLook read a look alike)', async () => {
  const source = look({ vignette: { offset: 0.2, darkness: 0.7 } });
  const { strategy, fx, chain } = await built(source);
  const before = JSON.stringify({ fx, exposure: exposureOf(chain) });
  expect(live(strategy)(shardfileLiveLook(source, false))).toBe(true);
  expect(JSON.stringify({ fx, exposure: exposureOf(chain) })).toBe(before);
});

test('AP17: exposure, tone, vignette and the sun arc go live; a refused change changes nothing', async () => {
  const { strategy, fx, chain, clock } = await built(look());
  expect(exposureOf(chain)).toBeCloseTo(2 ** 0.25);
  expect(fx.tone.mode).toBe(ToneMappingMode.ACES_FILMIC);
  expect(live(strategy)(shardfileLiveLook(look({ exposure: 1, tone: 'neutral', vignette: { offset: 0.1, darkness: 0.9 } }, 120), false))).toBe(true);
  expect(exposureOf(chain)).toBe(2);
  expect(fx.tone.mode).toBe(ToneMappingMode.NEUTRAL);
  expect(fx.vignette).toEqual({ offset: 0.1, darkness: 0.9 });
  expect(clock.azimuthOffset).toBe(120);
  // no vignette again: the chain's own comes back
  expect(live(strategy)(shardfileLiveLook(look(), false))).toBe(true);
  expect(fx.vignette).toEqual({ offset: 0.32, darkness: 0.4 });
  // a fog kind change and a LUT need a new look: refused, nothing moves
  expect(live(strategy)(shardfileLiveLook(look({ exposure: 2 }, 35, { near: 5, far: 80 }), false))).toBe(false);
  expect(live(strategy)(shardfileLiveLook(look({ exposure: 2, lut: 'lut.bin' }), false))).toBe(false);
  expect(exposureOf(chain)).toBeCloseTo(2 ** 0.25);
});

test('AP17: an exposure on a chain built without one is refused (the page asks for a new shell)', async () => {
  const { strategy, chain } = await built(look({ exposure: 0 }));
  expect(exposureOf(chain)).toBeUndefined();
  expect(live(strategy)(shardfileLiveLook(look({ exposure: 0 }), false))).toBe(true);
  expect(live(strategy)(shardfileLiveLook(look({ exposure: 0.5 }), false))).toBe(false);
});
