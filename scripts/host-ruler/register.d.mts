export declare const REGISTER: 'lint/host-register.json';
export declare const RECHECK: string;
export declare const VERDICTS: readonly ['engine', 'game', 'pending', 'borderline', 'silly'];
export declare const TESTS: readonly ['twoRealUsers', 'noShardNouns', 'dataDriven', 'serverSafe', 'deletionTest', 'dataOnlyApi'];
export type Verdict = (typeof VERDICTS)[number];
export type HostTest = (typeof TESTS)[number];
export interface RegisterFrom { readonly source: string; readonly line: number; readonly selector: string }
export interface RegisterRow {
  readonly key: string;
  readonly verdict: Verdict;
  readonly decision: string;
  readonly users: readonly string[];
  readonly recheck?: string;
  readonly score?: Readonly<Partial<Record<HostTest, 0 | 1>>>;
  readonly from: readonly RegisterFrom[];
  readonly note?: string;
}
export interface HostRegister {
  readonly schema: 'wildshard.host-register/1';
  readonly about: string;
  readonly decisions: { readonly G: { readonly source: string; readonly ids: readonly string[] }; readonly J: { readonly source: string; readonly ids: readonly string[] } };
  readonly sources: Readonly<Record<string, { readonly file: string; readonly rows: number }>>;
  readonly merged: readonly { readonly key: string; readonly kept: string; readonly merged: readonly string[] }[];
  readonly dropped: readonly { readonly key: string; readonly from: RegisterFrom; readonly reason: string }[];
  readonly rows: readonly RegisterRow[];
}
export function moduleFile(module: string, root?: string): string | null;
export function namesBinding(text: string, binding: string): boolean;
export function hostRegisterProblems(json: unknown, root?: string): string[];
export function readHostRegister(root?: string): HostRegister;
/** Loose on purpose: the migration formats a register before the reader has validated it. */
export function formatRegister(register: {
  readonly schema: string; readonly about: string; readonly rows: readonly unknown[]; readonly merged: readonly unknown[]; readonly dropped: readonly unknown[];
  readonly sources: Readonly<Record<string, unknown>>;
  readonly decisions: Readonly<Record<string, { readonly source: string; readonly ids: readonly string[] }>>;
}): string;
