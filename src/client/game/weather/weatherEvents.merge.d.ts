import type { AskMap as NativeAskMap } from '@wildshard/engine/events/maps';

declare module '@wildshard/engine/events/maps' {
  // weather.indoors / weather.storm-hold: the storm frame's cover questions (forest.ts, a native host's step): inside a
  // room, and a fight holding the storm
  interface AskMap extends Pick<NativeAskMap, never> { 'weather.rain': readonly [{ readonly id: string; readonly rain: number }, { readonly id: string; readonly rain: number }];
    'weather.indoors': readonly [number, number]; 'weather.storm-hold': readonly [number, number] }
}
