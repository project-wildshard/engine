import { Effect, BlendFunction } from 'postprocessing';
import { Uniform, Vector3 } from 'three';
import type { GradeSpec } from '../../../shared/engine/level/data';

export type GradeOptions = Pick<GradeSpec, 'shadowTint' | 'highTint' | 'lift' | 'gain' | 'gamma'>;
const DEFAULTS: GradeOptions = { shadowTint: [0.9, 0.95, 1.08], highTint: [1.06, 1.0, 0.92], lift: [-0.01, -0.008, 0.0], gain: [1.03, 1.02, 1.0], gamma: 1.0 };

/** the look layer (see the constructor): its uniforms and the two steps, on the display-referred colour */
const LOOK_PARS = /* glsl */`
      uniform float uCurve; uniform float uVibrance;`;
const LOOK_MAIN = /* glsl */`
        // S-curve in a perceptual (gamma 2.2) domain: deeper shadows, fuller mids, the highlights held
        vec3 pc = pow(max(c, 0.0), vec3(1.0 / 2.2));
        pc = mix(pc, pc * pc * (3.0 - 2.0 * pc), uCurve);
        c = pow(max(pc, 0.0), vec3(2.2));
        // vibrance: the muted colours lifted more than the saturated ones
        float vmx = max(c.r, max(c.g, c.b)), vmn = min(c.r, min(c.g, c.b));
        float vsat = (vmx - vmn) / max(vmx, 1e-4);
        float vlum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(vlum), c, 1.0 + uVibrance * (1.0 - vsat)), 0.0);`;

/**
 * Final colour grade (runs after tone mapping, in display space): cool shadows / warm highlights
 * split-toning, gentle lift-gamma-gain, and a touch of desaturation in the deepest shadows —
 * the "golden hour film" look of the art/ mockups.
 */
export class GradeEffect extends Effect {
  /** the uniforms, held directly (the Effect's own Map is typed loosely) */
  private readonly u: { shadowTint: Uniform<Vector3>; highTint: Uniform<Vector3>; lift: Uniform<Vector3>; gain: Uniform<Vector3>; gamma: Uniform<number> };

  /**
   * `look` (a shard's look-loop layer, PINE-HOLLOW PH-L1 / L4; a shard without one passes none): after the split-tone, an
   * S-curve around mid grey and a vibrance lift, both live uniforms (`uCurve`, `uVibrance`). Without it the program is
   * the one it always was (Driftwood's source, byte for byte).
   */
  constructor(opts: Partial<GradeOptions> = {}, look: { curve: number; vibrance: number } | null = null) {
    const o = { ...DEFAULTS, ...opts };
    const u = {
      shadowTint: new Uniform(new Vector3(...o.shadowTint)), highTint: new Uniform(new Vector3(...o.highTint)),
      lift: new Uniform(new Vector3(...o.lift)), gain: new Uniform(new Vector3(...o.gain)), gamma: new Uniform(o.gamma),
    };
    super('GradeEffect', /* glsl */`
      uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform vec3 uLift; uniform vec3 uGain; uniform float uGamma;${look ? LOOK_PARS : ''}
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(uShadowTint, uHighTint, smoothstep(0.05, 0.75, l));
        c = max(c * uGain + uLift, 0.0);
        c = pow(c, vec3(1.0 / uGamma));
        // deep shadows lose a little saturation, like film
        float ds = smoothstep(0.18, 0.0, l);
        c = mix(c, vec3(dot(c, vec3(0.3333))), ds * 0.25);${look ? LOOK_MAIN : ''}
        outputColor = vec4(c, inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['uShadowTint', u.shadowTint],
        ['uHighTint', u.highTint],
        ['uLift', u.lift],
        ['uGain', u.gain],
        ['uGamma', u.gamma],
        ...(look ? [['uCurve', new Uniform(look.curve)], ['uVibrance', new Uniform(look.vibrance)]] as [string, Uniform][] : []),
      ]),
    });
    this.u = u;
  }

  /** Retune at runtime (the day/night clock, a storm's slate grade): any subset of the options; unchanged fields keep their value. */
  set(opts: Partial<GradeOptions>): void {
    const { u } = this;
    if (opts.shadowTint) u.shadowTint.value.fromArray(opts.shadowTint);
    if (opts.highTint) u.highTint.value.fromArray(opts.highTint);
    if (opts.lift) u.lift.value.fromArray(opts.lift);
    if (opts.gain) u.gain.value.fromArray(opts.gain);
    if (opts.gamma !== undefined) u.gamma.value = opts.gamma;
  }

  /** Hold the grade `set` writes (split tone, lift, gain, gamma); the returned function puts it back. */
  hold(): () => void {
    const { u } = this, gamma = u.gamma.value;
    const vectors = [u.shadowTint, u.highTint, u.lift, u.gain].map((uniform) => [uniform, uniform.value.clone()] as const);
    return () => { for (const [uniform, value] of vectors) uniform.value.copy(value); u.gamma.value = gamma; };
  }
}

/**
 * The look layer alone (SHARD-PLATFORM G232): the S-curve and vibrance `GradeEffect` runs after its split tone when built
 * with a look, as an effect of its own with live uniforms, for a chain whose `GradeEffect` was built without one (a grid
 * page's neutral shell carrying a region's grade inside its cell). Placed right after that `GradeEffect`, with the same
 * curve and vibrance, the pair computes what one `GradeEffect` with the look computes; at curve 0 and vibrance 0 (or
 * opacity 0) it changes nothing.
 */
export class GradeLookEffect extends Effect {
  private readonly curve: Uniform<number>;
  private readonly vibrance: Uniform<number>;
  constructor() {
    const curve = new Uniform(0), vibrance = new Uniform(0);
    super('GradeLookEffect', /* glsl */`${LOOK_PARS}
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;${LOOK_MAIN}
        outputColor = vec4(c, inputColor.a);
      }`, { blendFunction: BlendFunction.SRC, uniforms: new Map<string, Uniform>([['uCurve', curve], ['uVibrance', vibrance]]) });
    this.curve = curve; this.vibrance = vibrance;
  }

  /** the curve and vibrance (a level's `GradeLook`; 0 and 0 change nothing) */
  set(look: { readonly curve: number; readonly vibrance: number }): void { this.curve.value = look.curve; this.vibrance.value = look.vibrance; }
  get values(): { readonly curve: number; readonly vibrance: number } { return { curve: this.curve.value, vibrance: this.vibrance.value }; }
}
