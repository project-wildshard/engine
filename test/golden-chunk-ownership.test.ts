// @vitest-environment node
import {expect, test} from 'vitest';
import {goldenScriptPaths} from '../src/scripts/goldens/native-residency.mjs';

test('goldens bind shared code from this build and exclude carried classes', () => {
  const files = ['b/current/main.js', 'b/c/control-session.js', 'b/c/style.css', 'b/../private.js', 'b/a/../../bad.js'];
  const graph = {builds: [{build: 'current', files: files.map(path => ({path}))}, {build: 'previous', files: [{path: 'b/c/old-control-session.js'}]}]};
  expect(goldenScriptPaths(graph, 'current')).toEqual(['b/current/main.js', 'b/c/control-session.js']);
  expect(() => goldenScriptPaths(graph, 'absent')).toThrow('ambiguous');
  expect(() => goldenScriptPaths({builds: [...graph.builds, graph.builds[0]]}, 'current')).toThrow('ambiguous');
  expect(() => goldenScriptPaths({}, 'current')).toThrow('missing');
});
