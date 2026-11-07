// DL25: the page already holds most of what the server reads, and no document is claimed (`engine/client/boot/sw.ts`), so on
// a first visit the worker's own `fetch` would download it all again. Over this port the worker asks first; the page answers
// with bytes it holds or waits for, or null, and the worker reads the network as it always did. Nothing here decides what
// to trust: the worker's own checks run on these bytes as on any others.

/** The bytes the page holds for `url`; null sends the worker to the network. */
export type HeldRead = (url: string) => Promise<ArrayBuffer | null>;

interface Ask { readonly id: number; readonly url: string }
interface Answer { readonly id: number; readonly bytes: ArrayBuffer | null }
const isAsk = (value: unknown): value is Ask => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'number' && 'url' in value && typeof value.url === 'string';
const isAnswer = (value: unknown): value is Answer => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'number' && 'bytes' in value && (value.bytes === null || value.bytes instanceof ArrayBuffer);

async function answer(port: MessagePort, id: number, read: Promise<ArrayBuffer | null>): Promise<void> {
  const bytes = await read.catch(() => null);
  port.postMessage({ id, bytes } satisfies Answer, bytes === null ? [] : [bytes]);
}

/** The page's half: every ask gets one answer, and a read that fails is only a null. */
export function answerHeldReads(port: MessagePort, read: HeldRead): void {
  port.onmessage = (event: MessageEvent<unknown>): void => {
    const ask = event.data;
    if (!isAsk(ask)) return;
    void answer(port, ask.id, read(ask.url));
  };
}

/** The worker's half. */
export function askHeldReads(port: MessagePort): HeldRead {
  const waits = new Map<number, (bytes: ArrayBuffer | null) => void>();
  let asks = 0;
  port.onmessage = (event: MessageEvent<unknown>): void => {
    const reply = event.data;
    if (!isAnswer(reply)) return;
    waits.get(reply.id)?.(reply.bytes);
    waits.delete(reply.id);
  };
  return url => new Promise(resolve => {
    const id = ++asks;
    waits.set(id, resolve);
    port.postMessage({ id, url } satisfies Ask);
  });
}
