import { installKitWorldFixture } from './kit-world';

/** Boar manager fixtures: the shared creature owner with the engine's own kit boar (and bear), its real app tables and
 * assets. ZONE-SNAPSHOTS ZS9 (J507): the frozen Pine boar row, body and pose it used to lay over the kit boar went with
 * Pine's old species book; Pine's live roster declares its species and no hull book. */
export async function installBoarWorldFixture(): Promise<void> {
  await installKitWorldFixture();
}
