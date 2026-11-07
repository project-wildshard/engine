import { expect, test } from 'vitest';
import { unsortedPath } from '../lint/layer-exports.mjs';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { portalFloorRows, deckCapRows } from '../src/shards/nine-dragon-stack/generators/portalFloors';
import { portalEntryRows, portalPlanRows } from '../src/shards/nine-dragon-stack/generators/portalEntries';
import { ninePhysicsPlacements, nineWorldInstallRows } from '../src/shards/nine-dragon-stack/generators/physicsPlacements';
import { floorBoxRows } from '../src/shards/nine-dragon-stack/generators/floorBoxes';
import { frontRows } from '../src/shards/nine-dragon-stack/generators/fronts';
import { ninePhysics } from '../src/shards/nine-dragon-stack/generators/physics';
import { stairPlanData } from '../src/shards/nine-dragon-stack/generators/stairPlan';

// Captured from ea96805666's original registered outputs before replacing file handoffs.
// Signed zero is explicit here, so importing source cannot silently change a JSON-normalized coordinate.
const originals = [
  { id: 'nine-physics', build: ninePhysics, bytes: 91492, hash: 'b8e3c0ec3d23818910d056ed6c902c91c6e6f91c6f4cf5a473f7ee65d2a32f3a' },
  { id: 'nine-portal-floors', build: portalFloorRows, bytes: 1964, hash: 'fa481bc46f7f65b990a77f9fa20f8f31796713e8866a216df780021cc8faf483' },
  { id: 'nine-portal-entries', build: portalEntryRows, bytes: 2134, hash: '5594bddd8345d7f1bb1048ea411b50a0bf22317ad31a1930dadf1f4d4cde5d24' },
  { id: 'nine-fronts', build: frontRows, bytes: 826, hash: '9864d72db08b6ff8a2183787bed50c4235fa510c6c9bc1c257330b13ba899fa6' },
  { id: 'nine-floor-boxes', build: floorBoxRows, bytes: 1216, hash: '14f936f2d190a506ac874b49dc4961f87b8e69f8995f055c0b9366094b5d5c78' },
  { id: 'nine-deck-caps', build: deckCapRows, bytes: 1815, hash: 'db76684de1f11ddeff7300cf12fad9b7004e50a02761b734feea1f5407d065d1' },
  { id: 'nine-stair-plan', build: stairPlanData, bytes: 398, hash: '8cb3a75c38e40050ca033046f40a54f4bc061452d05b459d79b3d3ee6df98799' },
  { id: 'nine-physics-placements', build: ninePhysicsPlacements, bytes: 7431, hash: '352c45c74e7e4b4cd1839885b4e088ea09f07475acb0136fde36d6b8ca096c06' },
  { id: 'nine-portal-plan', build: portalPlanRows, bytes: 597, hash: 'ae06cb30a7118e8f6bd1bd000cec3a512aa43e7db401f4787ba1d94743aa9899' },
  { id: 'nine-world-install', build: nineWorldInstallRows, bytes: 13273, hash: 'b6c84f8dec5933b50e371799f8cad6b26ab88e02503f07e78c0c7058ade9522a' },
] as const;

test.each(originals)('$id preserves the original complete row payload', row => {
  // A row's `file` is compared by side-free identity: the sort and later retags move files, not rows.
  const bytes = new TextEncoder().encode(JSON.stringify(row.build(), (key, value: unknown) => Object.is(value, -0) ? '-0'
    : key === 'file' && typeof value === 'string' ? unsortedPath(value) : value));
  expect(bytes.byteLength).toBe(row.bytes);
  expect(hashImmutableBytes(bytes)).toBe(row.hash);
});
