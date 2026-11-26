export interface ApiRow { name: string; from: string; kind: string; doc: string; gameOnly?: boolean }
export interface ApiSurface { indexes: Record<string, ApiRow[]>; contexts: Record<string, ApiRow[]> }
export function apiSurface(root?: string): ApiSurface;
export function renderPage(title: string, intro: string, rows: readonly ApiRow[], withFrom?: boolean): string;
export function pages(surface: ApiSurface): Record<string, string>;
export const EXPORTS_PAGE: string;
export function exportsPage(surface: ApiSurface): string;
export function apiOutputs(root?: string, surface?: ApiSurface): Record<string, string>;
export function writeApiDocs(root?: string): ApiSurface;
export function undocumented(surface: ApiSurface): number;
