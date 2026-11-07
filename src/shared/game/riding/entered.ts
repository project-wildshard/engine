import type { Scope } from '@wildshard/engine/app/scope';
import type { Player } from '@wildshard/engine/player/Player';
import type { Mount } from '../../../client/game/riding/mount';

const enteredMounts = new WeakMap<Scope, Mount>(), riders = new WeakMap<Player, Mount>();
/** A scope's mount, until the scope ends or the one it replaced comes back. */
export function enterMount(scope: Scope, player: Player, mount: Mount): void {
  const previous = enteredMounts.get(scope), ridden = riders.get(player);
  enteredMounts.set(scope, mount); riders.set(player, mount);
  scope.onDispose(() => {
    if (riders.get(player) === mount) { if (ridden === undefined) riders.delete(player); else riders.set(player, ridden); }
    if (enteredMounts.get(scope) !== mount) return;
    if (previous === undefined) enteredMounts.delete(scope); else enteredMounts.set(scope, previous);
  });
}
/** The mount a player's page has now, wherever it entered: a grid's cell has a scope of its own. */
export function mountOf(player: Player): Mount | undefined { return riders.get(player); }
/** Borrow the native entered mount without constructing a riding controller. */
export function enteredMount(scope: Scope): Mount | undefined { return scope.disposed ? undefined : enteredMounts.get(scope); }
/** Population reads the actual mount, including before riding is installed. */
export function pageRidingMounted(context: { readonly scope: Scope }): boolean { return enteredMount(context.scope)?.mounted === true; }
