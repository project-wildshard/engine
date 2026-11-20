// SHARD-SOURCE SS-GP4b: a data cell's declared audio beyond `audio.scene` inside the grid. A one-shard page installs its
// cues, cue routing, score mode and synth bed (`client.ts`, `installDeclaredAudio`); a grid copy bound only an Open Plot's
// audio scene (`plotAudio.ts`, AU20), so the Template's sword swing, hit, heavy and swap cues fell through to nothing and its
// forest bed never played on a grid cell (GRID-CELL-PARITY row 37). While the feet stand in the copy its cue table answers
// first (the page's cues stack per scope), its score mode holds and its bed plays; all of it leaves with the stay.
// Meta MOSSGATE-ZONE MZ23: a copy may also name a score of the engine's own piano slots (J304, no recordings of its own);
// it plays while the feet stand in the copy, its scene `day` or `night` by the page's clock and its boss scene while a
// boss of the copy is engaged.
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { installDeclaredAudio, type DeclaredAudioPorts } from '@wildshard/engine/audio/declared';
import { CatalogueScore } from '@wildshard/engine/audio/SetScore';
import type { AudioMusicProfile } from '@wildshard/engine/audio/audioProfiles';
import type { AudioData } from '@wildshard/format/audio';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { declaredWeaponVoices } from '../plugin/audio';
import { wirePage } from '../shardfile/wirePage';
import type { RegionalRuntimePage } from './regionalRuntime';

type CellMusic = NonNullable<AudioData['music']>;
/** MZ23: a score a copy plays by itself: slot mode, a lifecycle, and no recordings or set catalogue of its own (the engine
 *  style's slots, which the format holds to title, island and pine). */
export function cellScore(music: CellMusic): boolean {
  return music.catalogue?.mode === 'slots' && music.lifecycle !== undefined && music.source === null && music.setCatalogue === undefined;
}

/** The declared audio a copy's stay installs, or null: a cell with an `audio.scene` (the plot's, AU20) owns all of its
 *  sound there, as a one-shard page with a scene skips the declared install; sample and zone profiles need the page's
 *  catalogue installers, which a data cell has none of, gust beds their native driver, and a score its own recordings. */
export function cellDeclaredAudio(source: Pick<Shardfile, 'runtime' | 'audio'>): AudioData | null {
  const audio = source.audio;
  if (source.runtime !== null || audio.scene !== undefined) return null;
  if ((audio.music !== undefined && !cellScore(audio.music)) || audio.samples !== undefined || audio.zones !== undefined || audio.ambience?.gust !== undefined) return null;
  return audio.cues.length > 0 || audio.routing.length > 0 || audio.ambience !== null || audio.score === 'silent' || audio.music !== undefined ? audio : null;
}

/** MZ23: what picks a copy's score scene: the page's night (0 day to 1 night, null with no clock) and whether a boss of the
 *  copy is engaged now. */
export interface CellScoreScene { readonly night: () => number | null; readonly boss: () => boolean }
/** The score a copy plays (`CatalogueScore`), as far as its scene driver reads it. */
export type CellScore = Pick<CatalogueScore, 'setScene' | 'combat'>;

/** The page's mixer, cues, voices and music, or a test's; with a score, its install and what picks its scene. */
export type DataCellAudioPorts = Omit<DeclaredAudioPorts, 'scope' | 'profiles'> & {
  readonly score?: { readonly install: (profile: AudioMusicProfile, scope: Scope) => CellScore; readonly scene: CellScoreScene };
};

/** A boss row's states while its fight is on (`BossBrain`'s, `encounterRows.ts`). */
const FIGHTING: ReadonlySet<string> = new Set(['intro', 'fight', 'beat']);

/** How often the score's scene is read again, in ms: a boss's engage lands within a beat, the night's turn is slow. */
const SCENE_MS = 500;

/** MZ23: the score's scene now: its boss scene while a boss is engaged (the music's combat layer up), else `night` past
 *  half dark, else `day`. */
export function stepCellScore(score: CellScore, music: Pick<AudioMusicProfile, 'lifecycle'>, scene: CellScoreScene): string {
  const boss = music.lifecycle?.bossScene, engaged = boss !== undefined && scene.boss();
  const name = engaged ? boss : (scene.night() ?? 0) > 0.5 ? 'night' : 'day';
  score.setScene(name);
  if (engaged) score.combat(1);
  return name;
}

/** Install a copy's declared audio for one stay in it. */
export function installCellAudio(audio: AudioData, stay: Scope, ports: DataCellAudioPorts): void {
  const { score, ...rest } = ports;
  installDeclaredAudio(audio, { ...rest, scope: stay, ...(score === undefined ? {} : { profiles: { music: (profile: AudioMusicProfile, scope: Scope) => {
    const playing = score.install(profile, scope);
    stepCellScore(playing, profile, score.scene);
    scope.interval(SCENE_MS, () => { stepCellScore(playing, profile, score.scene); });
  } } }) });
}

/** The page's install: the page's own mixer and cue router, the catalogue's weapon voices, and the page's music for a
 *  copy's score (its night from the page's clock, its boss from the wire's encounter rows while the wire is the copy's). */
export function enterDataCellAudio(audio: AudioData, page: Pick<RegionalRuntimePage, 'play'>, stay: Scope, here: () => boolean = () => true): void {
  const play = page.play;
  installCellAudio(audio, stay, { audio: play.audio, cues: play.cues, voices: declaredWeaponVoices(play.audio), music: play.music, score: {
    install: (profile, scope) => CatalogueScore.install(play.audio, play.music, scope, profile),
    scene: { night: () => app.dayCycle?.night ?? null,
      boss: () => here() && wirePage.encounters().some(row => row.kind === 'boss' && FIGHTING.has(row.state)) } } });
}
