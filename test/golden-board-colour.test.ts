import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the board's actual colour guard without optional image libraries.
import { spawnSync } from 'node:child_process';

test('golden colour guard flags exposure and saturation shifts without flagging small motion', () => {
  const result = spawnSync('python3', ['-c', `
import runpy, sys
# Match the ordinary CI checkout: this guard cannot depend on anything in art/.
def refuse_art(event, args):
 if event == 'open' and 'art' in str(args[0]).replace(chr(92), '/').split('/'):
  raise AssertionError('Colour guard must run without art checkout')
sys.addaudithook(refuse_art)
guard = runpy.run_path('scripts/goldens/colour_shift.py')
shift = guard['colour_shift']
assert not shift([(128, 128, 128)], [(128, 128, 128)])['red']
assert shift([(128, 128, 128)], [(64, 64, 64)])['red']
assert shift([(128, 128, 128)], [(192, 192, 192)])['red']
assert shift([(128, 128, 128)], [(164, 108, 108)])['red']
assert shift([(164, 108, 108)], [(128, 128, 128)])['red']
assert not shift([(128, 128, 128)], [(108, 108, 108)])['red']
assert not shift([(128, 128, 128)] * 100, [(128, 128, 128)] * 99 + [(0, 0, 0)])['red']
assert not shift([(200, 40, 20), (20, 40, 200)], [(20, 40, 200), (200, 40, 20)])['red']
# The actual reported Nalati ground/sky sample loses exposure and gains saturation.
nalati = shift([(148, 122, 96), (163, 143, 140)], [(64, 43, 28), (117, 83, 79)])
assert nalati['red'] and nalati['luma_delta'] < -0.15 and nalati['saturation_delta'] > 0.08
assert shift([(100, 100, 100)], [(100, 92, 92)])['red']
try:
 shift([], [])
 raise AssertionError('accepted empty colour samples')
except ValueError:
 pass
`], { encoding: 'utf8', timeout: 5000 });
  expect(result.status, result.stderr).toBe(0);
});
