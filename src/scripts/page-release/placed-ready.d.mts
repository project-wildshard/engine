export interface Head { instance: string; slug: string; hash: string }
export interface Snapshot { serial: number; cells: readonly {instance: string; slug: string; hash?: string}[] }
export interface PlacementReadyPorts {
  base: readonly {instance: string; slug: string}[];
  read: () => Promise<Snapshot>;
  ready: (head: Head) => Promise<boolean>;
  cook: (head: Head) => Promise<void>;
}
export function ensurePlacedHeads(ports: PlacementReadyPorts): Promise<{serial: number; heads: Head[]; cooked: number}>;
export function placedIndexProblem(index: unknown, want: {build: string; slug: string; hash: string}): string | null;
