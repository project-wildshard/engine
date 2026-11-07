import type ts from '@typescript/typescript6';

export interface HostCall { module: string; export: string; member?: string; file: string; start: number; end: number; strings?: string[] }
export interface HostCallback extends HostCall { path: string; message: string }
export function hostAnalysis(root: string): { program: ts.Program; checker: ts.TypeChecker; files: string[]; scan: (file: string) => { calls: HostCall[]; callbacks: HostCallback[] } };
export function hostCallbackViolations(root: string, file: string): HostCallback[];
