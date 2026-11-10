// J236: every home-screen icon file from the 1024 px tilt masters, with sharp.
//   node scripts/home-icons.mjs <masters dir>
// The masters dir holds tilt-{prod,staging,preview}.png (the full-bleed art iOS masks) and
// maskable-{prod,staging,preview}.png (the nine cells and the badge inside Android's 80 % safe circle). Writes
// public/icons/<channel>/ for each channel; the build then keeps only its own (scripts/app-build/homeIcons.mjs).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { HOME_ICON_CHANNELS, HOME_ICON_FILES } from './app-build/homeIcons.mjs';

const masters = process.argv[2];
if (masters === undefined) throw new Error('usage: node scripts/home-icons.mjs <masters dir>');
const MASTER = { production: 'prod', staging: 'staging', preview: 'preview' };
for (const channel of HOME_ICON_CHANNELS) {
  const out = resolve('public/icons', channel);
  mkdirSync(out, { recursive: true });
  for (const row of HOME_ICON_FILES) {
    const source = join(resolve(masters), `${row.master === 'any' ? 'tilt' : 'maskable'}-${MASTER[channel]}.png`);
    const { width, height } = await sharp(source).metadata();
    if (width !== 1024 || height !== 1024) throw new Error(`${source} is ${width}x${height}, not a 1024 px master`);
    // Opaque everywhere: iOS paints a touch icon's transparent pixels black, and a maskable icon must fill its square.
    // A dithered 256-colour palette is 39 dB from truecolour at a third of the bytes (290 KB a channel, not 930 KB).
    await sharp(source).resize(row.size, row.size, { kernel: 'lanczos3' }).flatten({ background: '#060c16' }).removeAlpha()
      .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10, dither: 1 }).toFile(join(out, row.name));
    console.log(`icons/${channel}/${row.name} ${row.size}px`);
  }
}
