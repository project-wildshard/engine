import type { IncomingMessage, ServerResponse } from 'node:http';
/** Local-only receiver. Original bytes and the production-cleaned record are
 * written outside the served tree before HTTP204 acknowledges them. */
export function createPreviewTelemetrySink(directory: string): Promise<(request: IncomingMessage, response: ServerResponse) => Promise<void>>;
