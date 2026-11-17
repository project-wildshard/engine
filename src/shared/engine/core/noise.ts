/** 2D simplex noise and its easing helpers: format's law (SDK-SPLIT SP5a, Q35); the bake and the engine sample one copy. */
import * as noise from '@wildshard/format/noise';

/** Gustavson's seeded simplex noise, the identical defining format class. */
export class Noise2D extends noise.Noise2D {}
export const smoothstep: typeof noise.smoothstep = noise.smoothstep;
export const clamp: typeof noise.clamp = noise.clamp;
export const lerp: typeof noise.lerp = noise.lerp;
