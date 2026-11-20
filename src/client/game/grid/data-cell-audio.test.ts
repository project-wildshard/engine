// @vitest-environment node
// SHARD-SOURCE SS-GP4b: a grid data cell's declared audio beyond `audio.scene`. A one-shard page installs its cues, score
// mode and synth bed (`client.ts`, `installDeclaredAudio`); a grid copy bound only an Open Plot's audio scene, so the
// Template's sword cues fell through and its forest bed never played on a grid cell. While the feet stand in the copy its
// cue table answers first, its score mode holds and its bed plays; all of it leaves with the stay.
import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CatalogueScore } from '@wildshard/engine/audio/SetScore';
import { CombatCues } from '@wildshard/engine/combat/cues';
import type { AudioData } from '@wildshard/format/audio';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { cellDeclaredAudio, installCellAudio, type DataCellAudioPorts } from './dataCellAudio';
import { pageScore, pageScoreProfiles, stepCellScore, type CellScore } from '../shardfile/declaredScore';
import { sceneZoneWeights } from '@wildshard/engine/audio/declaredAmbience';
import { wirePage } from '../shardfile/wirePage';

// the Template's built `audio` section (sdk 0.4.8, `new`)
const audio = { ambience: { bed: 'forest', winds: [{ frequency: 260, gain: 0.11, pan: -0.55, q: 0.5, rate: 0.07 }] },
  cues: [{ id: 'cue.sword.swing', voice: 'sword.swing' }, { id: 'cue.swap', voice: 'weapon.swap' }], routing: [], score: 'silent' } as unknown as AudioData;
// MZ23: a score of the engine's piano slots (Mossgate's): day, night and a boss scene
const score: NonNullable<AudioData['music']> = { id: 'score.mossgate', base: 'pine', slots: ['pine', 'island', 'title'], bootSlots: [], synthLead: 'pluck', minFade: 0, source: null,
  sets: {}, selectMode: 'first', selection: [{ slots: ['island'], when: [{ field: 'scene', op: 'equals', value: 'night' }] }, { slots: ['title'], when: [{ field: 'scene', op: 'equals', value: 'boss' }] }],
  catalogue: { mode: 'slots', extraStings: [], stingSets: {} }, lifecycle: { persistent: false, dispose: true, logChanges: false, bossScene: 'boss' } };
const copy = (data: Partial<AudioData>, runtime: unknown = null): Shardfile => ({ runtime, audio: { ...audio, ...data } }) as unknown as Shardfile;

test('which copies install declared audio on a grid stay', () => {
  expect(cellDeclaredAudio(copy({}))).toEqual(audio);
  expect(cellDeclaredAudio(copy({}, { wasm: 'x' }))).toBeNull(); // a runtime shard's hooks own its audio
  expect(cellDeclaredAudio(copy({ scene: {} } as unknown as Partial<AudioData>))).toBeNull(); // an Open Plot's scene is AU20's
  expect(cellDeclaredAudio(copy({ music: {} } as unknown as Partial<AudioData>))).toBeNull(); // catalogue profiles need the page's installers
  expect(cellDeclaredAudio(copy({ music: { ...score, source: { dir: '/assets/music/own/', manifestKey: 'own' } } }))).toBeNull(); // its own recordings
  expect(cellDeclaredAudio(copy({ cues: [], ambience: null, score: 'default', music: score }))?.music).toEqual(score); // MZ23: engine slots
  expect(cellDeclaredAudio(copy({ cues: [], ambience: null, score: 'default' }))).toBeNull(); // nothing to install
});

test('a copy\'s cues answer first, its score is silent and its bed plays while entered; all of it leaves with the stay', () => {
  const played: string[] = [], beds = new Map<string, { start: () => void; stop: () => void }>(), silenced: Scope[] = [];
  let winds = 0;
  const cues = new CombatCues();
  const home = new Scope('home');
  cues.use((id) => { played.push(`home:${id}`); return true; }, home); // the home's own table
  const ports: DataCellAudioPorts = {
    audio: {
      installSynthBed: (id: string, bed: { start: () => void; stop: () => void }, scope: Scope) => { beds.set(id, bed); scope.onDispose(() => { beds.delete(id); }); },
      restartSynthBed: (id: string) => { beds.get(id)?.start(); },
      installCues: () => undefined,
      mkWind: () => { winds++; return { disconnect: () => { winds--; } }; },
    },
    cues, music: { silence: (scope) => { silenced.push(scope); } },
    voices: new Map([['sword.swing', () => { played.push('voice:sword.swing'); }], ['weapon.swap', () => { played.push('voice:weapon.swap'); }]]),
  };
  const stay = new Scope('grid.data-audio.fixture');
  installCellAudio(audio, stay, ports);
  cues.cue('cue.sword.swing');
  cues.cue('cue.other');
  expect(played).toEqual(['voice:sword.swing', 'home:cue.other']); // the copy's table first, the home's after it
  expect(silenced).toEqual([stay]);
  expect(beds.has('forest')).toBe(true);
  expect(winds).toBe(1);
  stay.dispose();
  played.length = 0;
  cues.cue('cue.sword.swing');
  expect(played).toEqual(['home:cue.sword.swing']); // the copy's table left with the stay
  expect(beds.has('forest')).toBe(false);
  expect(winds).toBe(0);
});

