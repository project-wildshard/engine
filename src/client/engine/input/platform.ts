/**
 * Which keyboard the player has (KP1, Jake 2026-11-09 on his Mac: "It says press Alt to dodge ... I pressed Command on
 * Mac. So Alt is not a thing ... the keyboard shortcuts need to be showing, you know, Mac, Windows, Linux"). Key labels
 * (keycap.ts) and the browser-shortcut note read it, so a Mac shows ⌥ Option and ⌘W where Windows and Linux show Alt
 * and Ctrl+W. An iPad with a keyboard is a Mac keyboard (⌘ and ⌥).
 *
 *   keyPlatform()                 // 'mac' | 'windows' | 'linux' | 'other', read once per page
 *   setKeyPlatform('windows')     // tests and the proof page; undefined goes back to the browser's own answer
 */
export type KeyPlatform = 'mac' | 'windows' | 'linux' | 'other';

interface PlatformNavigator { userAgentData?: { platform?: string }; platform?: string; userAgent?: string; maxTouchPoints?: number }

/** The platform a navigator reports: User-Agent Client Hints first (Chromium), then `navigator.platform`, then the UA. */
export function detectKeyPlatform(nav: PlatformNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): KeyPlatform {
  // an Android or ChromeOS UA names itself; its navigator.platform may still say "Linux armv8l"
  const ua = nav?.userAgent ?? '', named = /android|cros/iu.test(ua) ? ua : undefined;
  for (const said of [nav?.userAgentData?.platform, named, nav?.platform, ua]) {
    const platform = said === undefined || said === '' ? undefined : classify(said);
    if (platform !== undefined) return platform;
  }
  return 'other';
}
function classify(said: string): KeyPlatform | undefined {
  // iPadOS asks for desktop sites as "MacIntel"; either way its keyboard has ⌘ and ⌥
  if (/mac|iphone|ipad|ipod|ios/iu.test(said)) return 'mac';
  if (/win/iu.test(said)) return 'windows';
  if (/android|cros|chrome os/iu.test(said)) return 'other';
  if (/linux|x11/iu.test(said)) return 'linux';
  return undefined;
}

let forced: KeyPlatform | undefined;
let detected: KeyPlatform | undefined;
export function keyPlatform(): KeyPlatform { return forced ?? (detected ??= detectKeyPlatform()); }
export function setKeyPlatform(platform: KeyPlatform | undefined): void { forced = platform; }
