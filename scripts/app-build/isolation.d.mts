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
