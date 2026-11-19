import { AGENT_QUERY, classifyActor, type ActorFacts, type ActorMark } from '../../../shared/engine/app/actor';
import { harnessPins } from '../../../shared/engine/app/identity';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import type { SaveStorage } from '../../../shared/engine/saves/store';

const key = 'ws-agent';
let current: ActorMark | undefined;

export function classifyActorTab(search: string, storage: Pick<SaveStorage, 'getItem' | 'setItem'> | null | undefined, facts: ActorFacts): ActorMark {
  const query = new URLSearchParams(search).getAll(AGENT_QUERY).find(value => value.length > 0) ?? null;
  let stored = null;
  try {
    if (query !== null) storage?.setItem(key, classifyActor({ query }).lane ?? '1');
    else stored = storage?.getItem(key) ?? null;
  } catch { /* An inaccessible save still leaves the current URL's marker usable. */ }
  return classifyActor({ ...facts, query, stored });
}

/** Read the entry URL once before SPA travel can change it. */
export function pageActor(): ActorMark {
  if (current !== undefined) return current;
  if (typeof window === 'undefined') return classifyActor({});
  current = classifyActorTab(window.location.search, saveEnvironment().storage('session'), {
    userAgent: window.navigator.userAgent, webdriver: window.navigator.webdriver, harness: harnessPins() !== undefined,
    doorPass: Reflect.get(window, '__wildshardDoorPass'),
  });
  return current;
}
