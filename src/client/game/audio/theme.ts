// src/client/game/audio/theme.ts — the Wildshard theme as data (project/archive/2026-09-23-music.md; moved from the engine, E405:
// the engine's Music plays whichever score the composition root installs).
//
// One piece of material, three arrangements of it:
//   THEME      the in-game / title score: A intro · B theme · C build · D lift · ring-out — 32 bars at 104 that loop
//              bar 32 → bar 9 (segment D → segment B). Tempo/mode/mix are the engine's (src/client/engine/audio/Music.ts setState).
//   TRAILER30  the same motif, chords and patterns re-timed so every section boundary lands on a cut of
//              scripts/trailer/edl-30.txt (segments carry an absolute `at` in seconds and their own bpm).
//   TRAILER15  intro → motif → hit, on the cuts of edl-15.txt.
//
// Pitches are MIDI numbers (D4 = 62). Times are BEATS from the segment start; a segment is a run of bars at one tempo.
// Layers: drone · pad · pluck · marimba · bass · pulse · bell. drone and pad are derived from the chord track
// (the engine voices them); the other five carry explicit notes. Pulse notes use the GM drum map so the MIDI
// export is a drum track: 36 kick (1 & 3) · 35 four-on-the-floor kick (2 & 4) · 38 tap (2 & 4) · 42 shaker.
// Mix events automate the layer mixer (0..1) and two bus effects: 'lpf' (music-bus low-pass, Hz) and 'chorus' (wet 0..1).

import type { Arrangement, ChordEv, MixEv, MixKey, NoteEv, Score, Segment } from '@wildshard/engine/audio/score/score';

type ChordName = 'Dmaj7#11' | 'E7' | 'Bm9' | 'A' | 'Dm9' | 'Gm' | 'Am' | 'Bb';

// ─────────────────────────────────────────── pitch material ───────────────────────────────────────────
const D4 = 62, E4 = 64, Gs4 = 68, A4 = 69, B4 = 71;
/** D Lydian: D E F# G# A B C# — the raised 4th is the wonder note */
export const LYDIAN: number[] = [0, 2, 4, 6, 7, 9, 11];
/** Base MIDI note for the shared score. */
export const ROOT = 62; // D4

/** the motif: `D A G# A | E D · · | D A B A | G# E D ·` — 16 beats, two of question, two of answer */
export const MOTIF: NoteEv[] = [
  { t: 0, d: 1, n: D4 }, { t: 1, d: 1, n: A4 }, { t: 2, d: 1, n: Gs4 }, { t: 3, d: 1, n: A4 },
  { t: 4, d: 1, n: E4 }, { t: 5, d: 2, n: D4 },
  { t: 8, d: 1, n: D4 }, { t: 9, d: 1, n: A4 }, { t: 10, d: 1, n: B4 }, { t: 11, d: 1, n: A4 },
  { t: 12, d: 1, n: Gs4 }, { t: 13, d: 1, n: E4 }, { t: 14, d: 2, n: D4 },
];

/** the pad voicings (4 voices, D3 register) */
export const CHORDS: Record<ChordName, number[]> = {
  'Dmaj7#11': [50, 57, 61, 68], // D  A  C# G#   — root · 5 · maj7 · #11
  'E7':       [52, 56, 59, 62], // E  G# B  D    — the Lydian II (the 7th is the mode's D, so the motif's D never clashes)
  'Bm9':      [47, 50, 57, 61], // B  D  A  C#
  'A':        [45, 52, 57, 61], // A  E  A  C#
  'Dm9':      [50, 53, 60, 64], // D  F  C  E
  'Gm':       [43, 50, 55, 58], // G  D  G  Bb
  'Am':       [45, 52, 57, 60], // A  E  A  C
  'Bb':       [46, 53, 58, 62], // Bb F  Bb D
};
/** the Dorian turn: the four Lydian bars darkened, same bar positions */
export const DORIAN_OF: Record<ChordName, ChordName> = {
  'Dmaj7#11': 'Dm9', 'E7': 'Gm', 'Bm9': 'Am', 'A': 'Bb', 'Dm9': 'Dm9', 'Gm': 'Gm', 'Am': 'Am', 'Bb': 'Bb',
};
/** Bass root note for each shared chord. */
export const CHORD_ROOT: Record<ChordName, number> = { 'Dmaj7#11': 38, 'E7': 40, 'Bm9': 35, 'Am': 33, 'A': 33, 'Dm9': 38, 'Gm': 31, 'Bb': 34 };

