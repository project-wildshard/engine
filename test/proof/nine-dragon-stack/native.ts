import { nativeCompatibility } from '../compatibility/native';

/** Source-checkout workers use Node's type transform; preserve every other diagnostic. */
const WORKER_WARNING = /^\(node:\d+\) ExperimentalWarning: Transform Types is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n/gmu;

/** Nine's native witness, excluding only the known transform-types warning from its shipping workers. */
export function nineWitness(mode = 'all'): { status: number | null; stdout: string; stderr: string } {
  const result = nativeCompatibility('nine-dragon-stack', mode);
  return { ...result, stderr: result.stderr.replace(WORKER_WARNING, '') };
}
