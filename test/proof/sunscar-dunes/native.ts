import { nativeCompatibility } from '../compatibility/native';

/** The source-checkout worker (replay's shipping-worker check) runs with Node's type transform, which warns once per process. */
const WORKER_WARNING = /^\(node:\d+\) ExperimentalWarning: Transform Types is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n/u;

/** Signal's witness in a fresh plain Node process; stderr keeps everything except that one known warning. */
export function signalWitness(mode = 'all'): { status: number | null; stdout: string; stderr: string } {
  const result = nativeCompatibility('sunscar-dunes', mode);
  return { ...result, stderr: result.stderr.replace(WORKER_WARNING, '') };
}