/** pitch class G# → G is the only note the Dorian version changes (MUSIC.md: the melody stays, the harmony darkens) */
export function dorianPitch(n: number): number { return (n - ROOT) % 12 === 6 || (n - ROOT) % 12 === -6 ? n - 1 : n; }

/** the diatonic third above `n` in D Lydian (the build harmonises the motif in thirds) */
export function thirdAbove(n: number, scale: number[] = LYDIAN): number {
  const rel = n - ROOT, oct = Math.floor(rel / 12), pc = ((rel % 12) + 12) % 12;
  let deg = scale.indexOf(pc); if (deg < 0) deg = scale.findIndex((s) => s > pc) - 1;
  const up = deg + 2, o = oct + Math.floor(up / 7);
  return ROOT + o * 12 + (scale[((up % 7) + 7) % 7] ?? 0);
}

// ─────────────────────────────────────────── pattern helpers ───────────────────────────────────────────
const shift = (notes: NoteEv[], t0: number, rate = 1, semis = 0, v?: number): NoteEv[] =>
  notes.map((x) => ({ t: t0 + x.t / rate, d: x.d / rate, n: x.n + semis, v: v ?? x.v }));
/** the motif starting at beat t0; rate 2 = eighth notes (the trailer); semis 12 = up the octave (the lift) */
export const motif = (t0: number, rate = 1, semis = 0, v?: number): NoteEv[] => shift(MOTIF, t0, rate, semis, v);
/** the motif and its third, interleaved (the build) */
export const motifThirds = (t0: number, rate = 1, semis = 0, v = 0.8): NoteEv[] =>
  motif(t0, rate, semis).flatMap((x) => [x, { ...x, n: thirdAbove(x.n), v: v * 0.7 }]);
/** bass roots: one note per chord change, held to the next (or every `every` beats) */
const bassLine = (chords: ChordEv[], beats: number, every = 2, octave = 0, v = 0.9): NoteEv[] => {
  const out: NoteEv[] = [];
  for (let t = 0; t < beats; t += every) {
    const c = [...chords].reverse().find((x) => x.t <= t) ?? chords[0];
    if (c === undefined) throw new Error('bassLine: no chords');
    out.push({ t, d: Math.min(every, beats - t) * 0.9, n: CHORD_ROOT[c.chord as ChordName] + octave, v });
  }
  return out;
};
/** bass in eighths (combat / the build) */
const bassEighths = (chords: ChordEv[], beats: number) => bassLine(chords, beats, 0.5, 0, 0.8).map((x, i) => ({ t: x.t, n: x.n, d: 0.4, v: i % 2 ? 0.6 : 0.85 }));
/** the pulse: shaker eighths (42) · tap on 2 & 4 (38) · kick on 1 & 3 (36) · the four-on-the-floor kicks on 2 & 4 (35) */
const pulse = (beats: number, opts: { shaker?: boolean; tap?: boolean; kick?: boolean; four?: boolean; every?: number } = {}): NoteEv[] => {
  const out: NoteEv[] = [], bar = opts.every ?? 4;
  for (let t = 0; t < beats; t += 0.5) {
    const inBar = t % bar, onBeat = Number.isInteger(t);
    if (opts.shaker !== false) out.push({ t, d: 0.2, n: 42, v: onBeat ? 0.55 : 0.35 });
    if (onBeat && inBar % 2 === 1 && opts.tap !== false) out.push({ t, d: 0.2, n: 38, v: 0.7 });
    if (onBeat && inBar % 2 === 0 && opts.kick !== false) out.push({ t, d: 0.3, n: 36, v: 1 });
    if (onBeat && inBar % 2 === 1 && opts.four !== false) out.push({ t, d: 0.3, n: 35, v: 0.9 });
  }
  return out;
};
/** the notes at one velocity */
const vel = (notes: NoteEv[], v: number): NoteEv[] => notes.map((x) => ({ t: x.t, d: x.d, n: x.n, v }));
const bars = (...names: ChordName[]): ChordEv[] => names.map((chord, i) => ({ t: i * 4, chord }));
const mix = (pairs: [MixKey, number, number?][], t = 0): MixEv[] => pairs.map(([key, level, ramp]) => ({ t, key, level, ramp }));

