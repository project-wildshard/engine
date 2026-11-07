export declare const WHATS_NEW_PATH: string;
export declare const MAX_AGE_MS: number;
export declare const MAX_FUTURE_MS: number;
/** null when the whatsNew.json body is fresh at `now` (ms), else the reason and how to fix it */
export declare function staleReason(body: string, now: number): string | null;
