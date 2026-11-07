import { createSimHost, type SimHost, type SimHostPorts, type SimLevel } from '../sim';
import type { Rapier } from '../../../shared/engine/physics/rapier';
import { closeRestoreChecks, openRestoreChecks, restoreInstalledHost, validateSnapshot, type SimSnapshot, type SimSnapshotBytes } from '../../../shared/engine/sim/snapshot';

/** One fresh unpublished host may be retained or restored once, never restored after stepping. */
export interface PreparedSimHostRestore {
  readonly host: SimHost;
  readonly keep: () => SimHost;
  readonly restore: (saved: SimSnapshot | SimSnapshotBytes, install?: (host: SimHost) => void) => SimHost;
}
/** Create the restore-check context before installing services; no live host can be supplied. */
export function prepareSimHostRestore(level: SimLevel, ports: SimHostPorts): PreparedSimHostRestore {
  if (ports.physics !== undefined || ports.player !== undefined) throw new Error('Restore target must own its world');
  const host = createSimHost(level, ports), checks = openRestoreChecks(host);
  let open = true;
  const forget = host.scope.capture('disposers', () => { open = false; checks.length = 0; closeRestoreChecks(host); });
  const consume = (): void => {
    if (!open) throw new Error('Restore target already consumed or disposed');
    open = false; forget();
    if (host.state.tick !== 0 || host.scope.disposed || host.scope.disposing) {
      closeRestoreChecks(host); checks.length = 0; host.dispose(); throw new Error('Restore target is no longer fresh');
    }
  };
  return { host, keep: () => { consume(); closeRestoreChecks(host); checks.length = 0; return host; },
    restore: (saved, install) => {
      consume();
      try { validateSnapshot(level, saved); }
      catch (error) { closeRestoreChecks(host); checks.length = 0; host.dispose(); throw error; }
      return restoreInstalledHost(host, ports, saved, checks, install);
    } };
}
/** Boot a fresh matching level, reinstall scoped adapters, then restore every continuation before replay. */
export function restoreSimHost(level: SimLevel, ports: { rapier: Rapier }, saved: SimSnapshot | SimSnapshotBytes, install?: (host: SimHost) => void): SimHost {
  validateSnapshot(level, saved);
  const host = createSimHost(level, ports), checks = openRestoreChecks(host);
  return restoreInstalledHost(host, ports, saved, checks, install);
}