test('MZ23: a copy\'s engine-slot score plays while entered, day or night by the clock and its boss scene while a boss fights', () => {
  const scenes: string[] = [], combat: number[] = [], installed: Scope[] = [];
  let night: number | null = 0, boss = false;
  const playing: CellScore = { setScene: (name) => { scenes.push(name); }, combat: (intensity) => { combat.push(intensity); } };
  const ports: DataCellAudioPorts = {
    audio: { installSynthBed: () => undefined, restartSynthBed: () => undefined, installCues: () => undefined, mkWind: () => ({ disconnect: () => undefined }) },
    cues: new CombatCues(), music: { silence: () => { throw new Error('a score is not silent'); } }, voices: new Map(),
    score: { install: (profile, scope) => { expect(profile.id).toBe('score.mossgate'); installed.push(scope); return playing; }, scene: { night: () => night, boss: () => boss } },
  };
  vi.useFakeTimers();
  try {
    const stay = new Scope('grid.data-audio.score');
    installCellAudio({ ...audio, cues: [], ambience: null, score: 'default', music: score } as unknown as AudioData, stay, ports);
    expect(installed).toEqual([stay]);
    expect(scenes.at(-1)).toBe('day');
    night = 0.9; vi.advanceTimersByTime(600);
    expect(scenes.at(-1)).toBe('night');
    boss = true; vi.advanceTimersByTime(600);
    expect(scenes.at(-1)).toBe('boss');
    expect(combat.length).toBeGreaterThan(0);
    boss = false; night = null; vi.advanceTimersByTime(600);
    expect(scenes.at(-1)).toBe('day'); // no clock reads as day
    stay.dispose();
    const after = scenes.length; vi.advanceTimersByTime(2000);
    expect(scenes.length).toBe(after); // the driver left with the stay
  } finally { vi.useRealTimers(); }
});

test('MZ23: a one-shard page with no catalogue installer plays its own engine-slot score, and only that', () => {
  const play = {} as unknown as Parameters<typeof pageScoreProfiles>[1];
  expect(pageScoreProfiles({ music: score }, play)?.music).toBeTypeOf('function');
  expect(pageScoreProfiles({}, play)).toBeUndefined();
  expect(pageScoreProfiles({ music: { ...score, source: { dir: '/assets/music/own/', manifestKey: 'own' } } }, play)).toBeUndefined();
});

test('MSZ39: the race score reads the local start line, behind the boss scene', () => {
  const profile = { ...score, selection: [{ slots: ['island'], when: [{ field: 'scene', op: 'equals', value: 'race' }] }] } as NonNullable<AudioData['music']>;
  const playing = { setScene: vi.fn(), combat: vi.fn() };
  const line = vi.spyOn(wirePage, 'line').mockImplementation(id => id === 'race:arches.best' ? 28_000 : 0);
  const ports = pageScore({} as Parameters<typeof pageScore>[0], () => true, [{ id: 'arches' }]);
  const scene = { ...ports.scene, night: () => 0, boss: () => false };
  try {
    expect(stepCellScore(playing, profile, scene)).toBe('day');
    line.mockImplementation(id => id === 'race:arches' ? 42 : 0);
    expect(stepCellScore(playing, profile, scene)).toBe('race');
    expect(stepCellScore(playing, profile, { ...scene, boss: () => true })).toBe('boss');
    line.mockReturnValue(0);
    expect(stepCellScore(playing, profile, scene)).toBe('day');
  } finally { line.mockRestore(); }
});

test('MSZ39: a copy admits the simple synth profile and fades between the region and open ground', () => {
  const zones: NonNullable<AudioData['zones']> = {
    id: 'salt', graph: { beds: [{ id: 'flat', out: 'ambient' }, { id: 'pans', out: 'ambient' }], chains: [] },
    beds: [{ id: 'flat', zone: 'flat' }, { id: 'pans', zone: 'pans' }],
    rectangles: [{ id: 'pans', zone: 'pans', x0: 10, z0: 0, x1: 60, z1: 60 }], blendMetres: 10,
    levels: { flat: 0.12, pans: 0.2 }, tickHz: 8, smoothSeconds: 0.35, silentSeconds: 0, holdSeconds: 0, wet: {}, zones: [],
  };
  expect(cellDeclaredAudio(copy({ zones }))?.zones).toBe(zones);
  expect(sceneZoneWeights(zones, { x: 15, z: 20 })).toEqual(new Map([['flat', 0], ['pans', 1]]));
  expect(sceneZoneWeights(zones, { x: 5, z: 20 })).toEqual(new Map([['flat', 0.5], ['pans', 0.5]]));
  expect(sceneZoneWeights(zones, { x: -5, z: 20 })).toEqual(new Map([['flat', 1], ['pans', 0]]));
});

test('MSZ39: a warmed race slot asks for a cue-time start and other scenes keep their bar transitions', () => {
  const race = { slots: ['island'], when: [{ field: 'scene', op: 'equals', value: 'race' }] } as const;
  const profile = { ...score, bootSlots: ['pine', 'island'], selection: [...score.selection, race] };
  const music = { genre: 'piano' as const, state: { mode: 'calm' as const, intensity: 0, underwater: false, lead: 'pluck' as const },
    refreshScore: vi.fn(), combat: vi.fn(), sting: vi.fn() };
  const playing = new CatalogueScore(music, profile);
  expect(playing.cueSlot).toBeUndefined();
  playing.setScene('race');
  expect(playing.cueSlot).toBe('island');
  playing.setScene('boss');
  expect(playing.cueSlot).toBeUndefined();
});
