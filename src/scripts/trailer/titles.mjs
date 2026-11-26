// The trailer's typography as transparent 60 fps PNG sequences (titles.html's pose(card, t) per frame). Restored from
// singleplayer scripts/steam-trailer/titles.mjs (cf104912d3^) for any trailer (docs/trailer.md).
//   node src/scripts/trailer/titles.mjs <outDir> <cards.json>      cards.json: [{ id, card, dur, ...opts }] (cut.mjs writes it)
//   node src/scripts/trailer/titles.mjs <outDir> --preview [cards.json]   one still per card at its `at`
//   … [--portrait]   a 1080×1920 frame (titles.html body.portrait)
//   … [--titles-html=<path>]   another cards page in place of ./titles.html; it must define window.pose(card, t, opts) and
//        window.setPortrait(on), its URLs resolve from its own folder
// Headless Chromium, muted, with the keychain flags.
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FPS = 60;
/** The times a card is posed at: every 60 fps frame of its `dur`, or its one `at` for a preview still.
 * @param {{ dur: number, at?: number }} card @param {boolean} preview */
export const cardTimes = (card, preview) => (preview ? [card.at ?? 0] : Array.from({ length: Math.round(card.dur * FPS) }, (_, i) => i / FPS));

/** @param {string[]} args the whole process.argv */
export async function main(args) {
  const flag = args.find((a) => a.startsWith('--titles-html='));
  const argv = args.filter((a) => a !== flag);
  const HTML = flag ? pathToFileURL(resolve(flag.slice('--titles-html='.length))).href : new URL('titles.html', import.meta.url).href;
  const OUT = argv[2];
  if (!OUT) { console.error('node src/scripts/trailer/titles.mjs <outDir> <cards.json> | --preview [cards.json]'); return 2; }
  const preview = argv[3] === '--preview';
  const PORTRAIT = argv.includes('--portrait');
  /** @type {any[]} */
  const cards = preview && argv[4] && argv[4] !== '--portrait' ? JSON.parse(readFileSync(argv[4], 'utf8')) : preview
    ? [{ id: 'p-shard', card: 'shard', dur: 3, kicker: 'Zone', name: 'Driftwood Isle', sub: 'Sail · Dive · Fight', at: 1.6 },
       { id: 'p-line', card: 'line', dur: 2.5, text: 'One world, built by its players', at: 1.4 },
       { id: 'p-bug', card: 'bug', dur: 1, at: 0.5 }]
    : JSON.parse(readFileSync(argv[3], 'utf8'));
  const { chromium } = await import('../browser-playwright.mjs');
  const { KEYCHAIN_ARGS } = await import('../.kit/chromium-keychain.mjs');
  const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: PORTRAIT ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(HTML);
    await page.evaluate((on) => { window.setPortrait(on); }, PORTRAIT);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.ready); // a page that preloads images or data exposes a promise
    for (const c of cards) {
      const dir = preview ? OUT : `${OUT}/${c.id}`;
      mkdirSync(dir, { recursive: true });
      const times = cardTimes(c, preview);
      for (let i = 0; i < times.length; i++) {
        await page.evaluate(([card, t, o]) => window.pose(card, t, o), [c.card, times[i], c]);
        await page.screenshot({ path: preview ? `${dir}/${c.id}.png` : `${dir}/${String(i).padStart(5, '0')}.png`, omitBackground: true });
      }
      console.log(`[titles] ${c.id}: ${times.length} frames`);
    }
  } finally { await browser.close(); }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv);
