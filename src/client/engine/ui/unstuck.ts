import type { Scope } from '../../../shared/engine/app/scope';

// Jake, 2026-11-12: "Need a button in <dev> to unstuck in settings, unstuck will respawn me like the death behavior but gets me
// unstuck". The DEV tab's row (debugOptions.ts) fires UNSTUCK_EVENT; the play session answers it: the menu closes, and the player
// goes where a death would put them (their last place, else the spawn) with no death: no sting, no fade, no fall counted. On a
// world the server owns the pose, so the page asks it (UNSTUCK_ACT, roomRespawn.ts) and the reconcile carries the move.

/** The DOM event the DEV tab's Unstuck row fires. */
export const UNSTUCK_EVENT = 'ws:unstuck';

/** What an Unstuck needs of the play session. */
export interface UnstuckPorts {
  /** a death's fade or the title holds the player: nothing to do */
  readonly busy: () => boolean;
  /** a server owns this player's pose */
  readonly online: () => boolean;
  /** ask the server (UNSTUCK_ACT) */
  readonly send: () => void;
  /** put the local player where a death would */
  readonly place: () => void;
  /** close the menu the row was pressed in */
  readonly close: () => void;
  /** the local respawn's moment (`player.respawned`): what a death's respawn refills, this refills */
  readonly respawned: () => void;
}

/** Answer the DEV tab's Unstuck for this play session, until `scope` ends. */
export function installUnstuck(scope: Scope, ports: UnstuckPorts): void {
  const run = (): void => {
    if (ports.busy()) return;
    ports.close();
    if (ports.online()) { ports.send(); return; }
    ports.place();
    ports.respawned();
  };
  scope.listen(document, UNSTUCK_EVENT, run);
}

/** The row's tap. */
export function pressUnstuck(): void { document.dispatchEvent(new CustomEvent(UNSTUCK_EVENT)); }
