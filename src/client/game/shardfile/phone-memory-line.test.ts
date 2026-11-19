import { expect, test, vi } from 'vitest';
import type { MemoryAdmissionRequest } from '@wildshard/format/memoryAdmission';
import { MEMORY_AMBER } from '../grid/budgetOverlay';
import { PHONE_MEMORY_LINE_BYTES, PageMemoryAdmission, cookedPhoneEstimate } from './phoneMemoryLine';

const request = (playingBytes: number, stage: MemoryAdmissionRequest['stage'] = 'actual', loadingBytes = playingBytes): MemoryAdmissionRequest =>
  ({ stage, owner: 'nine-dragon-stack', id: 'shard:nine-dragon-stack', claimedBytes: 1, accountedBytes: 1, playingBytes, loadingBytes });

test('MG3: the phone warning line is engine MEMORY_AMBER', () => {
  expect(PHONE_MEMORY_LINE_BYTES).toBe(MEMORY_AMBER);
});

test('J431: phone boot admits over-line estimates and shares one acknowledgement', async () => {
  const phone = new PageMemoryAdmission('phone', () => false, false);
  let acknowledge = (): void => undefined;
  const choice = new Promise<void>(resolve => { acknowledge = resolve; });
  const show = vi.fn(() => choice);
  expect(phone.accept(request(PHONE_MEMORY_LINE_BYTES))).toBe(true);
  expect(phone.waitForWarning(show)).toBeUndefined();
  expect(phone.accept(request(1.4e9, 'declared', 1.6e9))).toBe(true);
  expect(phone.waitForWarning(show)).toBe(choice);
  expect(phone.accept(request(1.7e9, 'actual'))).toBe(true);
  expect(phone.waitForWarning(show)).toBe(choice);
  expect(show).toHaveBeenCalledTimes(1);
  acknowledge();
  await phone.waitForWarning(show);
});

test('J431: resident grid estimates use the budget reports without a boot dialog', () => {
  const phone = new PageMemoryAdmission('phone', () => false, true);
  expect(phone.accept(request(1.6e9, 'resident'))).toBe(true);
  expect(phone.waitForWarning(vi.fn())).toBeUndefined();
});

test('J431: Developer can keep measuring and desktop keeps its ordinary admission', () => {
  const phone = new PageMemoryAdmission('phone', () => true, false);
  const desktop = new PageMemoryAdmission('desktop', () => false, true);
  expect(phone.accept(request(1.8e9, 'runtime'))).toBe(true);
  expect(phone.waitForWarning(vi.fn())).toBeUndefined();
  expect(desktop.accept(request(1.8e9))).toBe(true);
  expect(desktop.waitForWarning(vi.fn())).toBeUndefined();
  expect(new PageMemoryAdmission('desktop', () => false, false).accept(request(1.8e9))).toBe(false);
});

test('a stamped cooked estimate can warn before any runtime claim', async () => {
  const phone = new PageMemoryAdmission('phone', () => false);
  const show = vi.fn(() => Promise.resolve());
  const saved: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__');
  Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', [
    { path: '/shardfiles/template/shard.json', worst: { playing: 1.4e9, loading: 1.5e9 } },
    { path: '/shardfiles/brasscap-mesa/shard.json', worst: { playing: 1.4e9, loading: 1.6e9 } },
  ]);
  try {
    expect(phone.waitForWarning(show, 'template')).toBeUndefined();
    await phone.waitForWarning(show, 'brasscap-mesa');
    expect(show).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', saved);
  }
});

test('the current zone reads only its own estimate from the build stamp', () => {
  const estimate = { playing: 1.4e9, loading: 1.6e9 };
  const saved: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__');
  Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', [{ path: '/shardfiles/brasscap-mesa/shard.json', worst: estimate }]);
  try {
    expect(cookedPhoneEstimate('brasscap-mesa')).toEqual(estimate);
    expect(cookedPhoneEstimate('pine-hollow')).toBeUndefined();
    Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', {});
    expect(cookedPhoneEstimate('brasscap-mesa')).toBeUndefined();
  } finally {
    Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', saved);
  }
});
