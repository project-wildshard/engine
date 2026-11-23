import { agentHeaders, agentUserAgent, agentUrl } from './agent-marker.mjs';

/** Only Wildshard's services and the harness' own loopback rigs receive agent headers.
 * @param {string|URL} input */
function gameAddress(input) {
  try {
    const url = new URL(input);
    const host = url.hostname;
    if (host === 'wildshard.io' || host.endsWith('.wildshard.io') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return url;
    }
  } catch { /* The original transport validates the input. */ }
  return null;
}

/** @param {HeadersInit | undefined} source */
function markedHeaders(source) {
  const headers = new Headers(source);
  const base = headers.get('user-agent') ?? 'node';
  for (const [key, value] of Object.entries(agentHeaders())) headers.set(key, value);
  headers.set('user-agent', agentUserAgent(base));
  return headers;
}

/** @param {typeof fetch} read @returns {typeof fetch} */
export function markedFetch(read) {
  return (input, options) => {
    const request = input instanceof Request ? input : null;
    const address = input instanceof Request ? input.url : input;
    if (gameAddress(address) === null) return read(input, options);
    return read(input, { ...options, headers: markedHeaders(options?.headers ?? request?.headers) });
  };
}

/** @param {typeof WebSocket} Socket @returns {typeof WebSocket} */
export function markedSocket(Socket) {
  return new Proxy(Socket, {
    construct(target, args, into) {
      const [address, protocols] = args;
      const url = typeof address === 'string' || address instanceof URL ? gameAddress(address) : null;
      if (url === null) return Reflect.construct(target, args, into);
      const options = typeof protocols === 'object' && protocols !== null && !Array.isArray(protocols)
        ? protocols : { protocols };
      return Reflect.construct(target, [agentUrl(url.href), { ...options, headers: markedHeaders(options.headers) }], into);
    },
  });
}

/** An operator probe reads through the current transport without changing it.
 * @type {typeof fetch} */
export const agentFetch = (input, options) => markedFetch(globalThis.fetch)(input, options);
