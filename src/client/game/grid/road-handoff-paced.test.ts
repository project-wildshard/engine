// meta DRIFTWOOD-FPS DF8 (mini-driftwood13m): the paced road handoff's slot.
import { expect, test } from 'vitest';
import { roadHandoffPaced, ROAD_HANDOFF_PACED_DEFAULT, ROAD_HANDOFF_PACED_PHONE_LOW } from './roadHandoffPaced';

test('a saved boolean wins; unset, phone Low takes its default and everything else the default', () => {
  expect(roadHandoffPaced(true)).toBe(true);
  expect(roadHandoffPaced(false, true)).toBe(false);
  expect(roadHandoffPaced(null, true)).toBe(ROAD_HANDOFF_PACED_PHONE_LOW);
  expect(roadHandoffPaced(undefined)).toBe(ROAD_HANDOFF_PACED_DEFAULT);
});
