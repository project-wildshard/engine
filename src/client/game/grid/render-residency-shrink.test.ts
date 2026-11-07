import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { PlatformRenderResidency } from './renderResidency';

test('retired road geometry releases bytes while the shared material scope stays owned', () => {
  const scope = new Scope('road charge'), allocator = new ResidencyAllocator(), admission = new PlatformRenderResidency(allocator, scope);
  admission.allocate({ id: 'road.deck', jsBytes: 100, gpuBytes: 200 }, () => undefined);
  expect(allocator.entries().find(row => row.id === 'platform:render:road.deck')?.bytes).toBe(300);
  admission.shrink('road.deck', 40);
  expect(allocator.entries().find(row => row.id === 'platform:render:road.deck')?.bytes).toBe(40);
  expect(() => admission.shrink('road.deck', 41)).toThrow('Invalid platform render shrink');
  expect(() => admission.allocate({ id: 'road.deck', jsBytes: 0, gpuBytes: 40 }, () => undefined)).toThrow('already exists');
  scope.dispose(); expect(allocator.has('platform:render:road.deck')).toBe(false);
});

test('missing, invalid and retired claims cannot be shrunk or silently replaced', () => {
  const scope = new Scope('road refusal'), allocator = new ResidencyAllocator(), admission = new PlatformRenderResidency(allocator, scope);
  expect(() => admission.shrink('missing', 0)).toThrow('Invalid platform render shrink');
  admission.allocate({ id: 'road.deck', jsBytes: 10, gpuBytes: 20 }, () => undefined);
  expect(() => admission.shrink('road.deck', -1)).toThrow('Invalid platform render shrink');
  expect(() => admission.shrink('road.deck', Number.NaN)).toThrow('Invalid platform render shrink');
  scope.onDispose(() => { expect(() => admission.shrink('road.deck', 0)).toThrow('disposed'); });
  scope.dispose(); expect(() => admission.shrink('road.deck', 0)).toThrow('disposed');
});
