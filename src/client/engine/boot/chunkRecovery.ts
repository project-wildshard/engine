/** A failed deployment-owned module or sheet, not an arbitrary application exception. */
export function staleChunkFailure(error: unknown, base: string): boolean {
  if (!(error instanceof Error)) return false;
  const module = /Failed to fetch dynamically imported module|Importing a module script failed|error loading (?:a )?dynamically imported module/iu.test(error.message);
  const stylesheet = /^(?:Stylesheet failed:|Unable to preload CSS for )/u.test(error.message);
  if (!module && !stylesheet) return false;
  const address = /(?:https?:\/\/[^\s"']+|\/(?:assets|builds|b)\/[^\s"']+)/u.exec(error.message)?.[0];
  if (address === undefined) return module;
  try {
    const url = new URL(address, base);
    return url.origin === new URL(base).origin && /^\/(?:assets|builds\/shared|builds\/[\w.-]+\/[\w.-]+|b\/[\w.-]+)\/[^/]+-[\w-]{8}\.(?:js|css)$/u.test(url.pathname);
  } catch { return false; }
}
export interface ChunkRecoveryPorts {
  readonly allowed: () => boolean;
  readonly base: string;
  readonly runningBuild: string;
  readonly version: () => Promise<string | null>;
  readonly prepare: (build: string) => Promise<boolean>;
  readonly claimed: () => boolean;
  readonly claim: () => boolean;
  readonly reload: () => void;
}
/** Move to a confirmed newer build: discover it, ready its worker, claim the one reload, reload. */
export async function reloadIntoNewerBuild(ports: ChunkRecoveryPorts): Promise<boolean> {
  try {
    const next = await ports.version();
    if (next === null || next === ports.runningBuild || !ports.allowed() || ports.claimed() || !await ports.prepare(next) || !ports.allowed() || !ports.claim()) return false;
    ports.reload(); return true;
  } catch { return false; }
}
/** OFFLINE OF24 (Jake, 2026-11-15: a forced update shows one clear line, then one reload): the same ports, whose one reload
 *  first puts `say`'s line up (it resolves once the line is painted, or failed to be), then reloads in place. The claim
 *  still allows one reload a session, so a build no server takes says it once and never loops. */
export function sayingReload(ports: ChunkRecoveryPorts, say: () => Promise<void>): ChunkRecoveryPorts {
  return { ...ports, reload: () => { void say().catch(() => undefined).then(() => { ports.reload(); return undefined; }); } };
}
/** Concurrent module/CSS failures share one bounded discovery and one durable reload claim. */
export function createChunkRecovery(ports: ChunkRecoveryPorts): (error: unknown) => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  function recover(failure: unknown): Promise<boolean> {
    if (!ports.allowed() || ports.runningBuild === '' || ports.claimed() || !staleChunkFailure(failure, ports.base)) return Promise.resolve(false);
    pending ??= reloadIntoNewerBuild(ports).finally(() => { pending = undefined; });
    return pending;
  }
  return recover;
}
