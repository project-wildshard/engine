// SHARD-SOURCE SS-GP4b: a data cell's declared audio beyond `audio.scene` inside the grid. A one-shard page installs its
// cues, cue routing, score mode and synth bed (`client.ts`, `installDeclaredAudio`); a grid copy bound only an Open Plot's
// audio scene (`plotAudio.ts`, AU20), so the Template's sword swing, hit, heavy and swap cues fell through to nothing and its
// forest bed never played on a grid cell (GRID-CELL-PARITY row 37). While the feet stand in the copy its cue table answers
// first (the page's cues stack per scope), its score mode holds and its bed plays; all of it leaves with the stay.
// Meta MOSSGATE-ZONE MZ23: a copy may also name a score of the engine's own piano slots (J304, no recordings of its own);
// it plays while the feet stand in the copy, its scene `day` or `night` by the page's clock and its boss scene while a
// boss of the copy is engaged.
import type { Scope } from '@wildshard/engine/app/scope';
import { installDeclaredAudio, type DeclaredAudioPorts } from '@wildshard/engine/audio/declared';
import type { AudioData } from '@wildshard/format/audio';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { declaredWeaponVoices } from '../plugin/audio';
import { sceneZoneProfile } from '@wildshard/engine/audio/declaredAmbience';
import { cellScore, pageScoreProfiles, scoreProfile, type CellScorePorts } from '../shardfile/declaredScore';
import type { RegionalRuntimePage } from './regionalRuntime';

/** The declared audio a copy's stay installs, or null: a cell with an `audio.scene` (the plot's, AU20) owns all of its
 *  sound there, as a one-shard page with a scene skips the declared install; sample and zone profiles need the page's
 *  catalogue installers, which a data cell has none of, gust beds their native driver, and a score its own recordings. */
export function cellDeclaredAudio(source: Pick<Shardfile, 'runtime' | 'audio'>): AudioData | null {
  const audio = source.audio;
  if (source.runtime !== null || audio.scene !== undefined) return null;
  if ((audio.music !== undefined && !cellScore(audio.music)) || audio.samples !== undefined
    || (audio.zones !== undefined && !sceneZoneProfile(audio.zones)) || audio.ambience?.gust !== undefined) return null;
  return audio.cues.length > 0 || audio.routing.length > 0 || audio.ambience !== null || audio.score === 'silent' || audio.music !== undefined || audio.zones !== undefined ? audio : null;
}

/** The page's mixer, cues, voices and music, or a test's; with a score, its install and what picks its scene. */
export type DataCellAudioPorts = Omit<DeclaredAudioPorts, 'scope'> & { readonly score?: CellScorePorts };

/** Install a copy's declared audio for one stay in it. */
export function installCellAudio(audio: AudioData, stay: Scope, ports: DataCellAudioPorts): void {
  const { score, profiles, ...rest } = ports;
  installDeclaredAudio(audio, { ...rest, scope: stay, profiles: score === undefined ? profiles : { ...profiles, music: scoreProfile(score) } });
}

/** The page's install: the page's own mixer and cue router, the catalogue's weapon voices, and the page's music for a
 *  copy's score (its night from the page's clock, its boss from the wire's encounter rows while the wire is the copy's). */
export function enterDataCellAudio(audio: AudioData, page: Pick<RegionalRuntimePage, 'play'>, stay: Scope, here: () => boolean = () => true, races: Shardfile['quests']['races'] = []): void {
  const play = page.play;
  installCellAudio(audio, stay, { audio: play.audio, cues: play.cues, voices: declaredWeaponVoices(play.audio), music: play.music, profiles: pageScoreProfiles(audio, play, races, here) });
}
