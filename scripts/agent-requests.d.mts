export const agentFetch: typeof fetch;
export function markedFetch(transport: typeof fetch): typeof fetch;
export function markedSocket(transport: typeof WebSocket): typeof WebSocket;
