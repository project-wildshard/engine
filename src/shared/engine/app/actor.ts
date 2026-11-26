import markers from './actorMarkers.json' with { type: 'json' };

export const AGENT_UA_TOKEN: string = markers.userAgent;
export const AGENT_HEADER: string = markers.header;
export const AGENT_QUERY: string = markers.query;

export interface ActorTags { readonly actor: 'human' | 'agent'; readonly lane?: string }
export interface ActorMark extends ActorTags {
  readonly why: 'door-pass' | 'header' | 'query' | 'user-agent' | 'stored' | 'webdriver' | 'harness' | 'automated-ua' | 'unmarked';
}
export interface ActorFacts {
  readonly userAgent?: string | undefined;
  readonly header?: string | null;
  readonly query?: string | null;
  readonly stored?: string | null;
  readonly webdriver?: boolean;
  readonly harness?: boolean;
  readonly doorPass?: unknown;
}
const Lane = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
const AgentToken = /(?:^|\s)WildshardAgent\/1(?:\s+\(([^)]*)\))?(?=\s|$)/u;
const Automation = /HeadlessChrome|Playwright|PhantomJS|^\s*(?:node|curl|undici)(?:[\s/]|$)/iu;
export const doorPassLane = (value: unknown): string | undefined => typeof value === 'string'
  ? /^pass:([a-z0-9-]{1,40})\.[0-9]{1,12}\.[0-9a-f]{128}$/u.exec(value)?.[1] : undefined;
const marked = (why: ActorMark['why'], value?: string): ActorMark =>
  value !== undefined && value !== '1' && Lane.test(value) ? { actor: 'agent', lane: value, why } : { actor: 'agent', why };

/** Each carrier can mark an agent. Missing evidence can never undo a marker. */
export function classifyActor(facts: ActorFacts): ActorMark {
  const pass = doorPassLane(facts.doorPass);
  if (pass !== undefined) return marked('door-pass', pass);
  const ua = facts.userAgent?.trim(), token = ua === undefined ? null : AgentToken.exec(ua);
  if (facts.header) return marked('header', facts.header.trim());
  if (facts.query) return marked('query', facts.query.trim());
  if (token !== null) return marked('user-agent', token[1]);
  if (facts.stored) return marked('stored', facts.stored.trim());
  if (facts.webdriver === true) return marked('webdriver');
  if (facts.harness === true) return marked('harness');
  if (ua !== undefined && (ua === '' || Automation.test(ua))) return marked('automated-ua');
  return { actor: 'human', why: 'unmarked' };
}

/** J205/J209: production is humans only. A channel that refuses a marked agent at its door: production. */
export const agentsRefusedOn = (channel: string): boolean => channel === 'production';
/** What a refused agent reads: plain words, no code. */
export const AGENTS_REFUSED = 'Wildshard agents never join production (J205); use staging.';
const CARRIERS: ReadonlySet<ActorMark['why']> = new Set(['door-pass', 'header', 'query', 'user-agent', 'stored']);
/** QA 11-25 row 124: the mark an agent sets on purpose (a door pass, the header, `?agent=`, the user agent's token or the
 *  page's stored word). A guess from a headless, webdriver or harness browser is never enough to turn a player away. */
export const carriesAgentMarker = (mark: ActorMark): boolean => mark.actor === 'agent' && CARRIERS.has(mark.why);

export function actorTags({ actor, lane }: ActorTags): ActorTags {
  return lane === undefined ? { actor } : { actor, lane };
}
