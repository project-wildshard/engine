export function zeroPolicyFailures(budgets: Readonly<Record<string, unknown>>): string[];
export function customSectionsZeroFailures(budgets: Readonly<Record<string, unknown>>, measures: Readonly<Record<string, { readonly customSections: readonly { readonly name: string; readonly bytes: number }[]; readonly customSectionBytes?: number }>>): string[];
