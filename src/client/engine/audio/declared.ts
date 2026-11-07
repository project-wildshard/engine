import { declaredGameplay, type DeclaredGameplayPorts } from './declaredGameplay';
import { DeclaredAmbience, type DeclaredAmbiencePorts } from './declaredAmbience';
import { CatalogueScore } from './SetScore';
import type { Music } from './Music';
import type { AudioData } from '@wildshard/format/audio';
import { DeclaredSoundBank, type DeclaredBankAudio } from './declaredBank';
import type { Scope } from '../../../shared/engine/app/scope';
import type { Audio } from './Audio';
import type { CombatCues, CombatCueOpts } from '../combat/cues';
import { createCueRouter, type CueRoute } from './cueRouting';
import type { AudioMusicProfile, AudioSampleProfile, AudioZoneProfile } from '../../../shared/engine/audio/audioProfiles';

/** Catalogue cue ids plus bounded wind recipes and a score mode, supplied as validated level data. */
export interface DeclaredAudioData {
  cues: readonly { id: string; voice: string }[];
  gameplay?:NonNullable<AudioData['gameplay']>;observations?:NonNullable<AudioData['observations']>;
  bank?: NonNullable<AudioData['bank']>; playback?: NonNullable<AudioData['playback']>; pcm?: NonNullable<AudioData['pcm']>; synth?: NonNullable<AudioData['synth']>;
  /** Extended profiles resolve only through trusted platform catalogue installers. */
  music?: AudioMusicProfile | undefined; samples?: AudioSampleProfile | undefined; zones?: AudioZoneProfile | undefined;
  /** Ordered cue rules resolve the same admitted voice catalogue, with scoped delayed playback. */
  routing?: readonly CueRoute[] | undefined;
  ambience: AudioData['ambience'];
  score: 'silent' | 'default';
}
/** Audio source lifetime and cue/score ports, independent of content packages and renderer state. */
export interface DeclaredAudioPorts {
  audio: Pick<Audio, 'installSynthBed' | 'restartSynthBed' | 'installCues'> & { mkWind: (...args: Parameters<Audio['mkWind']>) => Pick<GainNode, 'disconnect'> };
  cues: CombatCues;
  voices: ReadonlyMap<string, (opts: CombatCueOpts) => void>;
  /** the score's silence for a scope (`Music.silence`): the music bus at 0 while it lives, restored after */
  music: { silence: (scope: Scope) => void };
  scope: Scope;
  /** Trusted recipes consume bounded data; an unbound profile is refused before any sound changes. */
  profiles?: {
    music?: ((profile: AudioMusicProfile, scope: Scope) => void) | undefined;
    samples?: ((profile: AudioSampleProfile, scope: Scope) => void) | undefined;
    zones?: ((profile: AudioZoneProfile, scope: Scope) => void) | undefined;
  } | undefined;
}
/** Native score owners supplied by the mixer; the declaration supplies all content policy. */
export interface DeclaredScorePorts {audio:Pick<Audio,'onLevelBank'>;music:Music;scope:Scope}
function scorePorts(ports:DeclaredAudioPorts|{audio:DeclaredBankAudio;scope:Scope}|DeclaredScorePorts|DeclaredAmbiencePorts|DeclaredGameplayPorts):ports is DeclaredScorePorts {
  return 'music' in ports&&'residentBank' in ports.music&&'onLevelBank' in ports.audio;
}
/** Gameplay phase binds native owners to declared observations and entry policy. */
export function installDeclaredAudio(data:AudioData,ports:DeclaredGameplayPorts,phase:'gameplay'):ReturnType<typeof declaredGameplay>;
/** Zoned ambience uses the existing native mix and declared ownership policy. */
export function installDeclaredAudio(data:AudioData,ports:DeclaredAmbiencePorts,phase:'ambience'):DeclaredAmbience;
/** Score-only phase uses the existing catalogue and keeps native bank and entered lifetimes separate. */
export function installDeclaredAudio(data:DeclaredAudioData,ports:DeclaredScorePorts,phase:'score'):CatalogueScore;
/** Bank-only phase preserves separately owned cue and ambience lifetimes. */
export function installDeclaredAudio(data:AudioData,ports:{audio:DeclaredBankAudio;scope:Scope},phase:'voices'):DeclaredSoundBank;
export function installDeclaredAudio(data:DeclaredAudioData,ports:DeclaredAudioPorts):void;
/** Admit every voice before installing; route real engine cues and stop all bed sources with the level scope. */
export function installDeclaredAudio(data:DeclaredAudioData,ports:DeclaredAudioPorts|{audio:DeclaredBankAudio;scope:Scope}|DeclaredScorePorts|DeclaredAmbiencePorts|DeclaredGameplayPorts,phase?:'voices'|'score'|'ambience'|'gameplay'):void|DeclaredSoundBank|CatalogueScore|DeclaredAmbience|ReturnType<typeof declaredGameplay> {
  if(phase==='gameplay'){if(!('owners' in ports)||!('music' in ports)||!('ambience' in ports)||!('camera' in ports))throw new Error('Missing gameplay ports');return declaredGameplay(data,ports);}
  if(ports.scope?.disposed)throw new Error('Audio scope is disposed');
  if(phase==='ambience'){if(!('sea' in ports))throw new Error('Missing ambience ports');return new DeclaredAmbience(data,ports);}
  if(phase==='score'){
    if(!scorePorts(ports)||data.music===undefined)throw new Error('Missing declared score ports or profile');
    return CatalogueScore.install(ports.audio,ports.music,ports.scope,data.music);
  }
  if(ports.scope===undefined)throw new Error('Missing audio scope');
  if(phase==='voices'){
    if(!('voices' in ports.audio))throw new Error('Missing declared bank ports');
    return new DeclaredSoundBank(ports.audio,data,ports.scope);
  }
  if(!('cues' in ports))throw new Error('Missing cue ports');
  if (data.ambience?.gust !== undefined) throw new Error('Gust beds require their declared native driver');
  if ((data.music !== undefined && ports.profiles?.music === undefined) || (data.samples !== undefined && ports.profiles?.samples === undefined) || (data.zones !== undefined && ports.profiles?.zones === undefined)) throw new Error('Audio profile requires its trusted catalogue installer');
  const voices = new Map(data.cues.map((cue) => {
    const voice = ports.voices.get(cue.voice); if (voice === undefined) throw new Error(`Unknown catalogue voice: ${cue.voice}`);
    return [cue.id, voice] as const;
  }));
  if (voices.size !== data.cues.length) throw new Error('Duplicate audio cue');
  const routes = data.routing ?? [], routingPorts = {
    voices: new Map([...ports.voices].map(([id, voice]) => [id, (opts: CombatCueOpts): boolean => { voice(opts); return true; }])),
    later: (run: () => void, seconds: number) => { ports.scope.timeout(seconds * 1000, run); },
  };
  const combatRoutes = routes.filter((route) => route.bus !== 'audio'), audioRoutes = routes.filter((route) => route.bus === 'audio');
  const combatRouting = createCueRouter(combatRoutes, routingPorts), audioRouting = createCueRouter(audioRoutes, routingPorts);
  ports.cues.use((id, opts) => { const voice = voices.get(id); if (voice === undefined) return false; voice(opts); return true; }, ports.scope);
  if (combatRoutes.length > 0) ports.cues.use(combatRouting, ports.scope);
  if (audioRoutes.length > 0) ports.audio.installCues(audioRouting, ports.scope);
  if (data.music !== undefined) ports.profiles?.music?.(data.music, ports.scope);
  if (data.samples !== undefined) ports.profiles?.samples?.(data.samples, ports.scope);
  if (data.zones !== undefined) ports.profiles?.zones?.(data.zones, ports.scope);
  if (data.score === 'silent') ports.music.silence(ports.scope);
  if (data.ambience !== null) {
    const { bed, winds } = data.ambience; let sources: Pick<GainNode, 'disconnect'>[] = [];
    const stop = (): void => { for (const source of sources) source.disconnect(); sources = []; };
    ports.audio.installSynthBed(bed, { start: () => { stop(); sources = winds.map((wind) => ports.audio.mkWind(wind.frequency, wind.q, wind.pan, wind.rate, wind.gain)); }, stop }, ports.scope);
    ports.audio.restartSynthBed(bed); ports.scope.onDispose(stop);
  }
}
