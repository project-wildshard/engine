export const coreHeapProtocol: 'webkit-core-heap-diagnostic/1';
/** One pinned cold Template only; default runs never enable the heap agent. */
export function coreHeapRequested(args: Readonly<Partial<Record<string, string>>>): boolean;
export interface CoreHeapDiagnostic {
  protocol: typeof coreHeapProtocol;
  qualifying: false;
  mayCollect: true;
  before: string | null;
  after: string | null;
  snapshot: null | {
    file: string; bytes: number; sha256: string;
    summary: null | { version: number; nodes: number; estimatedBytes: number;
      classes: {kind: string; bytes: number; nodes: number}[] };
  };
  errors: string[];
}
export function captureCoreHeap(driver: {
  evaluate: (expression: string) => Promise<unknown>;
  send: (method: string) => Promise<unknown>;
}, target: string, out: string, samples: readonly {phase: string}[],
write?: (path: string, text: string) => void): Promise<CoreHeapDiagnostic>;
