export function linkStages(at: Record<string, number | null | undefined>): Record<string, number | null>;
export function linkTable(rows: { kind: string; at: Record<string, number | null | undefined>; error?: string | null }[]): string;
