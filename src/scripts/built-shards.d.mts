export function builtShards<S extends { order: number }>(products: string, parse: (document: unknown) => S, options?: { replacing?: boolean; warn?: (line: string) => void }): S[];
export function pinsInstall(argv: readonly string[]): boolean;
