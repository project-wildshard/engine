import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual unittest router, including future discovered cases.
import { spawnSync } from 'node:child_process';

test('partitions execute every discovered behavior once and reject invalid or empty groups', () => {
  const result = spawnSync('python3', ['-c', `
import collections, runpy, types, unittest
run = runpy.run_path('scripts/test_partition.py')['run_partition']
module = types.ModuleType('partition_fixture')
seen = []
class Behaviors(unittest.TestCase):
 pass
for index in range(7):
 setattr(Behaviors, 'test_' + str(index), lambda self: seen.append(self.id()))
module.Behaviors = Behaviors
# New cases need no hand-maintained entry in a Vitest wrapper.
setattr(Behaviors, 'test_added_later', lambda self: seen.append(self.id()))
expected = [Behaviors(name).id() for name in unittest.defaultTestLoader.getTestCaseNames(Behaviors)]
for count in (1, 2, 3, 4):
 seen.clear()
 for part in range(1, count + 1):
  try:
   run(module, str(part) + '/' + str(count))
  except SystemExit as exit:
   assert exit.code == 0, exit.code
 assert collections.Counter(seen) == collections.Counter(expected), (seen, expected)
for invalid in ('0/2', '3/2', '1/0', 'one/two', '999/999'):
 seen.clear()
 try:
  run(module, invalid)
  raise AssertionError('accepted invalid/empty partition: ' + invalid)
 except ValueError:
  pass
 assert seen == []
`], { encoding: 'utf8', timeout: 5000 });
  expect(result.status, result.stderr).toBe(0);
});
