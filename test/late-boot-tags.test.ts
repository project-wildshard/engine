import { expect, test } from 'vitest';
import { lateBootTags, stampBuildHtml } from '../src/scripts/app-build/buildIdentity.mjs';

/** FIRST-OPEN-PROGRESS (QA-FEEDBACK 2026-11-16 row 17): Jake's cold Home Screen open of v0.1.29 showed iOS's still launch
 * image for 10 s and the shell's moving bar for a tenth of a second, because iOS holds that image until `load` and every
 * bundle tag held `load` back. The title document's bundle tags now wait in an inert template: written back in place in a
 * browser tab, added after `load` on a Home Screen launch. src/scripts/first-open-progress-proof.mjs proves it on a real
 * build (WebKit 402x874, cold, shaped line): `load` before the first bundle request when standalone. */
const MODULE = '<script type="module" crossorigin src="/b/abc1234-x/main-AAAA.js"></script>';
const PRELOADS = ['<link rel="modulepreload" crossorigin href="/b/c/entry-BBBB.js">', '<link rel="modulepreload" crossorigin href="/b/c/shared-CCCC.js">'];
const SHEET = '<link rel="stylesheet" crossorigin href="/b/c/style-DDDD.css">';
const built = (shell = true): string => '<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{}</script>'
  + `${MODULE}\n${PRELOADS.join('\n')}\n${SHEET}<link rel="icon" href="/icons/favicon.png"></head><body>`
  + `${shell ? '<div class="ws-launch" data-title-shell></div>' : ''}<script data-loading-first-paint></script></body></html>`;

/** Run the late start script against a stand-in page: a tab (document.write) or a Home Screen launch (load). */
function launch(html: string, standalone: boolean): {written: string[]; appended: unknown[]; load: (() => void) | undefined; frame: () => void; timers: () => void} {
  const start = /<script data-boot-late-start>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? '';
  const template = /<template data-boot-late>([\s\S]*?)<\/template>/u.exec(html)?.[1] ?? '';
  const written: string[] = [], appended: unknown[] = [], content = {fragment: template};
  let load: (() => void) | undefined;
  const document = {
    querySelector: (selector: string) => (selector === 'template[data-boot-late]' ? {innerHTML: template, content} : null),
    write: (markup: string) => { written.push(markup); },
    importNode: (node: unknown, deep: boolean) => (deep ? {clone: node} : null),
    head: {append: (node: unknown) => { appended.push(node); }},
  };
  const addEventListener = (name: string, listener: () => void, options: {once?: boolean}) => { if (name === 'load' && options.once === true) load = listener; };
  const matchMedia = (query: string) => ({matches: standalone && query === '(display-mode: standalone)'});
  let frames: (() => void)[] = [], timeouts: {run: () => void; ms: number}[] = [];
  const requestAnimationFrame = (run: () => void) => { frames.push(run); };
  const setTimeout = (run: () => void, ms: number) => { timeouts.push({run, ms}); };
  /** one painted frame: the callbacks queued before it run, and those they queue wait for the next */
  const frame = (): void => { const now = frames; frames = []; for (const run of now) run(); };
  const timers = (): void => { const now = timeouts; timeouts = []; for (const {run} of now) run(); };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the generated inline script, run against stand-ins
  new Function('document', 'navigator', 'matchMedia', 'addEventListener', 'requestAnimationFrame', 'setTimeout', start)(document, {}, matchMedia, addEventListener, requestAnimationFrame, setTimeout);
  return {written, appended, load, frame, timers};
}

test('the title document keeps its bundle tags, in order, in one inert template right where they were', () => {
  const html = lateBootTags(built());
  const template = /<template data-boot-late>([\s\S]*?)<\/template>/u.exec(html)?.[1] ?? '';
  expect(template).toBe([MODULE, ...PRELOADS, SHEET].join('\n'));
  // nothing of the bundle is left outside it; the import map stays first, other links stay put
  const outside = html.replace(/<template data-boot-late>[\s\S]*?<\/template>/u, '');
  for (const tag of [MODULE, ...PRELOADS, SHEET]) expect(outside).not.toContain(tag);
  expect(html.indexOf('<script type="importmap">')).toBeLessThan(html.indexOf('<template data-boot-late>'));
  expect(html).toContain('<link rel="icon" href="/icons/favicon.png">');
  expect(html.indexOf('<script data-boot-late-start>')).toBe(html.indexOf('</template>') + '</template>'.length);
  expect(lateBootTags(html)).toBe(html);
});

test('a browser tab writes the tags back while it parses; a Home Screen launch adds them only after load', () => {
  const html = lateBootTags(built());
  const tab = launch(html, false);
  expect(tab.written).toEqual([[MODULE, ...PRELOADS, SHEET].join('\n')]);
  expect(tab.load).toBeUndefined();
  const home = launch(html, true);
  expect(home.written).toEqual([]);
  expect(home.appended).toEqual([]);
  home.load?.();
  // QA-FEEDBACK 11-19 row 18: not in the load event itself. The bundles' code would hold the frame iOS shows when its still
  // image goes, so a cached boot's first frame was the menu. One frame of the moving shell is painted first.
  expect(home.appended).toEqual([]);
  home.frame();
  expect(home.appended).toEqual([]);
  home.frame();
  expect(home.appended).toEqual([{clone: {fragment: [MODULE, ...PRELOADS, SHEET].join('\n')}}]);
  home.timers();
  expect(home.appended).toHaveLength(1);
});

test('a Home Screen launch whose frames are throttled still adds the tags, once, 250 ms after load', () => {
  const home = launch(lateBootTags(built()), true);
  home.load?.();
  home.timers();
  expect(home.appended).toEqual([{clone: {fragment: [MODULE, ...PRELOADS, SHEET].join('\n')}}]);
  home.frame(); home.frame();
  expect(home.appended).toHaveLength(1);
  expect(/<script data-boot-late-start>([\s\S]*?)<\/script>/u.exec(lateBootTags(built()))?.[1]).toContain('setTimeout(add,250)');
});

test('a page with no title shell, or a source page with no bundle tags, is unchanged', () => {
  expect(lateBootTags(built(false))).toBe(built(false));
  const source = '<html><head><script type="module" src="/src/client/app/main.ts"></script></head><body><div data-title-shell></div></body></html>';
  expect(lateBootTags(source)).toBe(source);
  expect(() => lateBootTags(`${built().replace('</body>', `${SHEET}</body>`)}`)).toThrow('A bundle tag outside the document head');
});

test('the build stamp applies it after the stylesheet goes non-blocking', () => {
  const html = stampBuildHtml(built(), 'abc1234-x');
  expect(html).toContain('<link rel="stylesheet" crossorigin href="/b/c/style-DDDD.css" media="print" onload="this.media=\'all\'"></template>');
});
