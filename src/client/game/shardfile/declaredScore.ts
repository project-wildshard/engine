// Meta MOSSGATE-ZONE MZ23: a shard's declared score of the engine's own piano slots (J304: no recordings of its own), as a
// scene-SDK shard writes it (`world.music`). It plays while its owner lives, its scene `day` or `night` by the page's clock
// and its lifecycle `bossScene` while one of the wire's boss rows fights. A grid data cell installs it for a stay
// (`grid/dataCellAudio.ts`); a one-shard page with no catalogue installers of its own for its play (`client.ts`).
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import { CatalogueScore } from '@wildshard/engine/audio/SetScore';
import type { AudioMusicProfile } from '@wildshard/engine/audio/audioProfiles';
import { installSceneZones, sceneZoneProfile } from '@wildshard/engine/audio/declaredAmbience';
import type { DeclaredAudioPorts } from '@wildshard/engine/audio/declared';
import type { AudioData } from '@wildshard/format/audio';
import { wirePage } from './wirePage';

/** A score a page plays by itself: slot mode, a lifecycle, and no recordings or set catalogue of its own (the engine
 *  style's slots, which the format holds to title, island and pine). */
export function cellScore(music: NonNullable<AudioData['music']>): boolean {
  return music.catalogue?.mode === 'slots' && music.lifecycle !== undefined && music.source === null && music.setCatalogue === undefined;
}

/** What picks the score's scene: the page's night (0 day to 1 night, null with no clock) and whether a boss fights now. */
export interface CellScoreScene { readonly night: () => number | null; readonly boss: () => boolean; readonly race?: () => boolean }
/** The score (`CatalogueScore`), as far as its scene driver reads it. */
export type CellScore = Pick<CatalogueScore, 'setScene' | 'combat'>;
/** How a score is installed and what picks its scene: the page's (`pageScore`), or a test's. */
export interface CellScorePorts { readonly install: (profile: AudioMusicProfile, scope: Scope) => CellScore; readonly scene: CellScoreScene }

/** A boss row's states while its fight is on (`BossBrain`'s, `encounterRows.ts`). */
const FIGHTING: ReadonlySet<string> = new Set(['intro', 'fight', 'beat']);
/** How often the score's scene is read again, in ms: a boss's engage lands within a beat, the night's turn is slow. */
const SCENE_MS = 500;
const RACE_SCENE_MS = 100;
function hasRaceScene(music: Pick<AudioMusicProfile, 'selection'>): boolean {
  return music.selection.some(row => row.when.some(check => check.field === 'scene' && check.op === 'equals' && check.value === 'race'));
}

/** The score's scene now: its boss scene while a boss fights (the music's combat layer up), else `night` past half dark,
 *  else `day`. */
export function stepCellScore(score: CellScore, music: Pick<AudioMusicProfile, 'lifecycle' | 'selection'>, scene: CellScoreScene): string {
  const boss = music.lifecycle?.bossScene, engaged = boss !== undefined && scene.boss();
  const racing = !engaged && scene.race?.() === true && hasRaceScene(music);
  const name = engaged ? boss : racing ? 'race' : (scene.night() ?? 0) > 0.5 ? 'night' : 'day';
  score.setScene(name);
  if (engaged) score.combat(1);
  return name;
}

/** The `profiles.music` installer `installDeclaredAudio` takes: the score for the scope, its scene read now and every beat. */
export function scoreProfile(ports: CellScorePorts): (profile: AudioMusicProfile, scope: Scope) => void {
  return (profile, scope) => {
    const playing = ports.install(profile, scope);
    stepCellScore(playing, profile, ports.scene);
    scope.interval(hasRaceScene(profile) ? RACE_SCENE_MS : SCENE_MS, () => { stepCellScore(playing, profile, ports.scene); });
  };
}

/** The page's score ports: the page's mixer and music, its clock, and the wire's boss rows while `here` holds. */
export function pageScore(play: { readonly audio: Audio; readonly music: Music }, here: () => boolean = () => true, races: readonly { readonly id: string }[] = []): CellScorePorts {
  const starts = races.map(race => `race:${race.id}`);
  return { install: (profile, scope) => CatalogueScore.install(play.audio, play.music, scope, profile),
    scene: { night: () => app.dayCycle?.night ?? null, boss: () => here() && wirePage.encounters().some(row => row.kind === 'boss' && FIGHTING.has(row.state)),
      race: () => here() && starts.some(name => wirePage.line(name) > 0) } };
}

/** A one-shard page's profiles when no catalogue installer is bound: its own engine-slot score, else none. */
export function pageScoreProfiles(audio: Pick<AudioData, 'music' | 'zones'>, play: { readonly audio: Audio; readonly music: Music },
  races: readonly { readonly id: string }[] = [], here: () => boolean = () => true): DeclaredAudioPorts['profiles'] {
  const score = audio.music !== undefined && cellScore(audio.music), zones = sceneZoneProfile(audio.zones);
  if (!score && !zones) return undefined;
  return {
    ...(score ? { music: scoreProfile(pageScore(play, here, races)) } : {}),
    ...(zones ? { zones: (profile, scope) => { installSceneZones(play.audio, scope, profile, () => here() ? play.audio.listenerPosition : null); } } : {}),
  };
}
