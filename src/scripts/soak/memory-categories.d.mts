export interface WebKitMemoryCategorySample {
  timestamp: number;
  categories: {type: 'javascript' | 'jit' | 'images' | 'layers' | 'page' | 'other'; size: number}[];
}
export interface MemoryCategoryInspector {
  on: (method: string, listener: (params: unknown) => void) => () => void;
  send: (method: string) => Promise<unknown>;
}
/** Passive diagnostic only; callers seal native acceptance samples before calling. */
export function memoryCategories(inspector: MemoryCategoryInspector, wait?: (ms: number) => Promise<unknown>): Promise<{
  protocol: string; samples: WebKitMemoryCategorySample[]; errors: string[];
}>;
