export function decodedBodyCounter(encoding?: string): { write: (chunk: Uint8Array) => void; finish: () => Promise<number | null> };
export function observeTransport(upstream: string | (() => string), fixture?: { readonly start?: string; readonly prelude?: string; readonly recorder?: () => void; readonly offline?: () => boolean; readonly bodyHashes?: boolean;
  /** Observe actual forwarded encoded chunks, including responses still in flight at a control fence. No bodies retained. */
  readonly transfer?: (request: { url: string; startedAt: number }) => (bytes: number, at: number) => void }): Promise<{
  base: string; receipts: { url: string; status: number; startedAt: number; endedAt: number; bodyBytes: number; decodedBodyBytes: number | null; headerBytes: number; bodySHA256?: string; bodyEncoding?: string }[];
  htmlFixtures: { originalSHA256: string; injectedSHA256: string;
    /** Exact static compiler JSON, not executed code or a measured download receipt. */
    moduleInventory: { json: string; sha256: string } | { error: string } }[]; close: () => Promise<void>;
}>;
