import type { ESTree } from 'vite';
import type { HostCallback } from './host-callbacks.mjs';

export function hostCallbackSites(root: string, file: string, program: ESTree.Program): HostCallback[];
