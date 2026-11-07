export function genSource(root: string, options?: { check?: boolean; changed?: readonly string[]; committed?: boolean }):
  Promise<{ touched: string[]; owned: string[] }>;
/** Pure candidate source text; never writes or invokes delegated artifact producers. */
export function sourceTableTexts(root: string, options?: { changed?: readonly string[]; committed?: boolean }): Promise<Readonly<Record<string, string>>>;
