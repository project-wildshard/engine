export interface T1OnlineRig {
  readonly base: string
  readonly stamp: { readonly release: string; readonly key: string }
  readonly close: () => Promise<void>
}
export function openT1OnlineRig(
  dist: string,
  scratch: string,
): Promise<T1OnlineRig>
