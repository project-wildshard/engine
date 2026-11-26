export interface T1FaultRule {
  readonly route: 'socket' | 'release' | 'packs'
  readonly kind: 'drop-after' | 'refuse-upgrade' | 'status'
  readonly afterMs?: number
  readonly code?: number
}
export interface T1OnlineRig {
  readonly base: string
  readonly stamp: { readonly release: string; readonly key: string }
  readonly arm: (
    scenario: string,
    rules: readonly T1FaultRule[],
  ) => Promise<void>
  readonly matches: (route: string) => Promise<number>
  readonly close: () => Promise<void>
}
export function openT1OnlineRig(
  dist: string,
  scratch: string,
  options?: { readonly gridRoot?: string },
): Promise<T1OnlineRig>
