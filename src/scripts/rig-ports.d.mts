/** QA 11-25 row 130: a rig's four loopback ports chosen per run under a lock, or an explicit WS_RIG_PORTS as given. */
export const RIG_PORT_FIRST: number;
export const RIG_PORT_BLOCKS: number;
export function rigPortLocks(): string;
export function reserveRigPorts(options?: { explicit?: string; locks?: string; first?: number; blocks?: number }):
  Promise<{ base: number; explicit: boolean; release: () => void }>;
export function importRigAt(checkout: string, base: number): Promise<typeof import('./online-rig.mjs')>;
