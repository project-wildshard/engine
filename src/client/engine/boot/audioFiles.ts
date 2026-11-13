/** Audio inventories come from the generated manifests: the engine's one music style, the selected sets first.
 * Level profiles add their own sets and declare any file/slot exclusions.
 */
import { audioFilesFor, sfxSetsFor, type AudioFilePolicy } from '../../../shared/engine/audio/bootAudio';
import { getSfxSet } from '../ui/Settings';

// AUDIO AU1: the selection lives in shared/engine/audio/bootAudio.ts, which the cook also reads; these read Settings.
export const sfxSets = (): string[] => sfxSetsFor(getSfxSet());
export function audioFiles(policy: AudioFilePolicy = {}): { music: string[]; sfx: string[] } { return audioFilesFor(getSfxSet(), policy); }
