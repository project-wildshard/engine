export const PRODUCTION_CATALOGUE: string;
export function missingProductionPacks(build: string, read?: (url: string, init?: RequestInit) => Promise<Response>): Promise<string[]>;
