import { expect, test } from 'vitest';
import type { MemoryAdmissionRequest } from '@wildshard/format/memoryAdmission';
import { MEMORY_AMBER } from '../grid/budgetOverlay';
import { PHONE_MEMORY_LINE_BYTES, PageMemoryAdmission, ShardMemoryRefusalError } from './phoneMemoryLine';

const request = (playingBytes: number, stage: MemoryAdmissionRequest['stage'] = 'actual'): MemoryAdmissionRequest =>
  ({ stage, owner: 'nine-dragon-stack', id: 'shard:nine-dragon-stack', claimedBytes: 1, accountedBytes: 1, playingBytes, loadingBytes: playingBytes });

test('MG3: the phone line is engine MEMORY_AMBER (J408)', () => {
  expect(PHONE_MEMORY_LINE_BYTES).toBe(MEMORY_AMBER);
});

test('MG3: a phone refuses a shard over the line with a card, even while memoryGates.json is report-only', () => {
  const phone = new PageMemoryAdmission('phone', () => false, true);
  expect(phone.accept(request(1.4e9))).toBe(true);
  expect(() => phone.accept(request(1.699e9))).toThrow(ShardMemoryRefusalError);
  expect(() => phone.accept(request(1.699e9, 'runtime'))).toThrow('This world needs about 1.70 GB of memory and a phone has 1.50 GB to give it');
  expect(() => phone.accept(request(1.6e9, 'declared'))).toThrow(ShardMemoryRefusalError);
});

test('MG3: a live grid residency claim over the line is declined, not thrown', () => {
  expect(new PageMemoryAdmission('phone', () => false, true).accept(request(1.6e9, 'resident'))).toBe(false);
});

test('MG3: a Developer page and the desktop tier keep today\'s admission', () => {
  expect(new PageMemoryAdmission('phone', () => true, false).accept(request(1.8e9))).toBe(true);
  expect(new PageMemoryAdmission('desktop', () => false, true).accept(request(1.8e9))).toBe(true);
  expect(new PageMemoryAdmission('desktop', () => false, false).accept(request(1.8e9))).toBe(false);
});
