export interface EnvironmentPort {
  readonly get: (name: string) => Promise<string>;
  readonly set: (name: string, value: string) => Promise<void>;
  readonly unset: (name: string) => Promise<void>;
}
/** Verbose GC diagnostics routed through unified logging, not a collector policy change. */
export const JSC_GC_SETTINGS: Readonly<{
  __XPC_JSC_logGC: '2'; __XPC_JSC_useOSLog: '1'; __XPC_JSC_dumpOptions: '1';
}>;
/** Restore on partial setup, refuse foreign settings and verify every setting absent after cleanup. */
export function prepareJscGcEnvironment(port: EnvironmentPort, ramSizeBytes?: number): Promise<() => Promise<void>>;
/** Start before Safari; returned stop closes streams, terminates owned Safari and unsets settings. */
export function startJscGcLog(directory: string, device: string, ramSizeBytes?: number): Promise<() => Promise<unknown>>;
/** Read actual WebContent descendants of this Simulator launchd. */
export function jscGcProcessIds(device: string): readonly number[];
