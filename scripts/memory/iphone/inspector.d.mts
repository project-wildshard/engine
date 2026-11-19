export interface Override { pattern: string; body: string; mimeType?: string }
export function syncExpression(script: string, args: unknown[]): string;
export function asyncExpression(script: string, args: unknown[]): string;
export function pickPage<T extends { url: string; webSocketDebuggerUrl: string }>(pages: T[]): T | null;
export interface InspectedSafari {
  sessionId: string;
  served: { url: string; at: number }[];
  getUrl: () => Promise<unknown>;
  navigate: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  freshTab: () => Promise<void>;
  evaluate: (script: string, args?: unknown[]) => Promise<unknown>;
  evaluateAsync: (script: string, args: unknown[], timeoutMs: number) => Promise<unknown>;
  click: (element: { __wsElement: number }) => Promise<unknown>;
  close: () => Promise<void>;
}
export function startInspector(udid: string, options?: { port?: number; overrides?: Override[] }):
  Promise<{ open: () => Promise<InspectedSafari>; stop: () => Promise<void> }>;
