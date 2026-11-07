/** Emit a checked fixed manifest literal and its image imports at build time. */
export function manifestDeclaration(root: string, slug: string,
  rows: Readonly<Record<string, unknown>>, omitted: readonly string[]): string;
