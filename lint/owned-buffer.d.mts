export const OWNED_BUFFER_SCOPE: RegExp;
export const OWNED_BUFFER_HELPER: string;
export function bufferSite(node: unknown): boolean;
export function bufferSites(program: unknown): number;
export function bufferPath(filename: string): string;
export function ownedBufferRule(policyFile: string): unknown;
export const OWNED_BUFFER_POLICY: string;
