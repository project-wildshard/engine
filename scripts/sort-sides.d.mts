export const SIDES: readonly string[];
export const LAYERS: readonly string[];
export const PLAN_FILE: string;
export const FROZEN: RegExp;
export interface Tree {
  readonly head: string;
  readonly paths: Set<string>;
  readonly text: Map<string, string>;
  readonly modes: Map<string, string>;
}
export interface PlanNote { readonly kind: string; readonly file: string; readonly value: string }
export interface Plan {
  readonly head: string;
  readonly moves: Map<string, string>;
  readonly writes: Map<string, string>;
  readonly untagged: string[];
  readonly stale: string[];
  readonly kept: string[];
  readonly crossSideTests: string[];
  readonly notes: PlanNote[];
}
export function headTree(root: string): Tree;
export function planSort(tree: Tree): Plan;
export function planMove(tree: Tree, paths: readonly string[], side: string): {tree: Tree; plan: Plan};
export function carryWorkingText(root: string, tree: Tree, plan: Plan, paths: readonly string[], side: string, options?: {committed?: ReadonlyMap<string, string>; scratch?: string}): {carried: string[]; refused: string[]};
export function appliedTree(tree: Tree, plan: Plan): Tree;
export function planFailures(tree: Tree, plan: Plan, root?: string): string[];
export function applyPlan(root: string, tree: Tree, plan: Plan): void;
export function undoApply(root: string): void;
export const GATE_PHASES: readonly string[];
export function gatePhaseCommand(root: string, base: string, tip: string, phase: string, env?: NodeJS.ProcessEnv): string[];
export function main(argv: string[], root?: string): number;
