// QA 11-25 row 152 (opus-boot151): after nine-dragon's native GPU restart drill the page logged
// "[grid] nine-dragon-stack's declared plan refused Error: Tile resident is disposed". The drill showed what it was: the
// restart only made the boot quicker to reach Explore, whose world view takes the feet out of Nine ~3.8 s in, and the leave
// ends every play install of the cell (`leaveDataStays`). An install still waiting on its tiles then met its disposed owner.
// Nine's plan was there in every run that finished installing before the leave. A leave mid-install is no refusal, and
// the plan installs again on the next entry: a stay the feet left never stays missing once they are back.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DATA_STAY_MARK, LiveGridSession } from '../src/client/game/grid/liveSession';
import { Scope } from '../src/shared/engine/app/scope';
import { isDev, setDev } from '../src/client/engine/core/devMode';

type Install = (stay: Scope, here: () => boolean) => Promise<void> | void;
interface Stays { enter: (kind: string, instance: string, install: Install) => void; leave: () => void; held: () => readonly string[] }

function session(): Stays {
  const value: unknown = Object.create(LiveGridSession.prototype);
  if (!(value instanceof LiveGridSession)) throw new Error('Missing live session prototype');
  const stays = new Map<string, { instance: string; scope: Scope }>();
  Reflect.set(value, 'ports', { scope: new Scope('row152.session') });
  Reflect.set(value, 'dataStays', stays);
  Reflect.set(value, 'wire', null);
  const call = (name: string, ...args: unknown[]): void => {
    const method: unknown = Reflect.get(LiveGridSession.prototype, name);
    if (typeof method !== 'function') throw new Error(`Missing ${name}`);
    Reflect.apply(method, value, args);
  };
  return {
    enter: (kind, instance, install) => { call('enterDataStay', kind, instance, install); },
    leave: () => { call('leaveDataStays'); },
    held: () => [...stays.entries()].filter(([, held]) => !held.scope.disposed).map(([kind]) => kind),
  };
}
/** An install that waits on its tiles as `residentTiles` does: it refuses once its owner is gone. */
function tiles(): { install: Install; land: () => void } {
  let land = (): void => undefined;
  const landed = new Promise<void>(resolve => { land = resolve; });
  return { land: () => { land(); }, install: async (stay) => {
    await landed;
    if (stay.disposed || stay.disposing) throw new Error('Tile resident is disposed');
  } };
}
const outcomes = (): unknown[] => performance.getEntriesByName(DATA_STAY_MARK).map(entry => (entry as PerformanceMark).detail);
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

const wasDev = isDev();
beforeEach(() => { setDev(true); performance.clearMarks(DATA_STAY_MARK); });
afterEach(() => { setDev(wasDev); vi.restoreAllMocks(); });

test('feet that leave the cell mid-install end the plan quietly, and the next entry installs it again', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const page = session(), first = tiles();
  page.enter('plan', 'nine-dragon-stack', first.install);
  page.leave(); // Explore's world view: the feet leave Nine while its plan waits on tiles
  first.land(); await settle();
  expect(error).not.toHaveBeenCalled();
  expect(outcomes()).toEqual([{ kind: 'plan', instance: 'nine-dragon-stack', outcome: 'left' }]);
  const again = tiles();
  page.enter('plan', 'nine-dragon-stack', again.install);
  again.land(); await settle();
  expect(outcomes().at(-1)).toEqual({ kind: 'plan', instance: 'nine-dragon-stack', outcome: 'installed' });
  expect(page.held()).toEqual(['plan']); // the declared plan is resident again, not missing
});

test('a stay its feet still hold that fails is a refusal: logged, and the stay let go', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const page = session();
  page.enter('plan', 'nine-dragon-stack', () => Promise.reject(new Error('Missing world assembly')));
  await settle();
  expect(error).toHaveBeenCalledWith("[grid] nine-dragon-stack's declared plan refused", expect.any(Error));
  expect(outcomes()).toEqual([{ kind: 'plan', instance: 'nine-dragon-stack', outcome: 'refused' }]);
  expect(page.held()).toEqual([]);
});
