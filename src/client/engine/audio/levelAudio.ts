import type { AudioData } from '@wildshard/format/audio';
import type { SfxBank } from './preload';
import type { VoicePool } from './Voices';
import type { MusicStyle } from '../ui/Settings';
import type { StyleBank } from './Stems';
import type { AudioRead, AudioDecode, ScoreBank } from './SetScore';
import type { CueBank } from './Cues';

export interface LevelAudioBank { title: StyleBank | undefined; score: ScoreBank; cues: CueBank; samples?: SfxBank }
/** Playback modules depend on the mixer port so they can be checked without a device or legacy content. */
export interface AudioMixer {
  voice: () => VoicePool;
  readonly ready: boolean;
  readonly ctx: BaseAudioContext;
  bus: (id: 'music' | 'ambience' | 'sfx' | 'voice' | 'ui') => GainNode;
}
/** Boot downloads and decodes this content profile through the same counted/deferred queue. */
export interface LevelAudioProfile {
  priorityFiles?: () => readonly string[];
  files: () => { music: string[]; sfx: string[] };
  bootFiles: (style: MusicStyle) => readonly string[];
  /** Title-only recordings. A direct play entry may schedule them after
   * control; recordings shared by a played slot must remain outside this set. */
  titleFiles?: (style: MusicStyle) => readonly string[];
  /** The part of `bootFiles` the first seconds of play need: the boot slots' stems and the spawn bed. On the phone the
   *  loading bar reads only these; every other boot file downloads and decodes after control (iphone-downloads I7).
   *  Left out, every boot file is read before control. */
  controlFiles?: (style: MusicStyle) => readonly string[];
  /** Optional first-control decoder for exactly the declared control files; full decode follows control. */
  controlDecode?: (style: MusicStyle, read: AudioRead, decode: AudioDecode, onFile?: () => void) => Promise<LevelAudioBank>;
  decode: (style: MusicStyle, read: AudioRead, decode: AudioDecode, onFile?: () => void) => Promise<LevelAudioBank>;
}

/** A level with no audio files leaves `audio.preload` out; boot uses this (no music, no SFX samples, nothing to decode). */
export const NO_AUDIO: LevelAudioProfile = {
  files: () => ({ music: [], sfx: [] }),
  bootFiles: () => [],
  decode: () => Promise.resolve({ title: undefined, score: { slots: new Map(), stings: new Map() }, cues: { loops: new Map(), shots: new Map() } }),
};

/** Optional trusted decode hook for an existing sprite catalogue; no playback or scheduling. */
export interface AudioCatalogueExtras {
  readonly files: () => readonly string[];
  readonly decode: (read: AudioRead, onFile?: () => void) => Promise<void>;
}
/** Declared download/decode routing over the existing music and sample catalogues.
 * Selected sets keep their original order; an overlay replaces matching samples
 * without changing recordings, gains, the decoder, sound clocks or randomness.
 */
