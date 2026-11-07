import { waitFor } from '@wildshard/engine/boot/waits';

/** DL21: the ready frame's jobs run together and settle as Promise.all would (the first failure fails the step at once,
 *  sp-x1's review), but the jobs beside the spawn view are named on the card only after it ends: a wait named earlier
 *  would stand in front of the spawn view's own job count ('Spawn view · n of m'). A job still running then is named
 *  ('Minimap', 'Horizon paintings'); one already done names nothing. */
export async function spawnViewThenNamed(spawnView: Promise<unknown>, beside: readonly (readonly [label: string, job: Promise<unknown>])[]): Promise<void> {
  const named = spawnView.then(() => Promise.all(beside.map(([label, job]) => waitFor(label, job))));
  await Promise.all([named, ...beside.map(([, job]) => job)]);
}
