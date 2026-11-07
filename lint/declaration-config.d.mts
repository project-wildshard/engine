/** The caller supplies an already-parsed ESTree program; this law never executes it. */
export function declarationConfigProgram(program: { readonly body: readonly object[] }): boolean;
