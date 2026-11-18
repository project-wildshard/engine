// @vitest-environment node
// SHARD-SOURCE SS-GP4b: a grid data cell's declared audio beyond `audio.scene`. A one-shard page installs its cues, score
// mode and synth bed (`client.ts`, `installDeclaredAudio`); a grid copy bound only an Open Plot's audio scene, so the
// Template's sword cues fell through and its forest bed never played on a grid cell. While the feet stand in the copy its
// cue table answers first, its score mode holds and its bed plays; all of it leaves with the stay.
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CombatCues } from '@wildshard/engine/combat/cues';
import type { AudioData } from '@wildshard/format/audio';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { cellDeclaredAudio, installCellAudio, type DataCellAudioPorts } from './dataCellAudio';

// the Template's built `audio` section (sdk 0.4.8, `new`)
const audio = { ambience: { bed: 'forest', winds: [{ frequency: 260, gain: 0.11, pan: -0.55, q: 0.5, rate: 0.07 }] },
  cues: [{ id: 'cue.sword.swing', voice: 'sword.swing' }, { id: 'cue.swap', voice: 'weapon.swap' }], routing: [], score: 'silent' } as unknown as AudioData;
const copy = (data: Partial<AudioData>, runtime: unknown = null): Shardfile => ({ runtime, audio: { ...audio, ...data } }) as unknown as Shardfile;

test('which copies install declared audio on a grid stay', () => {
  expect(cellDeclaredAudio(copy({}))).toEqual(audio);
  expect(cellDeclaredAudio(copy({}, { wasm: 'x' }))).toBeNull(); // a runtime shard's hooks own its audio
  expect(cellDeclaredAudio(copy({ scene: {} } as unknown as Partial<AudioData>))).toBeNull(); // an Open Plot's scene is AU20's
  expect(cellDeclaredAudio(copy({ music: {} } as unknown as Partial<AudioData>))).toBeNull(); // catalogue profiles need the page's installers
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
