import { DATA_LOOK_DAY, dataLook } from '@wildshard/engine/render/dataLook';
import type { LookStrategy } from '@wildshard/engine/render/look';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { lookLightManifest } from '@wildshard/engine/render/lookLight';
import { lookLightOn } from '@wildshard/engine/ui/lookLightOption';
import { TIER } from '@wildshard/engine/core/tier';

/**
 * A shardfile's file reference → its URL: products sit beside the page that embeds `shard.json` (the SDK build writes
 * local and commons files under their hash), so the reference resolves against the document.
 */
export function shardfileFileUrl(ref: string): string { return `./${ref.replace(/^commons:/u, '')}`; }

/**
 * A shardfile's look section → the engine's data look (SF10b): its day keys on the engine clock and its LUT file, and its
 * light settings (LF1-4, `look.light`) while Settings ▸ Debug ▸ Look ▸ "Look light" is on (`light` overrides the row).
 */
export function shardfileLook(look: Shardfile['look'], assets?: ReadonlyMap<string, Uint8Array>, light: boolean = lookLightOn()): LookStrategy {
  const lut = look.grade.lut === null ? null : assets?.get(look.grade.lut) ?? shardfileFileUrl(look.grade.lut);
  if (assets !== undefined && look.grade.lut !== null && !assets.has(look.grade.lut)) throw new Error('Missing admitted look LUT');
  const resolved = lookLightManifest(look, light, TIER);
  // B2: `grade.tone` is a grade choice, not a light setting: it holds on every tier, with or without the row (so do M4.7's
  // exposure and vignette); the bloom radius rides the bloom, which the row and the tier gate
  return dataLook({ day: look.day ?? DATA_LOOK_DAY, dayOverride: look.dayOverride, keys: look.keys, lut, neutral: look.grade.tone === 'neutral', aces: look.grade.tone === 'aces',
    exposure: look.grade.exposure, vignette: look.grade.vignette ?? null, bloomRadius: resolved.bloom.radius,
    light: { rim: resolved.rim, pools: resolved.pools, heightFogDensity: resolved.atmosphere.fogHeightDensity, lamps: resolved.lamps, bounce: resolved.bounce, environment: resolved.environment,
      shadow: resolved.shadow, motes: resolved.motes } });
}
