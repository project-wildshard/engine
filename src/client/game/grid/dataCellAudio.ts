// SHARD-SOURCE SS-GP4b: a data cell's declared audio beyond `audio.scene` inside the grid. A one-shard page installs its
// cues, cue routing, score mode and synth bed (`client.ts`, `installDeclaredAudio`); a grid copy bound only an Open Plot's
// audio scene (`plotAudio.ts`, AU20), so the Template's sword swing, hit, heavy and swap cues fell through to nothing and its
// forest bed never played on a grid cell (GRID-CELL-PARITY row 37). While the feet stand in the copy its cue table answers
// first (the page's cues stack per scope), its score mode holds and its bed plays; all of it leaves with the stay.
import type { Scope } from '@wildshard/engine/app/scope';
import { installDeclaredAudio, type DeclaredAudioPorts } from '@wildshard/engine/audio/declared';
import type { AudioData } from '@wildshard/format/audio';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { declaredWeaponVoices } from '../plugin/audio';
import type { RegionalRuntimePage } from './regionalRuntime';

/** The declared audio a copy's stay installs, or null: a cell with an `audio.scene` (the plot's, AU20) owns all of its
 *  sound there, as a one-shard page with a scene skips the declared install; music, sample and zone profiles need the
 *  page's catalogue installers, which a data cell has none of, and gust beds their native driver. */
export function cellDeclaredAudio(source: Pick<Shardfile, 'runtime' | 'audio'>): AudioData | null {
  const audio = source.audio;
  if (source.runtime !== null || audio.scene !== undefined) return null;
  if (audio.music !== undefined || audio.samples !== undefined || audio.zones !== undefined || audio.ambience?.gust !== undefined) return null;
  return audio.cues.length > 0 || audio.routing.length > 0 || audio.ambience !== null || audio.score === 'silent' ? audio : null;
}

/** The page's mixer, cues, voices and music, or a test's. */
export type DataCellAudioPorts = Omit<DeclaredAudioPorts, 'scope'>;

/** Install a copy's declared audio for one stay in it. */
export function installCellAudio(audio: AudioData, stay: Scope, ports: DataCellAudioPorts): void {
  installDeclaredAudio(audio, { ...ports, scope: stay });
}

/** The page's install: the page's own mixer and cue router, the catalogue's weapon voices. */
export function enterDataCellAudio(audio: AudioData, page: Pick<RegionalRuntimePage, 'play'>, stay: Scope): void {
  const play = page.play;
  installCellAudio(audio, stay, { audio: play.audio, cues: play.cues, voices: declaredWeaponVoices(play.audio), music: play.music });
}
