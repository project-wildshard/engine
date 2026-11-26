export function missingPins<T extends { readonly slug: string; readonly hash: string }>(pins: { readonly shards: readonly T[] }, assets: ReadonlySet<string>): T[];
