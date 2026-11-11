// VOICE-POLISH V7, V8 (meta docs/plans/VOICE-POLISH-PLAN.md): voice chat (src/client/host/online/voice.ts) and the bodies of
// the other players (otherPlayers.ts) meet here, so neither imports the other. The bodies say how far away a talker stands; voice
// says who is talking. The relay names each voice peer's body by its player row's id (`body`, the id the wire already gives every
// row), so two players who share a Name are never mixed up; an older server that names no body falls back to the Name.
// Positions come from the rows the page already draws: nothing is added to the game wire.

/** Full volume this close; past it voice fades, and from `VOICE_SILENT_M` on it is silent (J218's proximity, 40 m). */
export const VOICE_FULL_M = 5, VOICE_SILENT_M = 40;

/** How loud a voice is at `metres`, 0 to 1: full near, a smooth fade, silent from 40 m. */
export function voiceGain(metres: number): number {
  if (!(metres > VOICE_FULL_M)) return 1;
  if (metres >= VOICE_SILENT_M) return 0;
  const t = (metres - VOICE_FULL_M) / (VOICE_SILENT_M - VOICE_FULL_M);
  return 1 - t * t * (3 - 2 * t);
}

/** Who a voice belongs to: their player row's id where the relay says it, and their Name. */
export interface Talker { readonly body: string | null; readonly name: string }
/** The key a talker goes by in `voiceNear.talking`: the body's id, or the Name where no body is known. */
export const talkerKey = (talker: Talker): string => talker.body ?? `name:${talker.name}`;

/** Where the other players stand, as the page draws them. */
export interface VoiceBodies {
  /** Metres from this player to the talker's body (by its id, else the nearest with the Name); null when it isn't in view
   *  (player rows reach 160 m). */
  readonly distanceTo: (talker: Talker) => number | null;
}

/** What both sides share. The online shell is its own bundle (`online.js`, loaded by clientWorker.ts) with its own copy of this
 *  module, so the state lives on the page, under one key, not in a module variable. */
interface Shared { bodies: VoiceBodies | null; talking: ReadonlySet<string> }
const KEY = Symbol.for('wildshard.voiceNear');
const shared = (): Shared => {
  const page = globalThis as { [KEY]?: Shared };
  page[KEY] ??= { bodies: null, talking: new Set<string>() };
  return page[KEY];
};

export const voiceNear = {
  /** The page's bodies, while it has any: null on a page with no world (a harness, single player), where voice stays cell-wide. */
  get bodies(): VoiceBodies | null { return shared().bodies; },
  /** Set by the other players' bodies; the returned function takes it back. */
  lend(source: VoiceBodies): () => void { shared().bodies = source; return () => { if (shared().bodies === source) shared().bodies = null; }; },
  /** How loud a talker is here: 1 with no bodies to measure by, 0 for one whose body isn't in view. */
  gain(talker: Talker): number {
    const { bodies } = shared();
    if (bodies === null) return 1;
    const metres = bodies.distanceTo(talker);
    return metres === null ? 0 : voiceGain(metres);
  },
  /** Who this player hears talking now, by `talkerKey` (V8's ring over their heads). */
  get talking(): ReadonlySet<string> { return shared().talking; },
  set talking(keys: ReadonlySet<string>) { shared().talking = keys; },
};
