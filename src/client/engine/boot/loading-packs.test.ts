import { expect, test } from 'vitest';
import { jsonSlot } from '../saves/slots';
import { LEVEL_DOWNLOAD_SLOT, levelDownloadPacks } from './loadingPacks';

// DL16 (sp-x6's review of d0683e4e38): Runtime packs are on for everyone; only the test harness can select the loose files.
test("a stale pick of the deleted Debug row never keeps a device on loose files; the harness's own key still can", () => {
  expect(levelDownloadPacks()).toBe(true);
  // what the old row saved on a device that tried it (Jake's phone included)
  jsonSlot('debug.levelDownload', 'device').write('shardfile');
  expect(levelDownloadPacks()).toBe(true);
  expect(LEVEL_DOWNLOAD_SLOT).not.toBe('debug.levelDownload');
  jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device').write('shardfile');
  expect(levelDownloadPacks()).toBe(false);
  jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device').write('packs');
  expect(levelDownloadPacks()).toBe(true);
});
