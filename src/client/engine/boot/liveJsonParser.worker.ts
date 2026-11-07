import { parseJsonPages } from './parsedPages';

self.onmessage = (event: MessageEvent<unknown>): void => {
  const data = event.data;
  if (typeof data !== 'object' || data === null) { self.postMessage({ error: 'Invalid live JSON request' }, { transfer: [] }); return; }
  const id: unknown = Reflect.get(data, 'id'), kind: unknown = Reflect.get(data, 'kind');
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || kind !== 'parse-pages') {
    self.postMessage({ error: 'Invalid live JSON request' }, { transfer: [] }); return;
  }
  try {
    const bytes: unknown = Reflect.get(data, 'value');
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Live JSON parser requires bytes');
    const value = parseJsonPages(bytes);
    if (!(value.buffer instanceof ArrayBuffer)) throw new TypeError('Invalid live JSON transfer backing');
    self.postMessage({ id, kind, ok: true, value }, { transfer: [value.buffer] });
  } catch (error) {
    self.postMessage({ id, kind, ok: false, error: error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) } }, { transfer: [] });
  }
};
