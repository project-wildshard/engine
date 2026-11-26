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

/** The public key every real release is signed with: src/scripts/vps/setup.sh's EXPECTED_RELEASE_PUBLIC_KEY (a test holds them equal). */
export const PINNED_RELEASE_KEY = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
/** A release key as every signer writes it: an Ed25519 public key, SPKI DER in lowercase hex (`export({ type: 'spki', format: 'der' })`). */
const RELEASE_KEY_SHAPE = /^302a300506032b6570032100[0-9a-f]{64}$/u;
/** J205/J209: production is humans only. A server refuses a marked agent at its door on a production release the pinned
 *  key signed. A production release its own throwaway key signed is a local replica (mmo-bots, room-soak, the box's
 *  replica.mjs: QA 11-24 row 72 found every marked bot refused there), never production: the real one verifies the
 *  pipeline's signature with the pinned key, so it can't boot on any other. A caller that names no key is refused.
 *  It fails closed: on production only a well-formed key that is not the pinned one admits agents, so an empty, blank,
 *  malformed or unreadable key (a missing env read as `''`) refuses them. */
export const agentsRefusedOn = (channel: string, releaseKey: string = PINNED_RELEASE_KEY): boolean =>
  channel === 'production' && (!RELEASE_KEY_SHAPE.test(releaseKey) || releaseKey === PINNED_RELEASE_KEY);
/** The door's agent mode, for the boot log: a wrong mode shows in the journal. */
export const agentDoorMode = (channel: string, releaseKey: string): string =>
  agentsRefusedOn(channel, releaseKey) ? 'refusing agents' : channel === 'production' ? 'replica, admitting agents' : `${channel}, admitting agents`;
/** What a refused agent reads: plain words, no code. */
export const AGENTS_REFUSED = 'Wildshard agents never join production (J205); use staging.';
const CARRIERS: ReadonlySet<ActorMark['why']> = new Set(['door-pass', 'header', 'query', 'user-agent', 'stored']);
/** QA 11-25 row 124: the mark an agent sets on purpose (a door pass, the header, `?agent=`, the user agent's token or the
 *  page's stored word). A guess from a headless, webdriver or harness browser is never enough to turn a player away. */
export const carriesAgentMarker = (mark: ActorMark): boolean => mark.actor === 'agent' && CARRIERS.has(mark.why);

export function actorTags({ actor, lane }: ActorTags): ActorTags {
  return lane === undefined ? { actor } : { actor, lane };
}
