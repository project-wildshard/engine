import type { Fingerprint } from '../../src/client/engine/debug/probe';

/** Browser-evaluated bounded timer barrier; reads every HUD node after toast idle. */
export function waitForToastIdle(timerHz: number): Promise<Fingerprint['hud']>;
