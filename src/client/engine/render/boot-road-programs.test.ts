// @vitest-environment happy-dom
// meta IPHONE13-DRIFTWOOD DW3 / DRIFTWOOD-FPS DF8: the boot links its road variants under the card behind `debug.bootRoadPrograms`.
import { afterEach, expect, test } from 'vitest';
import { BOOT_ROAD_PROGRAMS_DEFAULT, BOOT_ROAD_PROGRAMS_DESKTOP, BOOT_ROAD_PROGRAMS_SLOT, bootRoadPrograms, resetBootRoadPrograms } from './precompile';
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';

/** unset: on desktop (DF14), the default elsewhere (the test page is never phone Low) */
const UNSET = TIER === 'desktop' ? BOOT_ROAD_PROGRAMS_DESKTOP : BOOT_ROAD_PROGRAMS_DEFAULT;

const slot = jsonSlot(BOOT_ROAD_PROGRAMS_SLOT, 'device');
afterEach(() => { slot.reset(); resetBootRoadPrograms(); });

test('the slot wins, else the default; read once per page', () => {
  expect(bootRoadPrograms()).toBe(UNSET);
  slot.write(!UNSET);
  expect(bootRoadPrograms()).toBe(UNSET);
  resetBootRoadPrograms();
  expect(bootRoadPrograms()).toBe(!UNSET);
  slot.write('yes');
  resetBootRoadPrograms();
  expect(bootRoadPrograms()).toBe(UNSET);
});
