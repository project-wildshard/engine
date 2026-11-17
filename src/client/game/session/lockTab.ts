import type { InputService } from '@wildshard/engine/input/InputService';

/** Menu Tab retains navigation; world Tab cycles sockets or opens the Bag. */
export function routeLockTab(input: Pick<InputService, 'active' | 'consume' | 'press'>,
  lock: { cyclePoint: () => boolean }, blocking: boolean): void {
  if (!input.active('menu') && !blocking && input.consume('tab') && !lock.cyclePoint()) input.press('bag');
}
