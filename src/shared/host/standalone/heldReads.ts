// DL25: the page already holds most of what the server reads, and no document is claimed (`engine/client/boot/sw.ts`), so on
// a first visit the worker's own `fetch` would download it all again. Over this port the worker asks first; the page answers
// with bytes it holds or waits for, or null, and the worker reads the network as it always did. Nothing here decides what
// to trust: the worker's own checks run on these bytes as on any others.

// QA 11-25 row 68r: every answer waits for the page's main thread, which a boot keeps busy (a software-GL first frame held
// it 25 s on a 4-core Linux runner). Asked file by file, Nalati's world create waited 22.7 s of its 28.9 s on the page saying
// "not mine" 63 times. So the worker first asks once which of a product's files the page lists at all (`listed`), and asks
// for bytes only for those; the rest go straight to the network.

/** The bytes the page holds for `url`; null sends the worker to the network. `listed`, the worker's half only: which of
 *  `urls` the page's download lists, in one answer (a URL it lists may still answer null; one it doesn't never answers bytes). */
export type HeldRead = ((url: string) => Promise<ArrayBuffer | null>) & { readonly listed?: (urls: readonly string[]) => Promise<readonly boolean[]> };
/** The page's own check that its download lists `url` (spawnDownload.ts `spawnListed`), the same check `HeldRead` starts with. */
export type HeldListed = (url: string) => boolean;

interface Ask { readonly id: number; readonly url: string }
interface ListAsk { readonly id: number; readonly urls: readonly string[] }
interface Answer { readonly id: number; readonly bytes: ArrayBuffer | null }
interface ListAnswer { readonly id: number; readonly listed: readonly boolean[] }
const isAsk = (value: unknown): value is Ask => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'number' && 'url' in value && typeof value.url === 'string';
const isListAsk = (value: unknown): value is ListAsk => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'number' && 'urls' in value && Array.isArray(value.urls) && value.urls.every(url => typeof url === 'string');
const isAnswer = (value: unknown): value is Answer => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'number' && 'bytes' in value && (value.bytes === null || value.bytes instanceof ArrayBuffer);
const isListAnswer = (value: unknown): value is ListAnswer => typeof value === 'object' && value !== null
  && 'id' in value && typeof value.id === 'number' && 'listed' in value && Array.isArray(value.listed) && value.listed.every(flag => typeof flag === 'boolean');

async function answer(port: MessagePort, id: number, read: Promise<ArrayBuffer | null>): Promise<void> {
  const bytes = await read.catch(() => null);
  port.postMessage({ id, bytes } satisfies Answer, bytes === null ? [] : [bytes]);
}

/** The page's half: every ask gets one answer, and a read that fails is only a null. A page with no `listed` check says it
 *  lists everything, so the worker asks it file by file as before. */
export function answerHeldReads(port: MessagePort, read: HeldRead, listed?: HeldListed): void {
  port.onmessage = (event: MessageEvent<unknown>): void => {
    const ask = event.data;
    if (isListAsk(ask)) { port.postMessage({ id: ask.id, listed: ask.urls.map(url => { try { return listed?.(url) ?? true; } catch { return true; } }) } satisfies ListAnswer); return; }
    if (!isAsk(ask)) return;
    void answer(port, ask.id, read(ask.url));
  };
}

/** The worker's half. */
export function askHeldReads(port: MessagePort): HeldRead {
  const waits = new Map<number, (bytes: ArrayBuffer | null) => void>(), lists = new Map<number, (listed: readonly boolean[]) => void>();
  let asks = 0;
  port.onmessage = (event: MessageEvent<unknown>): void => {
    const reply = event.data;
    if (isListAnswer(reply)) { lists.get(reply.id)?.(reply.listed); lists.delete(reply.id); return; }
    if (!isAnswer(reply)) return;
    waits.get(reply.id)?.(reply.bytes);
    waits.delete(reply.id);
  };
  const read = (url: string): Promise<ArrayBuffer | null> => new Promise(resolve => {
    const id = ++asks;
    waits.set(id, resolve);
    port.postMessage({ id, url } satisfies Ask);
  });
  const listed = (urls: readonly string[]): Promise<readonly boolean[]> => new Promise(resolve => {
    const id = ++asks;
    lists.set(id, resolve);
    port.postMessage({ id, urls } satisfies ListAsk);
  });
  return Object.assign(read, { listed });
}
