import { classifyActor, type ActorFacts, type ActorMark } from '../../../shared/engine/app/actor';
import { harnessPins } from '../../../shared/engine/app/identity';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import type { SaveStorage } from '../../../shared/engine/saves/store';

const key = 'ws-agent';
// The title and online host share the explicit entry marker across bundles.
const querySlot = Symbol.for('wildshard.page-agent-query');

export function classifyActorTab(search: string, storage: Pick<SaveStorage, 'getItem' | 'setItem'> | null | undefined, facts: ActorFacts): ActorMark {
  const query = new URLSearchParams(search).getAll('agent').find(value => value.length > 0) ?? null;
  let stored = null;
  try {
    if (query !== null) storage?.setItem(key, classifyActor({ query }).lane ?? '1');
    else stored = storage?.getItem(key) ?? null;
  } catch { /* An inaccessible save still leaves the current URL's marker usable. */ }
  return classifyActor({ ...facts, query, stored });
}

/** Keep the explicit URL marker through navigation, including with storage disabled. */
export function pageActor(): ActorMark {
  const current = Reflect.get(globalThis, querySlot) as ActorMark | undefined;
  if (current !== undefined) return current;
  if (typeof window === 'undefined') return classifyActor({});
  const marked = classifyActorTab(window.location.search, saveEnvironment().storage('session'), {
    userAgent: window.navigator.userAgent, webdriver: window.navigator.webdriver, harness: harnessPins() !== undefined,
    doorPass: Reflect.get(window, '__wildshardDoorPass'),
  });
  if (marked.why === 'query') Reflect.set(globalThis, querySlot, marked);
  return marked;
}
