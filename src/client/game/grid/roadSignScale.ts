import { TIER } from '@wildshard/engine/core/tier';

/**
 * PZ24 (meta PAGE-SIZE): the road sign atlas's texel scale for this page's tier. The phone paints it half size: Driftwood's
 * two road halves held 28.8 MB of sign atlas on the iPhone profile (1024x4096 and 1024x6464 RG8 with mips), a quarter of
 * that at 0.5: a sign line is 256x32 texels across a 3.4 m board. The desktop keeps the painted size. Read at each build, so a tier change takes effect with the next road.
 */
export function roadSignScale(): number { return TIER === 'phone' ? 0.5 : 1; }
