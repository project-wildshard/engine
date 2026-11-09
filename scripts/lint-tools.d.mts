/** Resolve the exact pinned native typed lint executable. */
export function nativeLintTool(root?: string): { readonly binary: string; readonly version: string };
/** Keep explicit overrides, otherwise use the verified pinned helper. */
export function lintEnvironment(root?: string, environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
