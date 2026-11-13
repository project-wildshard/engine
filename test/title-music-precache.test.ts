// oxlint-disable-next-line import/no-nodejs-modules -- The worker bakes from this checkout's real document and music table.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { serviceWorkerCore } from '../scripts/app-build/serviceWorker';

// AUDIO AU3: the title's music is precached with START's shell, so play never streams it and a title offline still has it. The
// one style left (AU16, J304) is piano; its `title` slot names the file. No other style's music is in the shell.
const title = `/assets/music/piano/${(JSON.parse(readFileSync('public/assets/music/piano/music.json', 'utf8')) as { slots: { title: { full: string } } }).slots.title.full}`;
const list = (core: string, name: string): unknown => {
  const literal = new RegExp(String.raw`^\s*(?:const|var) ${name} = JSON\.parse\((.+)\);$`, 'mu').exec(core)?.[1];
  if (literal === undefined) throw new Error(`Missing ${name}`);
  return JSON.parse(JSON.parse(literal) as string);
};
const bake = (html: string): ReturnType<typeof serviceWorkerCore> => serviceWorkerCore({ 'index.html': { type: 'asset', source: new TextEncoder().encode(html) } }, process.cwd(), 'au3');

test("a fresh install's shell precache lists the piano title music and no other style's", async () => {
  const { core } = await bake(readFileSync('index.html', 'utf8'));
  const shell = list(core, 'SHELL_FILES');
  if (!Array.isArray(shell)) throw new Error('The shell inventory is a list');
  expect(shell).toContain(title);
  expect(shell.filter(url => typeof url === 'string' && url.startsWith('/assets/music/'))).toEqual([title]);
});

test('with a content base the title music is precached from it, never from the page', async () => {
  const html = readFileSync('index.html', 'utf8').replace('</head>', '<script type="application/json" id="boot-module-files">{"contentBase":"https://cdn.example/content/au3/"}</script></head>');
  const { core } = await bake(html);
  const shell = list(core, 'SHELL_FILES'), literal = /^\s*(?:const|var) \{ base: CONTENT_BASE, files: CONTENT_FILES \} = JSON\.parse\((.+)\);$/mu.exec(core)?.[1];
  if (literal === undefined) throw new Error('Missing the content list');
  const content = JSON.parse(JSON.parse(literal) as string) as { files: string[] };
  expect(shell).not.toContain(title);
  expect(content.files).toContain(`https://cdn.example/content/au3${title}`);
});
