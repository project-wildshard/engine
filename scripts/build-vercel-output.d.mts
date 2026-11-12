/** PAGE-SIZE PZ1: the release file a built page names, or '' for a solo page. */
export function pageRelease(html: string): string;
/** PAGE-SIZE PZ1: the Sentry environment a release build's source maps go to, or undefined for none. */
export function sentryEnvironment(env: Record<string, string | undefined>, html?: string): string | undefined;
