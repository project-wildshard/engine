import { jsonSlot } from '../saves/slots';

/** DL16 (E525, on for everyone 2026-11-04): a level's download reads its runtime packs (DL5: a few content-named parts).
 *  The device slot below is a test-harness selector, not a toggle: no UI, no URL; the measuring tools (DL17, DL23, the
 *  goldens, the Simulator readings) write 'shardfile' to read the default set's loose files instead (DL20: those stay in
 *  the deploy, as road crossings read them; a level's other files are read through parts). The composition root reads it
 *  once, before any download starts. */
// Versioned key (sp-x6's review of d0683e4e38): the deleted Debug row saved players' picks under 'debug.levelDownload',
// and a device that once picked Shardfile there (Jake's phone included) would never get packs. Only the tools write this key.
export const LEVEL_DOWNLOAD_SLOT = 'debug.levelDownload.harness';
// The first read of a page is its value.
let frozen: boolean | undefined;
/** The device's choice now: packs unless the harness's own key selects the loose files. */
export function levelDownloadPacks(): boolean { return jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device').read() !== 'shardfile'; }
export function runtimePacksOn(): boolean {
  frozen ??= levelDownloadPacks();
  return frozen;
}
