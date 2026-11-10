import { afterEach, expect, test } from 'vitest';
import { keycap, shortcut } from './keycap';
import { detectKeyPlatform, setKeyPlatform } from './platform';

afterEach(() => { setKeyPlatform(undefined); });

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

test('KP1 (Jake 2026-11-09, "Alt is not a thing" on a Mac): the platform comes from client hints, then platform, then the UA', () => {
  expect(detectKeyPlatform({ userAgentData: { platform: 'macOS' }, userAgent: WINDOWS })).toBe('mac');
  expect(detectKeyPlatform({ userAgentData: { platform: 'Windows' } })).toBe('windows');
  expect(detectKeyPlatform({ userAgentData: { platform: 'Linux' } })).toBe('linux');
  expect(detectKeyPlatform({ platform: 'MacIntel', userAgent: MAC_SAFARI })).toBe('mac');
  expect(detectKeyPlatform({ platform: 'MacIntel', userAgent: IPAD, maxTouchPoints: 5 })).toBe('mac');
  expect(detectKeyPlatform({ platform: 'Win32', userAgent: WINDOWS })).toBe('windows');
  expect(detectKeyPlatform({ platform: 'Linux x86_64', userAgent: LINUX })).toBe('linux');
  expect(detectKeyPlatform({ userAgent: MAC_CHROME })).toBe('mac');
  expect(detectKeyPlatform({ userAgentData: { platform: 'Chrome OS' } })).toBe('other');
  expect(detectKeyPlatform({})).toBe('other');
  expect(detectKeyPlatform({ userAgentData: { platform: 'Windows' }, userAgent: MAC_CHROME })).toBe('windows');
  // an Android or ChromeOS UA wins over a navigator.platform of "Linux …"
  expect(detectKeyPlatform({ platform: 'Linux armv81', userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/142' })).toBe('other');
  expect(detectKeyPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) Chrome/142' })).toBe('other');
});

test('a Mac reads ⌥ Option, ⌘ Cmd and ⌘W; Windows and Linux read Alt, Win and Ctrl+W', () => {
  setKeyPlatform('mac');
  expect([keycap('AltLeft'), keycap('Alt'), keycap('MetaLeft'), keycap('ControlLeft'), keycap('KeyV'), keycap('Space')])
    .toEqual(['⌥ Option', '⌥ Option', '⌘ Cmd', '⌃ Ctrl', 'V', 'Space']);
  expect([shortcut('W'), shortcut('T')]).toEqual(['⌘W', '⌘T']);
  for (const platform of ['windows', 'linux', 'other'] as const) {
    setKeyPlatform(platform);
    expect([keycap('AltLeft'), keycap('MetaLeft'), keycap('ControlLeft'), keycap('KeyV')]).toEqual(['Alt', platform === 'linux' ? 'Super' : 'Win', 'Ctrl', 'V']);
    expect(shortcut('W')).toBe('Ctrl+W');
  }
});
