import type { ClientTileRegistration } from '../shardfile/tileContent';

/** The ports `stepRingsUntil` needs: the page loop's late-frame count, one ring step, and one turn's wait. */
export interface LoadingRingPorts {
  /** Late frames the page loop has run (each steps the rings itself); any at all ends the stepping here. */
  readonly frames: () => number;
  /** One ring step at the traveller's world feet. */
  readonly step: () => void;
  /** One turn: a frame's length while loading. */
  readonly wait: () => Promise<void>;
}

/** GO7: a grid page whose initial home is a data cell (Shard select's Template card enters template-2) pins its spawn tiles
 *  on the page's ring streamer and waits for them inside the loading step `home`, before the page loop runs. The streamer
 *  publishes only on `step`, so with no frame stepping it that wait never ended. Step the rings each turn until `entry` settles
 *  or the page loop runs its first late frame; from then on the loop owns them alone. */
export async function stepRingsUntil<T>(entry: Promise<T>, ports: LoadingRingPorts): Promise<T> {
  const state = { settled: false };
  const result = entry.finally(() => { state.settled = true; });
  const ended = result.then(() => 'settled' as const, () => 'settled' as const);
  // Once the loop has run one late frame it steps the rings every frame, slower than this wait or not (Codex: at 30 fps a
  // per-turn check stepped between its frames, a second upload budget in play), so this stops for good at its first.
  for (;;) {
    if (state.settled || ports.frames() !== 0) break;
    if (await Promise.race([ports.wait(), ended]) === 'settled' || ports.frames() !== 0) break;
    ports.step();
  }
  return result;
}

/** GO7, Signal Dunes: a client-page home (sunscar-dunes, entered from the deck) enters its tiles from its regional presentation,
 *  through the registration's `enter` (regionalWorld.ts), and the home waits on that render readiness in loading step `home` just
 *  as a data home waits on `enterOffered`. The page hands its regions this registration: every entry steps the rings until the
 *  page loop runs, and in play (the loop running) it adds nothing. Entries waiting together share one pump (Codex: one each
 *  stepped the one streamer twice a turn, two upload budgets before the first frame). */
export function bootSteppedTiles(registration: ClientTileRegistration, ports: LoadingRingPorts): ClientTileRegistration {
  let waiting = 0, drained: (() => void) | undefined;
  const stepped = <T>(entry: Promise<T>): Promise<T> => {
    if (ports.frames() !== 0) return entry;
    // the first waiting entry starts the pump; it runs until every entry waiting on it has settled
    if (waiting++ === 0) void stepRingsUntil(new Promise<void>(resolve => { drained = resolve; }), ports);
    const settle = (): void => { if (--waiting === 0) drained?.(); };
    void entry.then(settle, settle);
    return entry;
  };
  return { ...registration,
    enter: (instance, entry, scope, start) => stepped(registration.enter(instance, entry, scope, start)),
    enterOffered: (instance, scope, start) => stepped(registration.enterOffered(instance, scope, start)) };
}
