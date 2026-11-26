/** Keep KTX2 co-demand families in bounded, independently addressed parts. */
export function bootPackParts(paths: readonly string[], sizeOf: (path: string) => number): string[][];
