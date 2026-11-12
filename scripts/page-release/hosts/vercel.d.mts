import type {PageHost} from '../flow.mjs';
import {runRedacted} from '../redact.mjs';

export {runRedacted};

export const SCOPE: string;
export const TEAM: string;
export const PROJECTS: Record<'staging' | 'production', {projectName: string; projectId: string; host: RegExp}>;
export function vercelToken(): string;
export function vercelHost(options: {token: () => string; exec?: typeof runRedacted; fetch?: typeof fetch}): PageHost;
