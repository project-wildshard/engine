// @vitest-environment happy-dom
// meta IPHONE13-DRIFTWOOD DW3 / DRIFTWOOD-FPS DF8: the boot links its road variants under the card behind `debug.bootRoadPrograms`.
import { afterEach, expect, test } from 'vitest';
import { BOOT_ROAD_PROGRAMS_DEFAULT, BOOT_ROAD_PROGRAMS_SLOT, bootRoadPrograms, resetBootRoadPrograms } from './precompile';
import { jsonSlot } from '../saves/slots';

const slot = jsonSlot(BOOT_ROAD_PROGRAMS_SLOT, 'device');
afterEach(() => { slot.reset(); resetBootRoadPrograms(); });

test('the slot wins, else the default; read once per page', () => {
  expect(bootRoadPrograms()).toBe(BOOT_ROAD_PROGRAMS_DEFAULT);
  slot.write(!BOOT_ROAD_PROGRAMS_DEFAULT);
  expect(bootRoadPrograms()).toBe(BOOT_ROAD_PROGRAMS_DEFAULT);
  resetBootRoadPrograms();
  expect(bootRoadPrograms()).toBe(!BOOT_ROAD_PROGRAMS_DEFAULT);
  slot.write('yes');
  resetBootRoadPrograms();
  expect(bootRoadPrograms()).toBe(BOOT_ROAD_PROGRAMS_DEFAULT);
});
