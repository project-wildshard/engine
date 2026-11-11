// VOICE-POLISH V7, V8 (meta docs/plans/VOICE-POLISH-PLAN.md): voice chat (src/client/host/online/voice.ts) and the bodies of
// the other players (otherPlayers.ts) meet here, so neither imports the other. The bodies say how far away a Name stands; voice
// says which Names are talking. Voice links know a player by the Name the relay gives (the seat's Name, the same one the player
// row carries as `name`), so no field is added to the wire: positions come from the rows the page already draws.

/** Full volume this close; past it voice fades, and from `VOICE_SILENT_M` on it is silent (J218's proximity, 40 m). */
export const VOICE_FULL_M = 5, VOICE_SILENT_M = 40;

/** How loud a voice is at `metres`, 0 to 1: full near, a smooth fade, silent from 40 m. */
export function voiceGain(metres: number): number {
  if (!(metres > VOICE_FULL_M)) return 1;
  if (metres >= VOICE_SILENT_M) return 0;
  const t = (metres - VOICE_FULL_M) / (VOICE_SILENT_M - VOICE_FULL_M);
  return 1 - t * t * (3 - 2 * t);
}

/** Where the other players stand, as the page draws them. */
export interface VoiceBodies {
  /** Metres from this player to the nearest body with this Name; null when no such body is in view (rows reach 160 m). */
  readonly distanceTo: (name: string) => number | null;
}

let bodies: VoiceBodies | null = null;
let talking: ReadonlySet<string> = new Set<string>();

export const voiceNear = {
  /** The page's bodies, while it has any: null on a page with no world (a harness, single player), where voice stays cell-wide. */
  get bodies(): VoiceBodies | null { return bodies; },
  /** Set by the other players' bodies; the returned function takes it back. */
  lend(source: VoiceBodies): () => void { bodies = source; return () => { if (bodies === source) bodies = null; }; },
  /** How loud a Name is here: 1 with no bodies to measure by, 0 for a Name with no body in view. */
  gain(name: string): number {
    if (bodies === null) return 1;
    const metres = bodies.distanceTo(name);
    return metres === null ? 0 : voiceGain(metres);
  },
  /** The Names this player hears talking now (V8's ring over their heads). */
  get talking(): ReadonlySet<string> { return talking; },
  set talking(names: ReadonlySet<string>) { talking = names; },
};
