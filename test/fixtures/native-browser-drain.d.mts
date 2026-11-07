import type {ChildProcess} from 'node:child_process';
/** Reap the owned native-input browser and its writers within the existing five-second cleanup budget. */
export function drainNativeBrowser(child: ChildProcess, requestClose: (() => void) | undefined,
  dispose: () => Promise<void>): Promise<void>;
