/** Audio inventories come from the generated manifests, with the selected styles/sets first.
 * Level profiles add their own sets and declare any file/slot exclusions.
 */
import { audioFilesFor, musicStylesFor, sfxSetsFor, type AudioFilePolicy } from '../../../shared/engine/audio/bootAudio';
import { getMusicStyle, getSfxSet } from '../ui/Settings';

// AUDIO AU1: the selection lives in shared/engine/audio/bootAudio.ts, which the cook also reads; these read Settings.
export const musicStyles = (): string[] => musicStylesFor(getMusicStyle());
export const sfxSets = (): string[] => sfxSetsFor(getSfxSet());
export function audioFiles(policy: AudioFilePolicy = {}): { music: string[]; sfx: string[] } { return audioFilesFor(getMusicStyle(), getSfxSet(), policy); }
