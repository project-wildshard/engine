/** E357 F2: dormant unless the parity harness installs its observers. */
export const tap: {
  hit: ((kind: string, amount: number) => void) | null;
  kill: ((kind: string) => void) | null;
  resumed: (() => void) | null;
  sound: ((id: string, kind?: 'ambient') => void) | null;
  use: ((label: string) => void) | null;
  ambientDepth: number;
} = { hit: null, kill: null, resumed: null, sound: null, use: null, ambientDepth: 0 };

export function ambientTick(id: string, body: () => void): void {
  tap.sound?.(id, 'ambient');
  tap.ambientDepth++;
  try { body(); } finally { tap.ambientDepth--; }
}
