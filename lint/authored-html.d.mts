import type { ESTree } from 'vite';

export interface AuthoredHtmlSite { line: number; column: number; message: string }
export function authoredHtmlSites(root: string, filename: string, program?: ESTree.Program): AuthoredHtmlSite[];
