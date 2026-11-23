/** SHARD-COMPAT SP1b-T: the box cook's record pass, from its environment. With a sidecar folder (`COOK_SIDECARS`) every
 * job reads its shard's `<hash>/<renderer>.tar` (SP1b4); with a recorder as well (`COOK_RECORDER`, the `wildshard`
 * command as a JSON array, and `COOK_PREPARATION_CLIENT`, this engine's preparation client) and a canary slug
 * (`COOK_RECORD_CANARY`), `recook` first records a sidecar for every stale head (`recordCatalogue`, SP1b3b and SP1b5b)
 * so a render change ends `cooked, prepared by cook`. Anything missing skips the pass and says which name. */
// oxlint-disable-next-line import/no-nodejs-modules -- The record pass's folders sit under the host's paths.
import {join, resolve} from 'node:path';
import type {CookStage, ShardfileSource} from './cookWorker';
import {recordCatalogue, type RecordPorts, type RecordRow} from './recordSidecars';
import {wildshardPrepare, type RecorderLauncher} from './sidecarPrepare';

/** The stages a recook visits, live first. */
export const RECORD_STAGES: readonly CookStage[] = ['live', 'preview', 'staging'];
/** A recorder that has not written its preparation in this long is killed; the shard keeps cooking stale. */
export const RECORD_SECONDS = 900;

type Env = Readonly<Record<string, string | undefined>>;
const set = (env: Env, name: string): string | undefined => { const value = env[name]; return value === undefined || value === '' ? undefined : value; };
const words = (env: Env, name: string): readonly string[] | undefined => {
  const value = set(env, name);
  if (value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(word => typeof word === 'string')) throw new Error(`${name} must be a JSON array of strings`);
  return parsed;
};

/** `launcher.sidecars`: the host's sidecar folder, when it keeps one. */
export function cookSidecars(env: Env): string | undefined {
  const folder = set(env, 'COOK_SIDECARS');
  return folder === undefined ? undefined : resolve(folder);
}

/** The record ports, or why the pass is off. The recorder runs under `COOK_RECORD_WRAP` (the job wrap when unset), with
 *  only `PLAYWRIGHT_BROWSERS_PATH` passed on beside the sidecar prepare port's own names. */
export function recordPorts(env: Env, renderer: string | undefined, scratch: string, log: (line: string) => void): {readonly canary: string; readonly ports: RecordPorts} | {readonly off: string} {
  const sidecars = cookSidecars(env);
  if (sidecars === undefined) return {off: 'no COOK_SIDECARS'};
  if (renderer === undefined) return {off: 'no renderer revision'};
  const command = words(env, 'COOK_RECORDER'), client = set(env, 'COOK_PREPARATION_CLIENT'), canary = set(env, 'COOK_RECORD_CANARY');
  if (command === undefined || command.length === 0) return {off: 'no COOK_RECORDER'};
  if (client === undefined) return {off: 'no COOK_PREPARATION_CLIENT'};
  if (canary === undefined) return {off: 'no COOK_RECORD_CANARY'};
  const seconds = Number(set(env, 'COOK_RECORD_SECONDS') ?? RECORD_SECONDS), browsers = set(env, 'PLAYWRIGHT_BROWSERS_PATH');
  const launcher: RecorderLauncher = {command, client: resolve(client), wrap: words(env, 'COOK_RECORD_WRAP') ?? words(env, 'COOK_JOB_WRAP') ?? [],
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : RECORD_SECONDS, ...(browsers === undefined ? {} : {env: {PLAYWRIGHT_BROWSERS_PATH: browsers}})};
  const accepted = new Set((set(env, 'COOK_RECORD_ACCEPTED') ?? '').split(',').map(hash => hash.trim()).filter(hash => hash !== ''));
  return {canary, ports: {renderer, sidecars, scratch: join(scratch, 'record'), prepare: wildshardPrepare(launcher), accepted, log}};
}

/** The pass a recook runs first: off (logged once, nothing recorded) or `recordCatalogue` over every stage. */
export function recordPass(env: Env, renderer: string | undefined, scratch: string, source: ShardfileSource, log: (line: string) => void): Promise<readonly RecordRow[]> {
  const pass = recordPorts(env, renderer, scratch, log);
  if ('off' in pass) { log(`record pass off: ${pass.off}`); return Promise.resolve([]); }
  log(`record pass: canary ${pass.canary}, sidecars ${pass.ports.sidecars}, renderer ${pass.ports.renderer}`);
  return recordCatalogue(source, RECORD_STAGES, pass.canary, pass.ports);
}
