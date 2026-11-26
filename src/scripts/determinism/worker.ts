import { playTape, type TapeRequest } from "./runtime";

/** A worker channel has no target origin: it can only answer its creating page. */
async function answer(input: TapeRequest): Promise<void> {
  try {
    const witness = await playTape(input);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- DedicatedWorker postMessage has no targetOrigin argument.
    globalThis.postMessage({ witness, agent: navigator.userAgent });
  } catch (error) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- DedicatedWorker postMessage has no targetOrigin argument.
    globalThis.postMessage({ error: error instanceof Error ? error.stack : String(error) });
  }
}
// A real dedicated worker: no canvas, document, renderer or page simulation.
globalThis.onmessage = (event: MessageEvent<TapeRequest>): void => {
  void answer(event.data);
};
