// FM6 mode 36 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): the world's download gave up. The spawn download is the load's one bounded
// operation: each part gets its reads (spawnDownload.ts PART_READS), then the job refuses and its waits fall through to the
// network. When a read that falls through then waits on the card's RETRY too, nothing more will arrive by itself, so the card's
// line (modes 33 to 35) becomes the `download-failed` page (contentRead.ts). A read that waits on RETRY for
// DOWNLOAD_GIVE_UP_MS (the spawn manifest's own read, say) gives up the same way. Dependency-free, so the spawn download and the content
// read share it without either pulling the other in. One page document holds one load's fact.

/** What was measured when the download gave up, never a guess. The address and status are for Details and Copy diagnostics only. */
export interface DownloadGiveUp {
  /** reads of the file or part that refused, its last one included (a RETRY round's reads add to the same count) */
  readonly attempts: number;
  /** the last HTTP status the part answered, null for no HTTP response */
  readonly status: number | null;
  /** what failed, with its address */
  readonly detail: string;
}

let fact: DownloadGiveUp | null = null;
const listeners = new Set<(given: DownloadGiveUp) => void>();

/** The spawn download's job refused (not a cancel). Every read waiting on the card hears it. */
export function noteDownloadGiveUp(given: DownloadGiveUp): void {
  fact = given;
  for (const listen of listeners) listen(given);
}
/** A new download starts: the last one's refusal is over. */
export function clearDownloadGiveUp(): void { fact = null; }
/** The refusal of this page's download, if it gave up. */
export function downloadGiveUp(): DownloadGiveUp | null { return fact; }
/** Hear a refusal from now on; returns the unsubscribe. */
export function onDownloadGiveUp(listen: (given: DownloadGiveUp) => void): () => void {
  listeners.add(listen);
  return () => { listeners.delete(listen); };
}
