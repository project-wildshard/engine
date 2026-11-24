// FM4 9b/10b and QA 11-23-b row 5 (Jake, ~11:40 Cancún: "when i hit enter zone on zone select its not instant in going to the loading
// sreen"): ENTER ZONE on a world build. The world is asked first (the gate's module, then this build's online bundle, then a socket
// to the door) only when this tab heard it restart, so it may be down; any other tap enters in its own turn, and the loading
// screen is the next frame. A deploy that lands meanwhile moves the seated player, as it moves everyone.
import { restartRecent } from '@wildshard/engine/game/grid/worldRestart';

interface GateModule { readonly titleEntryGate: (world: unknown) => ((go: () => void) => Promise<void>) | undefined }

/** The title deck's gate for `world`; `load` brings the asking code in only when a tap needs it (no title weight). */
export function titleGate(world: unknown, load: () => Promise<GateModule>, recent: () => boolean = restartRecent): (go: () => void) => Promise<void> | void {
  let asking: Promise<void> | null = null;
  // QA 11-24 row 10: a tab that heard a restart will ask the world on the tap; its code comes in now, not after the tap
  if (recent()) void load().catch(() => undefined);
  return go => {
    if (asking === null && !recent()) { go(); return undefined; }
    // one tap at a time: a second tap while the first is asked or held enters nothing
    asking ??= load()
      .then(({ titleEntryGate }) => { const held = titleEntryGate(world); if (held === undefined) { go(); return undefined; } return held(go); }, () => { go(); })
      .finally(() => { asking = null; });
    return asking;
  };
}
