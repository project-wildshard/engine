import type { CreatureSkinClipName } from '@wildshard/format/skinData';
import type { SkinClipMap, SkinClipState } from '@wildshard/format/skins';

/** Look overrides apply only when that variant actually has the clip. */
export function creatureClipName(state: SkinClipState, map: SkinClipMap | undefined,
  clips: { has: (name: CreatureSkinClipName) => boolean }): CreatureSkinClipName {
  const mapped = map?.states?.[state];
  return mapped !== undefined && clips.has(mapped) ? mapped : state;
}
