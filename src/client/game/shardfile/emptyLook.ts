import { Color } from 'three';
import { DayCycle } from '@wildshard/engine/world/dayCycle';
import type { LookStrategy } from '@wildshard/engine/render/look';

/** Asset-free backdrop for the minimal source, on the existing sky and composer; `background` (linear RGB) is what shows
 *  where nothing draws (G630: the grid page's void). */
export function emptyLook(dayOverride: number | null, background: readonly [number, number, number] | null = null): LookStrategy {
  let restore = (): void => { /* Bound while the sky is built. */ };
  return {
    mode: 'extend', chain: 'clean', compose: ({ engineChain, scope }) => { scope.onDispose(restore); return { chain: engineChain('clean') }; },
    sky: { clouds: false, planet: false },
    backdrop: ({ scene }) => {
      const clock = new DayCycle({ units: 'hour', start: (dayOverride ?? 0.5) * 24,
        schedule: [{ phase: 'day', from: 0, to: 24, minutes: 12 }], sun: { maxElevation: 60, azimuthOffset: 35 },
        fixed: { midday: 12, golden: 17, sunset: 18, night: 0 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 0 } });
      clock.paused = dayOverride !== null;
      const before = scene.background;
      scene.background = background === null ? new Color(0x9ca7b4) : new Color(...background);
      restore = () => { scene.background = before; };
      return Promise.resolve({ clock, horizon: new Color(0x9ca7b4), lut: null,
        bind: () => undefined, update: (dt: number) => { clock.update(dt); },
        rebuild: () => undefined, attachPost: () => undefined,
      });
    },
  };
}