// ─────────────────────────────────────────── THEME (the game / the title) ───────────────────────────────────────────
const BPM = 104;
const PHRASE: ChordName[] = ['Dmaj7#11', 'E7', 'Bm9', 'A', 'Dmaj7#11', 'E7', 'Bm9', 'Dmaj7#11'];
const P8 = bars(...PHRASE);
const A: Segment = {
  id: 'A', bpm: BPM, beats: 32,
  chords: [{ t: 0, chord: 'Dmaj7#11' }, { t: 8, chord: 'E7' }, { t: 16, chord: 'Bm9' }, { t: 24, chord: 'A' }],
  notes: { bell: [{ t: 16, d: 2, n: 74, v: 0.5 }, { t: 18, d: 3, n: 81, v: 0.4 }] },
  mix: [...mix([['drone', 0.9, 4], ['pad', 0.8, 5], ['pluck', 1], ['marimba', 1], ['bell', 1], ['bass', 0], ['pulse.soft', 0], ['pulse.kick', 0], ['pulse.four', 0]])],
};
const B: Segment = {
  id: 'B', bpm: BPM, beats: 32, calmMotif: true, chords: P8,
  notes: {
    pluck: motif(0, 1, 0, 0.9),
    marimba: motif(16, 1, 12, 0.85),
    bass: bassLine(P8, 32, 2),
    pulse: pulse(32),
  },
  mix: mix([['bass', 0.55, 2.3], ['pulse.soft', 0.45, 2.3]]),
};
const C: Segment = {
  id: 'C', bpm: BPM, beats: 32, chords: P8,
  notes: {
    pluck: motifThirds(0, 1, 0),
    marimba: motifThirds(16, 1, 12),
    bass: bassLine(P8, 32, 1),
    pulse: pulse(32),
  },
  mix: mix([['bass', 0.8, 2.3], ['pulse.soft', 0.7, 2.3], ['pulse.kick', 0.55, 2.3], ['pad', 0.9, 4.6]]),
};
const D: Segment = {
  id: 'D', bpm: BPM, beats: 32, calmMotif: true, chords: P8,
  notes: {
    pluck: [...motif(0, 1, 12, 0.95), ...motif(16, 1, 12, 0.95)],
    marimba: [...motifThirds(0, 1, 12, 0.9), ...motifThirds(16, 1, 12, 0.9)],
    bass: bassEighths(P8, 32),
    pulse: pulse(32),
  },
  mix: mix([['bass', 1, 2.3], ['pulse.soft', 1, 2.3], ['pulse.kick', 0.9, 2.3], ['pad', 1, 2.3], ['drone', 1, 2.3]]),
};
const RING: Segment = {
  id: 'ring', bpm: BPM, beats: 8, chords: [{ t: 0, chord: 'Dmaj7#11' }],
  notes: { bell: [{ t: 0, d: 4, n: 74, v: 0.8 }, { t: 0, d: 4, n: 81, v: 0.5 }], bass: [{ t: 0, d: 3, n: 38, v: 0.9 }], pulse: [{ t: 0, d: 0.3, n: 36, v: 1 }] },
  mix: [...mix([['pulse.soft', 0, 0.2], ['pulse.kick', 0, 0.2], ['pulse.four', 0, 0.2]], 0.2), ...mix([['bass', 0, 2], ['pad', 0, 3.5], ['drone', 0, 3.5], ['pluck', 0, 1], ['marimba', 0, 1]], 1)],
};
/** The looping shared theme arrangement. */
export const THEME: Arrangement = { name: 'theme', segments: [A, B, C, D, RING], loopTo: 1, tailFrom: 4, driven: false };

