export declare function maximumResidentBytes(text: string): number | null;
export declare function readingCommands(): readonly { readonly name: string; readonly executable: string; readonly args: readonly string[] }[];
export declare function compilerJsonInputs(project: string): { project: string; json: string[]; jsonBytes: number; generated: string[]; generatedBytes: number };