export async function createCatalogueAudio(data: AudioData, extras?: AudioCatalogueExtras): Promise<LevelAudioProfile> {
  if(data.music?.setCatalogue!==undefined)return createScoreSetAudio(data);
  let catalogueExtras=extras;
  if(catalogueExtras===undefined&&data.bank?.catalogue!==undefined){
    const {declaredCatalogue}=await import('./declaredBank');
    const policy=data.bank.catalogue,catalogue=declaredCatalogue(policy);
    catalogueExtras={files:()=>catalogue.shotFiles(),decode:async(read,onFile)=>{await declaredCatalogue(policy,read).decodeShots(onFile);}};
  }
  const samples = data.samples, music = data.music, policy = samples?.catalogue;
  if (samples === undefined || music === undefined || policy === undefined) throw new Error('Missing declared audio catalogue');
  const [{ audioFiles, musicDir, sfxDir }, { musicManifests, sfxManifests }, { getMusicStyle, getSfxSet }, { styleFiles, decodeStyle }, { sfxFiles, sfxBedFiles, decodeSfxSet }] = await Promise.all([
    import('../boot/audioFiles'), import('../../../shared/engine/boot/tables'), import('../ui/Settings'), import('./Stems'), import('./preload'),
  ]);
  const levels = { loopGains: samples.loopGains };
  const ownMusic = (): string[] => {
    const genre = getMusicStyle(), key = `${samples.set}-${genre}`;
    return policy.ownMusic && genre !== 'synth' && Object.hasOwn(musicManifests(), key) ? [key] : [];
  };
  const ownSfx = (): string[] => Object.hasOwn(sfxManifests(), samples.set) ? [samples.set] : [];
  const selectedSfx = (): string[] => [...sfxFiles(getSfxSet(), samples.bed, levels),
    ...(policy.overlaySamples && getSfxSet() !== 'synth' ? sfxFiles(samples.set, samples.bed, levels) : []),
    ...(getSfxSet() === 'synth' ? [] : catalogueExtras?.files() ?? [])];
  const decodeSamples = async (read: AudioRead, decode: AudioDecode, onFile?: () => void): Promise<SfxBank> => {
    if (!policy.overlaySamples) return decodeSfxSet(getSfxSet(), samples.bed, read, onFile, decode, levels);
    const set = getSfxSet(), [base, own] = await Promise.all([
      decodeSfxSet(set, samples.bed, read, onFile, decode, levels),
      decodeSfxSet(set === 'synth' ? 'synth' : samples.set, samples.bed, read, onFile, decode, levels),
    ]);
    const loops = new Map([...base.loops, ...own.loops]); base.loops.clear();
    for (const name of policy.loopOrder) { const loop = loops.get(name); if (loop) base.loops.set(name, loop); }
    for (const [id, loop] of loops) if (!base.loops.has(id)) base.loops.set(id, loop);
    for (const [id, shot] of own.shots) base.shots.set(id, shot);
    return base;
  };
  return {
    files: () => audioFiles({ omitSlots: policy.inventoryOmitSlots, musicSets: ownMusic(), sfxSets: ownSfx() }),
    ...(policy.priorityOwn ? { priorityFiles: () => {
      const files = audioFiles({ musicSets: ownMusic(), sfxSets: ownSfx() }), dirs = [...ownMusic().map(musicDir), ...ownSfx().map(sfxDir)];
      return [...files.music, ...files.sfx].filter(url => dirs.some(dir => url.startsWith(dir)));
    } } : {}),
    bootFiles: style => [...styleFiles(style, music.bootSlots), ...selectedSfx()],
    titleFiles: style => {
      const played = new Set(styleFiles(style, music.bootSlots.filter(slot => slot !== 'title'), false));
      return styleFiles(style, ['title'], false).filter(url => !played.has(url));
    },
    controlFiles: style => [...styleFiles(style, music.bootSlots, false, music.controlTension !== 'late'), ...sfxBedFiles(getSfxSet(), samples.bed, levels),
      ...(policy.overlaySamples && getSfxSet() !== 'synth' ? sfxBedFiles(samples.set, samples.bed, levels) : [])],
    ...(music.controlTension === 'late' ? { controlDecode: async (style: MusicStyle, read: AudioRead, decode: AudioDecode, onFile?: () => void): Promise<LevelAudioBank> => {
      const [title, bank] = await Promise.all([
        decodeStyle(style, music.bootSlots, read, decode, onFile, 'base', [], false).catch(() => undefined), decodeSamples(read, decode, onFile),
      ]);
      return { title, samples: bank, score: { slots: new Map(), stings: new Map() }, cues: { loops: new Map(), shots: new Map() } };
    } } : {}),
    decode: async (style, read, decode, onFile) => {
      const [title, bank] = await Promise.all([
        decodeStyle(style, music.bootSlots, read, decode, onFile).catch(() => undefined), decodeSamples(read, decode, onFile),
        ...(getSfxSet() === 'synth' || catalogueExtras === undefined ? [] : [catalogueExtras.decode(read, onFile)]),
      ]);
      return { title, samples: bank, score: { slots: new Map(), stings: new Map() }, cues: { loops: new Map(), shots: new Map() } };
    },
  };
}

