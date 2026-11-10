// oxlint-disable-next-line import/no-nodejs-modules -- Builds each channel's output from the real committed files in repository scratch.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the scratch output.
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { HOME_ICON_CHANNELS, HOME_ICON_FILES, homeIconChannel, homeIconManifestRows, writeHomeIcons } from '../scripts/app-build/homeIcons.mjs';

interface Png { readonly width: number; readonly height: number; readonly colorType: number; readonly transparent: boolean }
/** The PNG header as a browser reads it: IHDR's size and colour type, and whether a tRNS chunk adds transparency. */
function png(file: string): Png {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] ?? -1, transparent: bytes.includes(Buffer.from('tRNS', 'latin1')) };
}

/** A copy of what the bundler leaves before build-app's stamp: the committed document, manifest and every channel's icons. */
function builtOutput(channel: string): string {
  mkdirSync('tmp', { recursive: true });
  const out = mkdtempSync(resolve('tmp/home-icons-'));
  cpSync('index.html', join(out, 'index.html'));
  cpSync('public/manifest.webmanifest', join(out, 'manifest.webmanifest'));
  cpSync('public/icons', join(out, 'icons'), { recursive: true });
  writeHomeIcons(out, channel);
  return out;
}

const linkHref = (html: string, rel: string): string | undefined => new RegExp(`<link rel="${rel}"[^>]*href="([^"]+)"`, 'u').exec(html)?.[1];

test('a world picks its channel: production release is production, any other world staging, none preview', () => {
  expect(homeIconChannel(undefined)).toBe('preview');
  expect(homeIconChannel({ release: 'https://wildshard-packs.wildshard.workers.dev/releases/production.json' })).toBe('production');
  expect(homeIconChannel({ release: 'https://wildshard-packs.wildshard.workers.dev/releases/staging.json' })).toBe('staging');
  expect(homeIconChannel({ release: 'http://127.0.0.1:18791/__release.json' })).toBe('staging');
  expect(homeIconChannel({ release: 'https://example.test/releases/production.json.bak' })).toBe('staging');
});

test('the committed manifest names the preview set the committed document links', () => {
  expect((JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { icons: unknown }).icons).toEqual(homeIconManifestRows('preview'));
  const html = readFileSync('index.html', 'utf8');
  expect(linkHref(html, 'apple-touch-icon')).toBe('/icons/preview/apple-touch-icon.png');
  expect(linkHref(html, 'icon')).toBe('/icons/preview/favicon-64.png');
});

test.each(HOME_ICON_CHANNELS)('the %s build links, declares and ships only its own icons, each at its declared size', async channel => {
  const out = builtOutput(channel);
  try {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8')) as { icons: { src: string; sizes: string; purpose: string }[] };
    // The document's touch icon and favicon, and every manifest row, point into this channel's folder.
    expect(linkHref(html, 'apple-touch-icon')).toBe(`/icons/${channel}/apple-touch-icon.png`);
    expect(linkHref(html, 'icon')).toBe(`/icons/${channel}/favicon-64.png`);
    for (const other of HOME_ICON_CHANNELS.filter(name => name !== channel)) expect(html).not.toContain(`/icons/${other}/`);
    expect(manifest.icons.map(row => row.src).every(src => src.startsWith(`/icons/${channel}/`))).toBe(true);
    expect(manifest.icons.filter(row => row.purpose === 'maskable').map(row => row.sizes)).toEqual(['192x192', '512x512']);
    expect(manifest.icons.filter(row => row.purpose === 'any').map(row => row.sizes)).toEqual(['192x192', '512x512']);
    // Every declared file exists at its declared size, opaque (iOS blackens a touch icon's transparency).
    const declared = [...manifest.icons.map(row => ({ src: row.src, size: row.sizes })),
      { src: `/icons/${channel}/apple-touch-icon.png`, size: '180x180' }, { src: `/icons/${channel}/favicon-64.png`, size: '64x64' }];
    for (const row of declared) {
      const file = join(out, row.src);
      expect(existsSync(file), row.src).toBe(true);
      const header = png(file);
      expect(`${header.width}x${header.height}`, row.src).toBe(row.size);
      expect([2, 3], row.src).toContain(header.colorType);
      expect(header.transparent, row.src).toBe(false);
    }
    // Only this channel's files ship.
    expect(readdirSync(join(out, 'icons'))).toEqual([channel]);
    expect(readdirSync(join(out, 'icons', channel)).sort()).toEqual(HOME_ICON_FILES.map(row => row.name).sort());
  } finally { rmSync(out, { recursive: true, force: true }); }
});

/** A point on the coin's face left of the letter in the touch icon (badges.mjs centres the coin at 808 of 1024, face r 140). */
async function badgePixel(channel: string): Promise<[number, number, number]> {
  const left = Math.round(180 * (808 - 105) / 1024), top = Math.round(180 * 808 / 1024);
  const { data } = await sharp(`public/icons/${channel}/apple-touch-icon.png`).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

test('staging wears the amber S, preview the violet P, production neither', async () => {
  const [sr, sg, sb] = await badgePixel('staging'), [pr, pg, pb] = await badgePixel('preview'), [dr, dg] = await badgePixel('production');
  expect(sr > 200 && sg > 120 && sb < 120).toBe(true);
  expect(pb > 200 && pr > 120 && pg < pr).toBe(true);
  expect(dr < 100 && dg < 100).toBe(true);
});
