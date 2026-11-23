/** PZ12 (J274): the channels whose page origin is cross-origin isolated. */
export const ISOLATED_CHANNELS: ReadonlySet<string>;
export const ISOLATION_HEADERS: Readonly<Record<string, string>>;
export function isolated(channel: string | undefined): boolean;
/** The _headers text with the isolation rule appended once for an isolated channel. */
export function withIsolationRule(text: string, channel: string | undefined): string;
/** Append the rule to a build's _headers; returns whether the channel is isolated. */
export function writeIsolationRule(outDir: string, channel: string | undefined): boolean;
/** The COOP and COEP a _headers text sends on its /* rules, lower-cased. */
export function documentIsolation(text: string): Record<string, string>;
/** DW12: the opener policy every channel's game document sends. */
export const DOCUMENT_OPENER: 'same-origin';
/** DW12: whether a path is the game's document (`/`, `/index.html`, `/slug/<slug>`). */
export function isDocumentRoute(pathname: string): boolean;
/** DW12: the service worker's document headers: the opener policy, then the channel's isolation. */
export function documentHeaders(text: string): Record<string, string>;
/** DW12: the leave page's path, bytes and headers (no opener policy, never stored). */
export const LEAVE_PATH: '/leave';
export const LEAVE_PAGE: string;
export const LEAVE_HEADERS: Readonly<Record<string, string>>;
