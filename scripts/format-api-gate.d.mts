export const FORMAT_API: string;
export function compareRelease(left: string, right: string): number;
export function observeApiPackage(api?: string, timeoutMs?: number): Promise<string>;
export function formatApiFailures(
  before: string | undefined,
  after: string | undefined,
  options?: {
    observe?: () => Promise<string>;
    warn?: (line: string) => void;
    env?: Record<string, string | undefined>;
  },
): Promise<string[]>;
export function refsFailures(
  refs: string,
  root: string,
  options?: {
    observe?: () => Promise<string>;
    warn?: (line: string) => void;
    env?: Record<string, string | undefined>;
  },
): Promise<string[]>;
