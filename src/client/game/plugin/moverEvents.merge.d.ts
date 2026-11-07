import type { AskMap as EngineAsks } from '@wildshard/engine/events/maps';

export type MoverObservationAsks = EngineAsks;
declare module '@wildshard/engine/events/maps' {
  interface AskMap { 'player.carrying': readonly [boolean, boolean]; }
}
