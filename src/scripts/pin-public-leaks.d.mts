export interface PinLeak { readonly path: string; readonly pinned: string }
export function trackedPublicPaths(root: string): Set<string>;
export function pinnedBytes(root: string, options?: { tracked?: ReadonlySet<string> }): Map<number, Map<string, string>>;
export function pinPublicLeaks(root: string, options?: { dist?: string; tracked?: ReadonlySet<string> }): { ledger: string[]; public: PinLeak[]; dist: PinLeak[] };
export function assertNoPinPublicLeaks(root: string, options?: { dist?: string }): void;
