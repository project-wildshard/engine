import { Color } from 'three';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import type { ChannelLook } from '../../../shared/engine/entities/species/registry';

/**
 * ONE-FORMAT CC28b: a body's look bound to its actor channels. The server owns the four channels (wire 1.1 animal
 * fields 25 to 28); a page moves the body's material with them: `tint` pulls its colour toward a colour, `emissive`
 * adds a glow of a colour, and `opacity` is a channel's value. Channels are named in the format and read here by their
 * index in the body's `channels` list, the wire's order.
 */
/** The channel look of a declared body, or undefined when it binds nothing. */
export function channelLookOf(body: Pick<CreatureBody, 'channels' | 'bind'> | undefined): ChannelLook | undefined {
  const bind = body?.bind; if (bind === undefined) return undefined;
  const names = (body?.channels ?? []).map(channel => channel.name);
  const index = (name: string): number => { const at = names.indexOf(name); if (at === -1) throw new Error(`Undeclared creature channel ${name}`); return at; };
  return {
    ...(bind.tint === undefined ? {} : { tint: { index: index(bind.tint.channel), colour: bind.tint.colour } }),
    ...(bind.emissive === undefined ? {} : { emissive: { index: index(bind.emissive.channel), colour: bind.emissive.colour } }),
    ...(bind.opacity === undefined ? {} : { opacity: index(bind.opacity) }),
  };
}

/** The material terms a channel look writes. */
export interface ChannelSurface { readonly color: Color; readonly emissive: Color; opacity: number; transparent: boolean; needsUpdate?: boolean }

/** One body's material under its channel look: the material's own colour and glow are the rest, and each frame writes
 *  `rest + channel` back. The emissive it returns is the resting glow a hit flash fades back to. */
export class ChannelMaterial {
  private readonly look: ChannelLook;
  private readonly surface: ChannelSurface;
  private readonly colour = new Color();
  private readonly glow = new Color();
  private readonly target = new Color();
  constructor(look: ChannelLook, surface: ChannelSurface) {
    this.look = look; this.surface = surface;
    this.colour.copy(surface.color); this.glow.copy(surface.emissive);
  }
  /** Write the channels into the material; the resting emissive, for the hit flash. */
  apply(channels: readonly number[], restingEmissive: Color): Color {
    const { look, surface } = this;
    if (look.tint !== undefined) surface.color.copy(this.colour).lerp(this.target.setRGB(...look.tint.colour), channels[look.tint.index] ?? 0);
    restingEmissive.copy(this.glow);
    if (look.emissive !== undefined) {
      const [r, g, b] = look.emissive.colour, k = channels[look.emissive.index] ?? 0;
      restingEmissive.r += r * k; restingEmissive.g += g * k; restingEmissive.b += b * k;
    }
    if (look.opacity !== undefined) {
      const opacity = Math.min(1, Math.max(0, channels[look.opacity] ?? 0)), transparent = opacity < 1;
      if (surface.transparent !== transparent) { surface.transparent = transparent; surface.needsUpdate = true; }
      surface.opacity = opacity;
    }
    return restingEmissive;
  }
}