// ─────────────────────────────────────────── TRAILER 30 (scripts/trailer/edl-30.txt) ───────────────────────────────────────────
// Cuts (cumulative): title 0 · citadel 1.5 · pine-trail 3.5 · pine-ridge 5.0 · pier 6.2 · planet 8.0 · boars 9.6 · combo 10.8 · combo 12.8
// · heavy 14.0 · swim 15.0 · dive 16.4 · stairs 17.7 · bridge 19.3 · wreck 21.5 · shrine 23.1 · hero 24.6 · end card 28.1.
// Each segment's bpm is chosen so its beat count fits its picture exactly (104 ± a few, the cut was timed to 104).
const bpmFor = (beats: number, seconds: number) => (beats * 60) / seconds;
const beatsIn = (seconds: number, bpm: number) => (seconds * bpm) / 60;
const HALF = bars('Dmaj7#11', 'E7', 'Bm9', 'A').map((c) => ({ t: c.t / 2, chord: c.chord })); // the motif in eighths: a chord every 2 beats
const T30: Segment[] = [
  { id: 't30-title', at: 0, bpm: 104, beats: beatsIn(1.5, 104), chords: [{ t: 0, chord: 'Dmaj7#11' }], notes: {},
    mix: [...mix([['drone', 0, 0], ['pad', 0, 0], ['pluck', 1], ['marimba', 1], ['bell', 1], ['bass', 0], ['pulse.soft', 0], ['pulse.kick', 0], ['pulse.four', 0], ['lpf', 20000], ['chorus', 0]]),
      ...mix([['drone', 0.9, 1.3], ['pad', 0.55, 1.5]], 0.01)] },
  { id: 't30-vision', at: 1.5, bpm: 104, beats: beatsIn(2.0, 104), chords: [],
    notes: { bell: [{ t: 0, d: 2, n: 74, v: 0.55 }, { t: 1.733, d: 3, n: 81, v: 0.45 }] },
    mix: mix([['pad', 0.9, 1.8]]) },
  { id: 't30-motif', at: 3.5, bpm: bpmFor(8, 4.5), beats: 8, chords: HALF,
    notes: { pluck: motif(0, 2, 0, 0.9) }, mix: mix([['pad', 0.75, 2]]) },
  { id: 't30-pier', at: 8.0, bpm: bpmFor(8, 4.8), beats: 8, chords: HALF,
    notes: { marimba: motif(0, 2, 12, 0.85), bass: bassLine(HALF, 8, 1), pulse: pulse(8, { every: 2, kick: false, four: false }) },
    mix: mix([['bass', 0.8, 0.6], ['pulse.soft', 0.6, 0.6], ['pad', 0.8, 1]]) },
  { id: 't30-combat', at: 12.8, bpm: 100, beats: 6, chords: [{ t: 0, chord: 'Dmaj7#11' }, { t: 2, chord: 'Dm9' }, { t: 4, chord: 'Gm' }],
    notes: { bass: bassEighths([{ t: 0, chord: 'Dmaj7#11' }, { t: 2, chord: 'Dm9' }, { t: 4, chord: 'Gm' }], 6), pulse: pulse(6, { every: 2, tap: false }),
      marimba: [{ t: 0, d: 0.5, n: 74, v: 0.8 }, { t: 0.5, d: 0.5, n: 81, v: 0.7 }, { t: 1, d: 1, n: 80, v: 0.7 }, { t: 2, d: 0.5, n: 74, v: 0.8 }, { t: 2.5, d: 0.5, n: 81, v: 0.7 }, { t: 3, d: 1, n: 79, v: 0.75 }] },
    mix: [...mix([['pulse.kick', 1, 0.05], ['pulse.four', 1, 0.05], ['bass', 1, 0.3]]),
      // 15.0 – 16.4: the dive — the whole music bus under water
      ...mix([['lpf', 600, 0.45], ['chorus', 0.6, 0.6], ['pulse.soft', 0.2, 0.4]], 2.2 / 0.6)] },
  { id: 't30-build', at: 16.4, bpm: bpmFor(9, 5.1), beats: 9, chords: [...HALF, { t: 8, chord: 'A' }],
    notes: { pluck: motifThirds(0, 2, 0, 0.9), marimba: motifThirds(0, 2, 12, 0.7), bass: bassEighths([...HALF, { t: 8, chord: 'A' }], 9), pulse: pulse(9, { every: 2, tap: false }) },
    mix: [...mix([['lpf', 20000, 5.0], ['chorus', 0, 2.5], ['pulse.soft', 0.8, 2], ['pad', 0.9, 4]])] },
  { id: 't30-lift', at: 21.5, bpm: bpmFor(6, 3.1), beats: 6, chords: [{ t: 0, chord: 'Dm9' }, { t: 2, chord: 'Gm' }, { t: 4, chord: 'A' }],
    notes: {
      pluck: vel([{ t: 0, d: 0.5, n: 74 }, { t: 0.5, d: 0.5, n: 81 }, { t: 1, d: 0.5, n: 83 }, { t: 1.5, d: 0.5, n: 81 }, { t: 2, d: 0.5, n: 79 }, { t: 2.5, d: 0.5, n: 76 }, { t: 3, d: 1, n: 74 }, { t: 4, d: 0.5, n: 81 }, { t: 4.5, d: 0.5, n: 83 }, { t: 5, d: 1, n: 85 }], 0.95),
      marimba: vel([{ t: 0, d: 0.5, n: 86 }, { t: 0.5, d: 0.5, n: 93 }, { t: 1, d: 0.5, n: 95 }, { t: 1.5, d: 0.5, n: 93 }, { t: 2, d: 0.5, n: 91 }, { t: 2.5, d: 0.5, n: 88 }, { t: 3, d: 1, n: 86 }, { t: 4, d: 0.5, n: 93 }, { t: 4.5, d: 0.5, n: 95 }, { t: 5, d: 1, n: 97 }], 0.75),
      bass: bassEighths([{ t: 0, chord: 'Dm9' }, { t: 2, chord: 'Gm' }, { t: 4, chord: 'A' }], 6), pulse: pulse(6, { every: 2, tap: false }),
    },
    mix: mix([['pad', 1, 1], ['drone', 1, 1], ['pulse.soft', 1, 1], ['pluck', 1], ['marimba', 1]]) },
  { id: 't30-end', at: 24.6, bpm: 104, beats: 6, chords: [{ t: 0, chord: 'Dmaj7#11' }],
    notes: { bell: [{ t: 0, d: 4, n: 74, v: 0.9 }, { t: 0, d: 4, n: 81, v: 0.55 }, { t: 0.02, d: 4, n: 62, v: 0.35 }], bass: [{ t: 0, d: 3, n: 38, v: 1 }], pulse: [{ t: 0, d: 0.3, n: 36, v: 1 }],
      marimba: [{ t: 0, d: 2, n: 86, v: 0.6 }] },
    mix: [...mix([['pulse.soft', 0, 0.3], ['pulse.four', 0, 0.3], ['pulse.kick', 0, 0.3], ['pluck', 0, 0.5]], 0.3),
      ...mix([['bass', 0, 1.6], ['drone', 0, 2.6], ['pad', 0, 2.6], ['marimba', 0, 2], ['bell', 0, 2.8]], 0.5)] },
];
/** The thirty-second trailer arrangement. */
export const TRAILER30: Arrangement = { name: 'trailer30', segments: T30, driven: true };

