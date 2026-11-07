/** A context holds at most a few queued errors, one per flag a driver set. */
const MOST_QUEUED = 8;

/** E7.9: a driver may leave an error queued as a context is made, and the Android emulator's GL translator does, in Chrome 133 and 145. No call of ours raised it,
 * and the upload guards read a queued error as their own and stop the load, so a new context starts clean. Returns what it cleared. */
export function clearCreationErrors(context: Pick<WebGL2RenderingContext, 'getError' | 'NO_ERROR'>): readonly number[] {
  const cleared: number[] = [];
  for (let read = 0; read < MOST_QUEUED; read++) {
    const error = context.getError();
    if (error === context.NO_ERROR) break;
    cleared.push(error);
  }
  return cleared;
}
