import type { CreatureSkinClipName } from '@wildshard/format/skinData';
import type { SkinClipMap, SkinClipState } from '@wildshard/format/skins';
import type { RunningAbility } from '@wildshard/engine/ai/strikes';

/** Look overrides apply only when that variant actually has the clip. */
export function creatureClipName(state: SkinClipState, map: SkinClipMap | undefined,
  clips: { has: (name: CreatureSkinClipName) => boolean }, ability?: RunningAbility): CreatureSkinClipName {
  if (state === 'attack' && ability !== undefined) {
    const mapped = map?.abilities?.[ability.id];
    if (mapped !== undefined && clips.has(mapped)) return mapped;
    if (ability.clip !== undefined && clips.has(ability.clip)) return ability.clip;
  }
  const mapped = map?.states?.[state];
  return mapped !== undefined && clips.has(mapped) ? mapped : state;
}
