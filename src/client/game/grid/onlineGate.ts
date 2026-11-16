// ZONE-ENTRY ZE10d2 (J352: "same page, same socket"): a world page's gate. The running session's online shell lends the gate its
// `enter` here (`clientWorker.ts`); a gate's 0 (`pageEntry.ts` `enterZone`) asks it, and on the door's `arrive` the page enters the cell in
// place, the next session taking over the same link. A page with no world, or a session with no grid, lends none.

/** The pose past the gate the door answered, in the cell's own frame; null when it refused or never answered. */
export type OnlineGate = (cell: string) => Promise<{ readonly x: number; readonly z: number; readonly yaw: number } | null>;

let lent: OnlineGate | null = null;

/** The running session's gate; returns the take-back its scope runs. */
export function lendOnlineGate(gate: OnlineGate): () => void {
  lent = gate;
  return () => { if (lent === gate) lent = null; };
}

/** The gate a world page's zone entry asks, if a session lent one. */
export function onlineGate(): OnlineGate | null { return lent; }