// ─────────────────────────────────────────── TRAILER 15 (scripts/trailer/edl-15.txt) ───────────────────────────────────────────
// Cuts: title 0 · citadel 1.0 · pine-trail 2.2 · pier 3.1 · planet 4.3 · combo 5.3 · dive 6.7 · bridge 7.6 · wreck 8.6 · shrine 10.1 · hero 11.1 · end card 12.1 – 14.9.
const T15: Segment[] = [
  { id: 't15-title', at: 0, bpm: 104, beats: beatsIn(1.0, 104), chords: [{ t: 0, chord: 'Dmaj7#11' }], notes: {},
    mix: [...mix([['drone', 0, 0], ['pad', 0, 0], ['pluck', 1], ['marimba', 1], ['bell', 1], ['bass', 0], ['pulse.soft', 0], ['pulse.kick', 0], ['pulse.four', 0], ['lpf', 20000], ['chorus', 0]]),
      ...mix([['drone', 0.9, 0.9], ['pad', 0.6, 1.0]], 0.01)] },
  { id: 't15-vision', at: 1.0, bpm: 104, beats: beatsIn(1.2, 104), chords: [], notes: { bell: [{ t: 0, d: 2, n: 74, v: 0.55 }, { t: 1.2, d: 3, n: 81, v: 0.45 }] }, mix: mix([['pad', 0.9, 1.1]]) },
  { id: 't15-motif', at: 2.2, bpm: bpmFor(8, 4.5), beats: 8, chords: HALF, notes: { pluck: motif(0, 2, 0, 0.9) }, mix: mix([['pad', 0.75, 2]]) },
  { id: 't15-drive', at: 6.7, bpm: 100, beats: 9, chords: [...HALF, { t: 8, chord: 'A' }],
    notes: { pluck: motifThirds(0, 2, 0, 0.9), marimba: [...motifThirds(0, 2, 12, 0.75), { t: 8, d: 0.5, n: 81, v: 0.8 }, { t: 8.5, d: 0.5, n: 83, v: 0.85 }], bass: bassEighths([...HALF, { t: 8, chord: 'A' }], 9), pulse: pulse(9, { every: 2, tap: false }) },
    mix: mix([['bass', 1, 0.3], ['pulse.soft', 0.8, 0.3], ['pulse.kick', 1, 0.05], ['pulse.four', 1, 0.05], ['pad', 0.9, 2]]) },
  { id: 't15-end', at: 12.1, bpm: 104, beats: 4.5, chords: [{ t: 0, chord: 'Dmaj7#11' }],
    notes: { bell: [{ t: 0, d: 4, n: 74, v: 0.9 }, { t: 0, d: 4, n: 81, v: 0.55 }, { t: 0.02, d: 4, n: 62, v: 0.35 }], bass: [{ t: 0, d: 2.5, n: 38, v: 1 }], pulse: [{ t: 0, d: 0.3, n: 36, v: 1 }], marimba: [{ t: 0, d: 2, n: 86, v: 0.6 }] },
    mix: [...mix([['pulse.soft', 0, 0.3], ['pulse.four', 0, 0.3], ['pulse.kick', 0, 0.3], ['pluck', 0, 0.5]], 0.3),
      ...mix([['bass', 0, 1.2], ['drone', 0, 1.9], ['pad', 0, 1.9], ['marimba', 0, 1.5], ['bell', 0, 2.0]], 0.5)] },
];
/** The fifteen-second trailer arrangement. */
export const TRAILER15: Arrangement = { name: 'trailer15', segments: T15, driven: true };

