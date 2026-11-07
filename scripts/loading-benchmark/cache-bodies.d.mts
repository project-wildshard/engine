export interface CachedBodyEvidence {
  unit: string;
  source: string;
  requested: number;
  files: { url: string; bytes: number }[];
  missing: string[];
  failures: { url: string; reason: string }[];
  readBytes: number;
  limited: string | null;
  product: null | { descriptor: string; record: string; recordBytes: number;
    files: { url: string; contentURL: string; expectedBytes: number }[] };
  limits: { urls: number; caches: number; bodyBytes: number; metadataBytes: number; totalBytes: number; milliseconds: number };
}
export function cachedBodyEvidence(input: readonly string[], descriptor?: string): Promise<CachedBodyEvidence>;
