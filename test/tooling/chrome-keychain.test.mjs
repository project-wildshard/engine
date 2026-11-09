// Every Chromium this repo starts passes scripts/chromium-keychain.mjs's KEYCHAIN_ARGS (Jake, 2026-11-09): without
// `--use-mock-keychain` and `--password-store=basic` Chrome for Testing asks the macOS keychain for its Safe Storage key
// and a dialog lands on the desktop at each launch. A raw spawn skips Playwright's defaults, so the rule is explicit:
// a file that launches Chromium or spawns its executable spreads KEYCHAIN_ARGS, and nothing drops Playwright's defaults.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** @param {string} directory @returns {string[]} */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && /\.(?:[cm]?js|[cm]?ts)$/u.test(entry.name) && !/\.d\.[cm]?ts$/u.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
    .filter(file => !file.includes('node_modules') && !file.endsWith('chrome-keychain.test.mjs'));
}

const files = ['scripts', 'test', 'src'].flatMap(sources).map(file => ({ file, text: readFileSync(file, 'utf8') }));
/** Imports Playwright's Chromium and starts it, or spawns a browser executable with DevTools. */
const startsChromium = (/** @type {string} */ text) =>
  /\bimport\b[^;]*\bchromium\b[^;]*from\s+['"](?:playwright|@playwright\/test)['"]/u.test(text)
    && /\.(?:launch|launchPersistentContext|launchServer)\(/u.test(text)
  || /spawn\([^,]*(?:executablePath\(\)|executable)\s*,\s*\[[^\]]*--remote-debugging-port/su.test(text)
  || /\bdefineConfig\(/u.test(text) && /['"]Desktop Chrome['"]/u.test(text);

describe('Chromium launches never prompt for the keychain', () => {
  it('spreads KEYCHAIN_ARGS wherever Chromium starts', () => {
    const bare = files.filter(({ text }) => startsChromium(text) && !text.includes('KEYCHAIN_ARGS')).map(({ file }) => file);
    expect(bare).toEqual([]);
  });
  it('finds the launch sites it guards', () => {
    expect(files.filter(({ text }) => startsChromium(text)).length).toBeGreaterThan(30);
  });
  it('never drops Playwright default arguments', () => {
    expect(files.filter(({ text }) => /ignoreDefaultArgs/u.test(text)).map(({ file }) => file)).toEqual([]);
  });
});