/** A declared score set retains the native title, counted decode and optional cue overlay order. */
async function createScoreSetAudio(data:AudioData):Promise<LevelAudioProfile> {
  const music=data.music,samples=data.samples,policy=music?.setCatalogue,set=music?.source;
  if(music===undefined||samples===undefined||policy===undefined||set===undefined||set===null)throw new Error('Missing score set catalogue');
  const [{audioFiles},{musicManifest,shipped,styleFiles,decodeStyle},{scoreFiles,decodeScore},{cueFiles,decodeCueSet},{sfxFiles,sfxBedFiles,decodeSfxSet},{MUSIC_STYLES,getSfxSet}]=await Promise.all([
    import('../boot/audioFiles'),import('./Stems'),import('./SetScore'),import('./Cues'),import('./preload'),import('../ui/Settings'),
  ]);
  const slots=music.bootSlots.filter(slot=>slot!=='title');
  const titleFiles=(genre:MusicStyle):string[]=>{
    if(policy.inventory==='base')return styleFiles(genre,['title']);
    const title=musicManifest(genre)?.slots['title'];return title?[`/assets/music/${genre}/${title.calm}`].filter(shipped):[];
  };
  const scoreSlots=(genre:MusicStyle):readonly string[]=>genre==='synth'&&!policy.bootSynth?[]:slots;
  const bootScore=(genre:MusicStyle):string[]=>genre==='synth'&&!policy.bootSynth?[]:scoreFiles(set,slots);
  const useCues=():boolean=>!policy.cueOverlay||getSfxSet()!=='synth';
  return {
    files:()=>{const base=policy.inventory==='base'?audioFiles():{music:MUSIC_STYLES.flatMap(titleFiles),sfx:[]};return {music:[...base.music,...scoreFiles(set)],sfx:[...base.sfx,...cueFiles(samples.set)]};},
    ...(policy.priority?{priorityFiles:()=>[...scoreFiles(set),...cueFiles(samples.set)]}:{}),
    bootFiles:style=>[...titleFiles(style),...(policy.baseSamples?sfxFiles(getSfxSet(),samples.bed):[]),
      ...(policy.cueOverlay?(useCues()?cueFiles(samples.set):[]):bootScore(style)),
      ...(policy.cueOverlay?bootScore(style):cueFiles(samples.set))],
    titleFiles,
    controlFiles:style=>[...(policy.inventory==='base'?styleFiles(style,['title'],false):titleFiles(style)),
      ...scoreFiles(set,scoreSlots(style),false),...(policy.baseSamples?sfxBedFiles(getSfxSet(),samples.bed):[])],
    decode:async(genre,read,decode,onFile)=>{
      const [title,score,cues,bank]=await Promise.all([
        decodeStyle(genre,['title'],read,decode,onFile,'base',policy.titleStings?undefined:[]).catch(()=>undefined),
        decodeScore(set,scoreSlots(genre),read,decode,policy.bootSynth||genre!=='synth',onFile),
        useCues()?decodeCueSet(samples.set,read,decode,onFile):Promise.resolve<CueBank>({loops:new Map(),shots:new Map()}),
        policy.baseSamples?decodeSfxSet(getSfxSet(),samples.bed,read,onFile,decode):Promise.resolve(undefined),
      ]);
      if(policy.cueOverlay&&bank!==undefined){
        for(const [id,loop] of cues.loops)bank.loops.set(id.slice(id.indexOf('.')+1),loop);
        for(const [id,clips] of cues.shots)bank.shots.set(id,{bufs:clips.map(clip=>clip.buffer),gain:clips[0]?.gain??1});
      }
      return {title,score,cues,...(bank===undefined?{}:{samples:bank})};
    },
  };
}
