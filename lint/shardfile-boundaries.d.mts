export interface ShardfileBoundaryIssue {
  rule: 'runtime-standalone' | 'no-build-time-import' | 'no-runtime-in-build';
  message: string;
  start: number;
  end: number;
}
/** Parse source using the same visitors as oxlint; no migration allowance is applied. */
export function shardfileBoundaryViolations(root: string, file: string, source: string): ShardfileBoundaryIssue[];
/** Adapter for ESLint-compatible AST dispatch. */
export function shardfileBoundaryVisitors(root: string, file: string, rule: ShardfileBoundaryIssue['rule'], report: (node: { start: number; end: number }, message: string) => void): Record<string, (node: object) => void>;
