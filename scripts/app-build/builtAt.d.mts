/** STALE-BUILD SB1: the build's one time, ms (WS_BUILT_AT, else now). */
export function builtAtOf(requested: string | undefined, now?: number): string;
/** STALE-BUILD SB3: the page entry's first statement, its build time and the age check; '' off build-app. */
export function entryStamp(builtAt: string | undefined): string;
