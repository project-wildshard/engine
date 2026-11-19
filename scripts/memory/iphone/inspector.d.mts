export interface Override { pattern: string; body: string; mimeType?: string }
export function syncExpression(script: string, args: unknown[]): string;
export function asyncExpression(script: string, args: unknown[]): string;
export function pickPage<T extends { url: string; webSocketDebuggerUrl: string }>(pages: T[], want?: string): T | null;
export interface InspectedSafari {
  sessionId: string;
  served: { url: string; at: number }[];
  getUrl: () => Promise<unknown>;
  gesture: (expression: string) => Promise<unknown>;
  navigate: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  freshTab: () => Promise<void>;
  /** turns the Network agent off once the page has control (overrides are for the boot) */
  quiet: () => Promise<void>;
  /** Web Inspector's Disable Caches for this page (DW6 cold runs) */
  cacheOff: (off: boolean) => Promise<void>;
  evaluate: (script: string, args?: unknown[]) => Promise<unknown>;
  evaluateAsync: (script: string, args: unknown[], timeoutMs: number) => Promise<unknown>;
  click: (element: { __wsElement: number }) => Promise<unknown>;
  close: () => Promise<void>;
}
export function startInspector(udid: string, options?: { port?: number; overrides?: Override[]; launchUrl?: string }):
  Promise<{ open: () => Promise<InspectedSafari>; fresh: () => Promise<InspectedSafari>; stop: () => Promise<void> }>;
