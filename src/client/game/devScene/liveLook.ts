import { DATA_LOOK_DAY, type LiveLook } from '@wildshard/engine/render/dataLook';
import { lookLightManifest } from '@wildshard/engine/render/lookLight';
import { lookLightOn } from '@wildshard/engine/ui/lookLightOption';
import { TIER } from '@wildshard/engine/core/tier';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { shardfileFileUrl } from '../shardfile/look';

/**
 * SHARD-SOURCE AP17: a shardfile's look section as `shardfileLook` (`../shardfile/look.ts`) builds its data look, plus the
 * engine bloom the level grade takes from it (`plugin/context.ts`), for the dev hook's `setLook`: a watched page's look set
 * live from the same data a fresh shell would boot from. Kept beside the hook, not in `shardfile/`, so a dev-only change never
 * moves the shardfile validation revision; `liveLook.test.ts` holds the two in step.
 */
export function shardfileLiveLook(look: Shardfile['look'], light: boolean = lookLightOn()): LiveLook {
  const resolved = lookLightManifest(look, light, TIER);
  return { day: look.day ?? DATA_LOOK_DAY, dayOverride: look.dayOverride, keys: look.keys, lut: look.grade.lut === null ? null : shardfileFileUrl(look.grade.lut),
    neutral: look.grade.tone === 'neutral', aces: look.grade.tone === 'aces', exposure: look.grade.exposure, vignette: look.grade.vignette ?? null, bloomRadius: resolved.bloom.radius,
    bloom: resolved.bloom,
    light: { rim: resolved.rim, pools: resolved.pools, heightFogDensity: resolved.atmosphere.fogHeightDensity, lamps: resolved.lamps, bounce: resolved.bounce, environment: resolved.environment,
      shadow: resolved.shadow, motes: resolved.motes } };
}
