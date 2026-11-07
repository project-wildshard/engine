import { preflightShardfile, preflightShardfileSteps } from '@wildshard/format/preflight';

/** The complete original admission fence, with bounded batches for a live page.
 * Callers keep the checked value owned and unchanged until admission settles. */
export async function preflightProduct(input: unknown, pause?: () => Promise<void>): Promise<void> {
  if (pause === undefined) { preflightShardfile(input); return; }
  const steps = preflightShardfileSteps(input, 64);
  for (;;) {
    if (steps.next().done === true) return;
    await pause();
  }
}
