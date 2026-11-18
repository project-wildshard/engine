import { expect, test } from 'vitest';
import { GRAPH_ADMISSION_LIMITS } from '@wildshard/format/materialGraph';
import { graphFileCandidate } from './graphFileCandidate';

test('EM24: only JSON a graph file can be is kept for lazy graph compiles', () => {
  expect(graphFileCandidate({ kind: 'json', compressed: 1_200 })).toBe(true);
  expect(graphFileCandidate({ kind: 'json', compressed: GRAPH_ADMISSION_LIMITS.bytes })).toBe(true);
  // Pine's 3.2 MB ground layout and a 1 MB placement page are documents, not graph files
  expect(graphFileCandidate({ kind: 'json', compressed: GRAPH_ADMISSION_LIMITS.bytes + 1 })).toBe(false);
  expect(graphFileCandidate({ kind: 'json', compressed: 3_198_511 })).toBe(false);
  expect(graphFileCandidate({ kind: 'glb', compressed: 1_200 })).toBe(false);
});
