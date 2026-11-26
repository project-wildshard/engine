// QA-FEEDBACK 11-19 row 46 (Jake, staging v0.1.50 from the Home Screen: "The game flashes white on startup"). His recording:
// iOS shows the launch still for about 9 s, drops it, and the page is white for 14 s on a slow line before the shell paints.
// Every surface before the shell's own paint is the shell's dark: the head opens with a first-paint block that the build
// keeps in the document's first bytes (its injected stamp and boot-module list go after it), and theme-color and the
// manifest name the same colour.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { afterFirstPaint, stampBuildHtml } from '../src/scripts/app-build/buildIdentity.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')) as { background_color: string; theme_color: string };
/** the shell's own html/body background, from its inline sheet */
const shellDark = /html, body \{[^}]*background: (#[0-9a-f]{6});/u.exec(source.slice(source.indexOf('<style>')))?.[1];

test('the head opens with the shell dark: charset, colour scheme and background before any script', () => {
  expect(shellDark).toBe('#050810');
  const head = source.slice(source.indexOf('<head>') + '<head>'.length);
  const firstScript = head.indexOf('<script');
  const block = head.slice(0, head.indexOf('</style>') + '</style>'.length);
  expect(block).toMatch(/^\s*<meta charset="UTF-8" \/>\s*<meta name="color-scheme" content="dark" \/>\s*<style data-first-paint>/u);
  expect(block).toContain(`background: ${String(shellDark)}`);
  expect(head.indexOf('</style>')).toBeLessThan(firstScript);
});

test('theme-color and the manifest colours are the shell dark', () => {
  expect(/<meta name="theme-color" content="(#[0-9a-f]{6})"/u.exec(source)?.[1]).toBe(shellDark);
  expect(manifest.background_color).toBe(shellDark);
  expect(manifest.theme_color).toBe(shellDark);
});

test('the build stamp goes after the first-paint block, which stays the first bytes', () => {
  const stamped = stampBuildHtml(source, 'abc1234-row46');
  const block = stamped.indexOf('<style data-first-paint>');
  expect(block).toBeGreaterThan(stamped.indexOf('<head>'));
  expect(block).toBeLessThan(stamped.indexOf('globalThis.__WS_BUILD_ID__'));
  expect(block).toBeLessThan(1024);
});

test('a head-start injection lands after the block, or at the head when there is none', () => {
  const html = '<html><head>\n  <meta charset="UTF-8" />\n  <style data-first-paint>html { background: #050810; }</style>\n  <script>later()</script></head></html>';
  const headEnd = html.indexOf('<head>') + '<head>'.length;
  const at = afterFirstPaint(html, headEnd);
  expect(html.slice(at).trimStart().startsWith('<script>later()')).toBe(true);
  expect(afterFirstPaint('<html><head><script>x()</script></head></html>', 12)).toBe(12);
});
