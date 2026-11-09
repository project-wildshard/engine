/**
 * LS4 (J188): the one Copy diagnostics source. The page's loading card lends its
 * report here, so a fatal load screen that covers the card can still copy it.
 * Kept free of the card's module so the shell's failure screen stays light.
 */
let source: (() => string) | null = null;

/** The page's (non-scoped) loading card registers its report; the latest card wins. */
export function setDiagnosticsSource(read: () => string): void { source = read; }
/** The live report, or null when no loading card has run on this page. */
export function diagnosticsSource(): (() => string) | null { return source; }

/** The tap is the user activation the clipboard needs (iOS Safari 13.4+); a refusal says so on the button. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
