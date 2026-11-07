// The synth score the engine's Music plays (E405 LAYER-PURITY: the score itself is content — the game's is
// src/client/game/audio/theme.ts, installed by the composition root): arrangements of segments, a chord vocabulary, the
// Dorian shadow the alert / combat states colour it with, and the three stings.

export type LayerId = 'drone' | 'pad' | 'pluck' | 'marimba' | 'bass' | 'pulse' | 'bell';
/** the mixer's keys: every layer, the pulse's three sub-buses, and the two bus effects */
export type MixKey = LayerId | 'pulse.soft' | 'pulse.kick' | 'pulse.four' | 'lpf' | 'chorus';
export type Mode = 'lydian' | 'dorian';
/** a chord's name in the score's own vocabulary */
export type ChordName = string;

export interface NoteEv { t: number; d: number; n: number; v?: number | undefined }
export interface ChordEv { t: number; chord: ChordName }
export interface MixEv { t: number; key: MixKey; level: number; ramp?: number | undefined }
export interface Segment {
  id: string;
  /** absolute start in seconds (trailer arrangements); undefined = follows the previous segment */
  at?: number;
  bpm: number;
  /** length in beats. Trailer segments may be fractional; the engine schedules in 4-beat bars, the last one short. */
  beats: number;
  chords: ChordEv[];
  notes: Partial<Record<Exclude<LayerId, 'drone' | 'pad'>, NoteEv[]>>;
  mix?: MixEv[];
  /** the sections the calm in-game state lets the motif through (project/archive/2026-09-23-music.md: "motif every ~40 s") */
  calmMotif?: boolean;
}
export interface Arrangement {
  name: string;
  segments: Segment[];
  /** after the last non-tail segment, continue from this segment index (the theme loops D → B) */
  loopTo?: number;
  /** segments after this index only play on stop / in the offline render (the ring-out) */
  tailFrom?: number;
  /** the mixer follows the arrangement's own mix events (trailer + title voicing) rather than the game state */
  driven: boolean;
}

/** everything Music needs of a score */
export interface Score {
  readonly arrangements: Readonly<Partial<Record<string, Arrangement>>>;
  /** a chord's voicing (MIDI pitches) and its root */
  readonly chords: Readonly<Partial<Record<ChordName, readonly number[]>>>;
  readonly chordRoot: Readonly<Partial<Record<ChordName, number>>>;
  /** the darker chord the alert / combat states swap each one for, and the matching pitch shift */
  readonly dorianOf: Readonly<Partial<Record<ChordName, ChordName>>>;
  readonly dorianPitch: (n: number) => number;
  readonly stings: {
    readonly pickup: readonly NoteEv[];
    readonly death: { readonly chords: readonly [ChordName, ChordName]; readonly bass: readonly NoteEv[] };
    readonly chunk: { readonly chord: ChordName; readonly bell: readonly NoteEv[] };
  };
}

let installed: Score | null = null;
export function installScore(value: Score): void { installed = value; }
export function score(): Score {
  if (installed === null) throw new Error('Music: no score installed (the composition root installs the game\'s: installScore)');
  return installed;
}
