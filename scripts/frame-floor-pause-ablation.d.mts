/** Bounded browser-rAF windows, with independent drawn frame and tick counters. */
export const ABLATION_NORMAL: string;
export const ABLATION_PAUSED: string;
export const ABLATION_BUFFERS: string;
/** Dispatch existing UI pointer actions only. */
export const OPEN_PAUSE_MENU: string;
export const CLOSE_PAUSE_MENU: string;
export function ablationWindow(mode: 'normal' | 'paused' | 'buffers'): Promise<unknown>;
export function pauseMenuAction(open: boolean): void;
/** One pre-window connection refresh; document replacement refuses without starting A. */
export interface AblationDocument { readonly timeOrigin: number; readonly token: string; }
export function refreshAblationInspector(reconnect: () => Promise<unknown>, expected: AblationDocument): Promise<AblationDocument & {readonly originDriftMs: number}>;

/** After A: either B then C using existing UI, or only C with no UI action. */
export function ablationPhases(includePause: boolean): readonly { readonly mode: 'paused' | 'buffers'; readonly expression: string; readonly action: string | null }[];
