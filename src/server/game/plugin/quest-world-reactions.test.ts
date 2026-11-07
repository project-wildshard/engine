// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Flags } from '@wildshard/engine/world/interact/flags';
import { bindQuestWorldReactions } from './simulation';
import { parseQuestWorldReactions } from '@wildshard/format/questInteractions';

test('contact phase gates crank actions and cones turn an unlocked vane once', () => {
  const flags = new Flags('world-reactions', false), row = { kind: 'point', x: 0, y: 0, z: -2 } as const;
  let pulled = false, hinted = false;
  const contact = bindQuestWorldReactions(parseQuestWorldReactions([{ id: 'crank', at: row, radius: 0.8, heavy: true, second: true,
    needs: { none: ['raised'] }, action: 'pull', lightHint: 'Pull' }]), { flags,
    run: () => { pulled = true; flags.set('raised'); return true; }, toast: () => { hinted = true; } });
  const crank = contact.targets.at(0); if (crank === undefined) throw new Error('Missing crank');
  expect(crank.crack(false, false)).toBe(true); expect(hinted).toBe(true); expect(pulled).toBe(false);
  crank.crack(true, false); expect(pulled).toBe(false); crank.crack(true, true); expect(pulled).toBe(true);
  expect(crank.crack(true, true)).toBe(false);
  const cone = bindQuestWorldReactions(parseQuestWorldReactions([{ id: 'vane', at: row, radius: 0, cone: { reach: 4, halfAngle: 0.3 },
    needs: { all: ['notes'], none: ['turned'] }, sets: ['turned'] }]), { flags });
  cone.scan(new Vector3(), new Vector3(0, 0, -1)); expect(flags.has('turned')).toBe(false);
  flags.set('notes'); cone.scan(new Vector3(), new Vector3(0, 0, 1)); expect(flags.has('turned')).toBe(false);
  cone.scan(new Vector3(), new Vector3(0, 0, -1)); expect(flags.has('turned')).toBe(true);
  expect(cone.scan(new Vector3(), new Vector3(0, 0, -1))).toBe(0);
});
