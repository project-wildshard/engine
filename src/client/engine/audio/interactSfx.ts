/**
 * InteractSfx — the adventure kit's sounds (chests, locks, levers, plates, doors, grates, pickups, glyphs, the beacon),
 * played from the procedural bank (gen.ts via audio.voices). A no-op before the first gesture; every play has a little
 * pitch jitter (±2 % for the chime and the glyph, ±5 % else) and never repeats the variant it played last.
 *
 *   const sfx = new InteractSfx(audio);
 *   sfx.interact(sound, at?, o?)   // 'chest' open · 'locked' rattle · 'lever' clunk · 'plate' grind (o.release: lighter,
 *                                  //   quicker) · 'door' creak · 'grate' iron grind · 'chime' pickup · 'glyph' (brighter)
 *                                  //   · 'ignite' the beacon; o.delay / o.gain; `at` places it in the world
 *
 * A level's own footsteps, combat layers and creature voices are its voice table (E357 S4.3, 08 §6.3 C).
 */
import * as v from 'valibot';
import { engineString } from '../../../shared/engine/strings';
import type { InteractEvent } from '../world/interact/Interactables';
import type { InteractSound } from './gen';
import type { Audio } from './Audio';

interface At { x: number; y: number; z: number }

const INTERACT_LEVEL: Record<InteractSound, number> = { chest: 0.7, locked: 0.6, lever: 0.7, plate: 0.65, door: 0.7, grate: 0.6, chime: 0.45, glyph: 0.6, ignite: 0.8 };

const eventTypes = ['open', 'locked', 'take', 'lever', 'door', 'press', 'release', 'light', 'sit', 'use', 'found', 'barrel-reset'] as const;
const name = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9.-]{0,127}$/u));
const text = v.pipe(v.string(), v.maxLength(2048)), finite = v.pipe(v.number(), v.finite(), v.minValue(0));
const EventRows = v.pipe(v.array(v.strictObject({
  types: v.pipe(v.array(v.picklist(eventTypes)), v.minLength(1), v.maxLength(12)),
  kind: v.exactOptional(v.picklist(['chest', 'key', 'door', 'lever', 'plate', 'barrel', 'pickup', 'beacon', 'bench', 'altar'])),
  look: v.exactOptional(v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
  flagPrefix: v.exactOptional(v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
  effects: v.pipe(v.array(v.variant('kind', [
    v.strictObject({ kind: v.literal('call'), name }),
    v.strictObject({ kind: v.literal('toast'), fallback: v.exactOptional(text), empty: v.exactOptional(v.boolean()) }),
    v.strictObject({ kind: v.literal('item'), toast: v.exactOptional(v.boolean()), fallback: v.exactOptional(v.boolean()) }),
    v.strictObject({ kind: v.literal('sound'), sound: v.picklist(['chest', 'locked', 'lever', 'plate', 'door', 'grate', 'chime', 'glyph', 'ignite']),
      gain: v.exactOptional(v.pipe(finite, v.maxValue(8))), delay: v.exactOptional(v.pipe(finite, v.maxValue(60))), release: v.exactOptional(v.boolean()) }),
  ])), v.maxLength(32)),
})), v.maxLength(64));

/** the adventure kit's interaction sounds (chests, locks, levers, plates, doors, grates, pickups, glyphs) */
export class InteractSfx {
  private readonly audio: { readonly voices: Pick<Audio['voices'], 'play'> };
  constructor(audio: { readonly voices: Pick<Audio['voices'], 'play'> }) {
    this.audio = audio;
  }

  /** Preflight ordered kit-event rows and their actual reward/view callbacks.
   * Only the first matching row runs; effects retain their declared order.
   * This presentation owns no flags, inventory, save or interaction decision.
   */
  bindEvents(input: unknown, ports: {
    readonly toast: (text: string) => void;
    readonly calls?: ReadonlyMap<string, (event: InteractEvent) => void>;
    readonly item?: (id: string) => { readonly label: string; readonly add: (count: number) => void } | null;
  }): (event: InteractEvent) => void {
    const rows = v.parse(EventRows, input);
    if ((ports.calls?.size ?? 0) > 64) throw new RangeError('Unbounded kit event callbacks');
    const compiled = rows.map(row => ({ row, effects: row.effects.map(effect => {
      if (effect.kind === 'call') {
        const call = ports.calls?.get(effect.name); if (call === undefined) throw new Error(`Unbound kit event callback ${effect.name}`);
        return call;
      }
      if (effect.kind === 'sound') return (event: InteractEvent): void => {
        this.interact(effect.sound, event.at, { ...(effect.gain === undefined ? {} : { gain: effect.gain }),
          ...(effect.delay === undefined ? {} : { delay: effect.delay }), ...(effect.release === undefined ? {} : { release: effect.release }) });
      };
      if (effect.kind === 'toast') return (event: InteractEvent): void => {
        const message = event.text ?? effect.fallback;
        if (message !== undefined && (effect.empty === true || message.length > 0)) ports.toast(message);
      };
      if (ports.item === undefined) throw new Error('Kit item effect requires its actual inventory');
      const item = ports.item;
      return (event: InteractEvent): void => {
        const reward = event.item === undefined ? null : item(event.item);
        if (reward !== null) { reward.add(event.n ?? 1); if (effect.toast === true) ports.toast(engineString('s_interact_item_count', [reward.label, event.n ?? 1])); }
        else if (effect.fallback === true && event.text) ports.toast(event.text);
      };
    }) }));
    return event => {
      for (const { row, effects } of compiled) {
        if (!row.types.includes(event.type) || row.kind !== undefined && row.kind !== event.def.kind
          || row.look !== undefined && (!('look' in event.def) || row.look !== event.def.look)
          || row.flagPrefix !== undefined && event.flag?.startsWith(row.flagPrefix) !== true) continue;
        for (const effect of effects) effect(event);
        return;
      }
    };
  }

  /** an interactable's sound, placed at the object */
  interact(sound: InteractSound, at?: At, o: { gain?: number; delay?: number; release?: boolean } = {}): void {
    const base = INTERACT_LEVEL[sound] * (o.gain ?? 1) * (o.release === true ? 0.6 : 1);
    this.audio.voices.play(`ui-${sound}`, { gain: base, rate: o.release === true ? 1.18 : 1, at, delay: o.delay ?? 0, jitter: sound === 'chime' || sound === 'glyph' ? 0.02 : 0.05 });
  }
}
