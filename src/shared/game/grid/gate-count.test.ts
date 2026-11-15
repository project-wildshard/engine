import { expect, test } from 'vitest';
import { GateCount } from './gateCount';
import { GridAssembly } from './assembly';
import { bufferAt } from './zoneWalls';

// ZONE-ENTRY ZE8: the gate card's count, and which buffer the feet stand in.
test('in: 5; 3 s: 2; out: hidden; in again: 5; 5 s: fires once, never twice', () => {
  const gate = new GateCount();
  expect(gate.step('sunscar', 0)).toEqual({ cell: 'sunscar', count: 5, fire: null });
  expect(gate.step('sunscar', 3000).count).toBe(2);
  expect(gate.step(null, 3100)).toEqual({ cell: null, count: 5, fire: null });
  expect(gate.step('sunscar', 4000).count).toBe(5);
  expect(gate.step('sunscar', 8999)).toMatchObject({ count: 1, fire: null });
  expect(gate.step('sunscar', 9000)).toEqual({ cell: 'sunscar', count: 0, fire: 'sunscar' });
  expect(gate.step('sunscar', 9100).fire).toBeNull();
  expect(gate.step('sunscar', 20_000).fire).toBeNull();
  // another buffer starts its own count
  expect(gate.step('nalati', 20_100)).toEqual({ cell: 'nalati', count: 5, fire: null });
});

test('the buffer is the 8 x 10 m pocket inside a walled cell\'s entryway, never the home\'s', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), home = assembly.cell('driftwood-isle'), other = assembly.cell('sunscar-dunes');
  const at = (cell: typeof home, x: number, z: number) => bufferAt(assembly.cells, home, { x: cell.origin.x + x, z: cell.origin.z + z })?.instance ?? null;
  expect(at(other, 245, 0)).toBe(other.instance);
  expect(at(other, 0, -241)).toBe(other.instance);
  expect(at(other, 245, 3.9)).toBe(other.instance);
  expect(at(other, 245, 4.5)).toBeNull(); // past the asphalt's side
  expect(at(other, 239, 0)).toBeNull(); // past the gate
  expect(at(other, 251, 0)).toBeNull(); // still on the road
  expect(at(home, 245, 0)).toBeNull(); // the home has no buffer
});
