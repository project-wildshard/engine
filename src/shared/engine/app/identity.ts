/**
 * The app the engine runs in (E405 E414): its name, its wordmark, the prefix of its save keys and the page handles
 * its tools use. The engine knows none of them; the game installs them (src/client/app/identity.ts, the first module every
 * page entry runs), with the values the saves and the tools already use: they are wire contracts.
 *
 * Nothing has a default. A save key built before the install would land under another prefix and lose the player's
 * progress, so `appIdentity()` throws instead: loud at boot, never a silent second save.
 */
import type { EngineProbe, HarnessPins } from '../../../client/engine/debug/probe';

export interface AppIdentity {
  /** the app's name, as report headers print it (upper-cased: "… PERF LAP") */
  readonly name: string;
  /** the wordmark's markup (the loading shell, the resume screen, Explore's brand) */
  readonly wordmark: string;
  /** the loading shell's one line under the wordmark */
  readonly tagline: string;
  /** every save key's prefix (`<prefix>global`, `<prefix><namespace>`) and a save export's format tag */
  readonly savePrefix: string;
  /** Progress epoch: imports from another epoch cannot restore wiped progress. */
  readonly saveEpoch?: number;
  /** Previous namespace, used only to carry preferences at first boot. */
  readonly previousSavePrefix?: string;
  /** Stable device identity namespace, independent of progress wipes. */
  readonly identityPrefix?: string;
  readonly saveFormat: string;
  /** a downloaded file's name prefix (`<slug>-save-<date>.json`) */
  readonly fileSlug: string;
  /** Rebind a portable document's player data to the importing device, keeping its identity. */
  readonly importPlayerDocument?: (document: unknown, player: string) => Promise<unknown>;
  /** where the page exposes the probe to capture and test scripts */
  readonly exposeProbe: (probe: EngineProbe) => void;
  /** the harness pins a test or capture script set before the boot, when there are any */
  readonly harness: () => HarnessPins | undefined;
  /** Exact production origins allowed to send optional browser error telemetry.
   * Unset identities and automation never send to that external channel. */
  readonly errorReportOrigins?: readonly string[];
  /** The Sentry environment each report origin sends as (`staging`, `preview`); an origin not listed is `production`. */
  readonly errorReportEnvironments?: Readonly<Record<string, string>>;
}

// One slot per page, not per module instance: a page loads this module once, but a test that resets its modules
// gets a fresh copy, and the identity installed at setup must still answer there.
const SLOT = Symbol.for('engine.app-identity');
const isIdentity = (v: unknown): v is AppIdentity => typeof v === 'object' && v !== null && 'savePrefix' in v && 'exposeProbe' in v;
const read = (): AppIdentity | null => { const v: unknown = Reflect.get(globalThis, SLOT); return isIdentity(v) ? v : null; };
export function installAppIdentity(identity: AppIdentity): void { Reflect.set(globalThis, SLOT, identity); }
/** the installed identity, or null (a Node script or a bare test, where nothing persists) */
export function installedIdentity(): AppIdentity | null { return read(); }
export function appIdentity(): AppIdentity {
  const installed = read();
  if (installed === null) throw new Error('No app identity installed: the page entry installs it first (src/client/app/identity.ts)');
  return installed;
}
let probe: EngineProbe | undefined;
/** the live probe (installProbe sets it; the page also exposes it through the identity) */
export function currentProbe(): EngineProbe | undefined { return probe; }
export function setCurrentProbe(value: EngineProbe | undefined): void { probe = value; if (value !== undefined) read()?.exposeProbe(value); }
/** the harness pins, or undefined before an identity is installed (a bare engine test) */
export function harnessPins(): HarnessPins | undefined { return read()?.harness(); }

/** Other applications' stores retain epoch zero. */
export function saveEpoch(prefix: string | undefined = installedIdentity()?.savePrefix): number {
  const app = installedIdentity();
  return app?.savePrefix === prefix ? app?.saveEpoch ?? 0 : 0;
}
