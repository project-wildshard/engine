import type { EventMap as EngineEvents } from '@wildshard/engine/events/maps';

export type AudioSceneEvents = EngineEvents;

declare module '@wildshard/engine/events/maps' {
  interface EventMap {
    'audio.scene-frame': { delta: number; inputs: Readonly<Record<string, number>> };
  }
}
