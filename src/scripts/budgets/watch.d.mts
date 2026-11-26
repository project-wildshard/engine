/** BUDGET-CAPS BC9: main-watch reads the budgets workflow and names the pusher of a regression. */
export interface BudgetResult { key: string; kind: 'regressed' | 'over-hard'; measured: number; baseline: number | null; line: number | null; contentKey: string }
export function budgetResultLine(row: { key: string; status: string; value: number | null; baseline: number | null; line: number | null; hard: number | null; contentKey: string }): string;
export function parseBudgetResults(text: string): BudgetResult[];
export function budgetReport(run: { id: number; head_sha: string; created_at: string; conclusion: string | null }, results: readonly BudgetResult[], pushers: readonly string[]):
  { lines: string[]; qa: { id: number; sha: string; created: string; pusher: string; results: readonly BudgetResult[] } | null };
export function budgetSourceRun(run: { display_title?: string }): number | null;

export interface BudgetObservation {sha:string;contentKey:string;baseline:number|null;line:number|null}
export function confirmBudgetResults(run:{head_sha:string},results:readonly BudgetResult[],previous?:Record<string,BudgetObservation>):
  {pending:Record<string,BudgetObservation>;confirmed:BudgetResult[];quiet:BudgetResult[]};
