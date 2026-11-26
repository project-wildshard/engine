export interface FloorPendingContext {
  readonly pending: readonly string[];
  readonly pendingWork?: readonly { readonly instance: string; readonly kind: string; readonly trigger: string }[];
  readonly current: string | null;
  readonly residents: readonly string[];
  readonly gameplayReady?: boolean;
  readonly crossing: string | null;
  readonly pitch?: number;
  readonly worldFeet?: { readonly x: number; readonly z: number };
  readonly cells: readonly { readonly instance: string; readonly cell: readonly [number, number];
    readonly shows?: string; readonly drawn?: { readonly near: boolean } }[];
}
export function frameFloorPending(context: FloorPendingContext): {
  pendingWorld: string[];
  pendingOptionalMetadata: { instance: string; kind: string; trigger: string; outsideMetres: number }[];
};
