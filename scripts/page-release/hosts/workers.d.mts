import type {PageHost} from '../flow.mjs';
import type {runRedacted} from '../redact.mjs';

export const CONFIG: string;
export const WORKERS: Record<'preview' | 'staging' | 'production', {env: string; worker: string}>;
export function isVersionUrl(url: string, id: string, worker: string): boolean;
export function stripSourceMaps(directory: string): number;
export function workersHost(options: {token: () => string | undefined; exec?: typeof runRedacted; fetch?: typeof fetch; log?: (line: string) => void}): PageHost;