/** The finite shared arrangement catalogue. */
export const ARRANGEMENTS: { readonly theme: Arrangement; readonly trailer30: Arrangement; readonly trailer15: Arrangement; } = { theme: THEME, trailer30: TRAILER30, trailer15: TRAILER15 } as const;
/** A key in the shared arrangement catalogue. */
export type ArrangementName = keyof typeof ARRANGEMENTS;

/** the pickup sting: the first four motif notes on the bell, eighths */
export const STING_PICKUP: NoteEv[] = MOTIF.slice(0, 4).map((x) => ({ t: x.t / 2, d: 0.9, n: x.n + 12, v: 0.6 }));
/** the death sting: the minor turn — Dm9 then Gm — with a low D */
export const STING_DEATH: { chords: [ChordName, ChordName]; bass: NoteEv[] } = { chords: ['Dm9', 'Gm'], bass: [{ t: 0, d: 2, n: 38, v: 0.9 }] };
/** the chunk sting: the resolve chord — the trailer's end-card hit */
export const STING_CHUNK: { chord: ChordName; bell: NoteEv[] } = { chord: 'Dmaj7#11', bell: [{ t: 0, d: 4, n: 74, v: 0.7 }, { t: 0, d: 4, n: 81, v: 0.4 }] };

/** the game's score, as the engine's Music plays it (installed by src/client/app/pageServices.ts) */
export const WILDSHARD_SCORE: Score = {
  arrangements: ARRANGEMENTS, chords: CHORDS, chordRoot: CHORD_ROOT, dorianOf: DORIAN_OF, dorianPitch,
  stings: { pickup: STING_PICKUP, death: STING_DEATH, chunk: STING_CHUNK },
};
