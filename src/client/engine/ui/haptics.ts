/**
 * Haptics — short vibration taps for hits, kills and the dash moves (E27). `navigator.vibrate` exists on Android Chrome /
 * the Android WebView only (iOS Safari has none), so on an iPhone this is silently a no-op. Behind the 'haptics' setting
 * (Settings → Gameplay → Vibration, shown only where it works).
 *
 *   buzz(HAPTIC.hit)          // one pattern per event, ms (or [on, off, on …])
 *   CAN_VIBRATE               // the device can — the menu hides the switch otherwise
 */
import { getSetting } from './Settings';

export const CAN_VIBRATE: boolean = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches;

export const HAPTIC: { readonly hit: 14; readonly kill: readonly [22, 40, 34]; readonly dodge: 10; readonly lunge: 8; readonly lock: 12; // lock-on (E50): lock …
readonly lockSwitch: 6; // … switch …
readonly lockBreak: 20; } = {
  hit: 14,
  kill: [22, 40, 34],
  dodge: 10,
  lunge: 8,
  lock: 12,      // lock-on (E50): lock …
  lockSwitch: 6, // … switch …
  lockBreak: 20, // … release / break
} as const satisfies Record<string, number | readonly number[]>;

export function buzz(pattern: number | readonly number[]): void {
  if (!CAN_VIBRATE || !getSetting('haptics')) return;
  try { navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]); } catch { /* blocked (no user gesture yet): skip */ }
}
