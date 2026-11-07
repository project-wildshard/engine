// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the plain publisher in an owned isolated root.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep fixtures beneath repository tmp.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { BOOT_PUBLICATION, bootPublicationTableSources, parseBootPublication, publishBootPublication, readBootPublication } from '../scripts/boot-publication.mjs';
import { verifiedBootPublicationTables } from '../scripts/boot-publication-proof.mjs';

const facts = (offset = 0, length = 3, total = 3) => ({
  schema: 'boot-publication/1', bytes: { '/assets/raw.bin': 3 }, versions: { '/assets/raw.bin': '1234abcd' },
  packs: { demo: { phone: { parts: [{ url: '/assets/packs/demo.phone-00000000.bin', bytes: total,
    files: [['/assets/raw.bin', offset, length, 'application/octet-stream']],
  }] } } },
});

function fixture(): { root: string; close: () => void } {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'boot-publication-'));
  mkdirSync(resolve(root, 'scripts'));
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('plain transport tables require only the complete published facts', () => {
  const f = fixture();
  try {
    publishBootPublication(f.root, facts());
    const tables = bootPublicationTableSources(f.root);
    expect(Object.keys(tables)).toEqual(['src/client/game/boot/bytes.generated.ts', 'src/client/game/boot/versions.generated.ts', 'src/client/game/boot/packs.generated.ts']);
    expect(tables['src/client/game/boot/bytes.generated.ts']).toContain('"/assets/raw.bin": 3,');
    expect(tables['src/client/game/boot/versions.generated.ts']).toContain('"/assets/raw.bin": \'1234abcd\',');
    expect(tables['src/client/game/boot/packs.generated.ts']).toContain('["/assets/raw.bin",0,3,"application/octet-stream"]');
    expect(tables['src/client/game/boot/packs.generated.ts']).toContain('/assets/packs/demo.phone-00000000.bin');
    // No outputs, assets, products, discovery modules or tools exist in this root.
    expect(readdirSync(f.root)).toEqual(['scripts']);
    expect(readBootPublication(f.root)).toEqual(parseBootPublication(facts()));
  } finally { f.close(); }
});

test('malformed publication cannot replace the last complete record', () => {
  const f = fixture();
  try {
    const file = resolve(f.root, BOOT_PUBLICATION);
    publishBootPublication(f.root, facts());
    const before = readFileSync(file), inode = statSync(file).ino;
    publishBootPublication(f.root, facts());
    expect(statSync(file).ino).toBe(inode);
    const invalid: unknown[] = [facts(1), facts(0, 4), facts(0, 3, 4), { ...facts(), versions: {} },
      { ...facts(), versions: { '/assets/absent.bin': '1234abcd' } },
      { ...facts(), bytes: { '/assets/../crossed.bin': 3 } },
      { ...facts(), schema: 'other' },
    ];
    for (const value of invalid) {
      expect(() => publishBootPublication(f.root, value)).toThrow();
      expect(readFileSync(file)).toEqual(before); expect(statSync(file).ino).toBe(inode);
    }
    expect(readdirSync(resolve(f.root, 'scripts'))).toEqual(['boot-publication.generated.json']);
    writeFileSync(file, '{}');
    expect(() => bootPublicationTableSources(f.root)).toThrow();
  } finally { f.close(); }
});

test('live publication tables require complete current assets and exact packed payloads', () => {
  const f = fixture();
  const original = { ...facts(), versions: { '/assets/raw.bin': 'ba7816bf' },
    packs: { demo: { phone: { parts: [{ url: '/assets/packs/demo.phone-ba7816bf.bin', bytes: 3,
      files: [['/assets/raw.bin', 0, 3, 'application/octet-stream']],
    }] } } } };
  const raw = resolve(f.root, 'public/assets/raw.bin'), pack = resolve(f.root, 'public/assets/packs/demo.phone-ba7816bf.bin');
  try {
    mkdirSync(resolve(f.root, 'public/assets/packs'), { recursive: true });
    writeFileSync(raw, 'abc'); writeFileSync(pack, 'abc'); publishBootPublication(f.root, original);
    expect(verifiedBootPublicationTables(f.root)).toEqual(bootPublicationTableSources(f.root));
    writeFileSync(raw, 'def');
    expect(() => verifiedBootPublicationTables(f.root)).toThrow('content version differs');
    writeFileSync(raw, 'abc'); writeFileSync(pack, 'abd');
    expect(() => verifiedBootPublicationTables(f.root)).toThrow('pack identity differs');
    writeFileSync(pack, 'abc');
    const otherPack = resolve(f.root, 'public/assets/packs/demo.phone-cb8379ac.bin');
    rmSync(pack); writeFileSync(otherPack, 'def');
    publishBootPublication(f.root, { ...original, packs: { demo: { phone: { parts: [{
      url: '/assets/packs/demo.phone-cb8379ac.bin', bytes: 3,
      files: [['/assets/raw.bin', 0, 3, 'application/octet-stream']],
    }] } } } });
    expect(() => verifiedBootPublicationTables(f.root)).toThrow('packed payload differs');
    rmSync(otherPack); writeFileSync(pack, 'abc'); publishBootPublication(f.root, original);
    const extra = resolve(f.root, 'public/assets/extra.bin'); writeFileSync(extra, 'abc');
    expect(() => verifiedBootPublicationTables(f.root)).toThrow('asset inventory differs');
    rmSync(extra);
    publishBootPublication(f.root, { ...original, packs: {} });
    expect(() => verifiedBootPublicationTables(f.root)).toThrow('pack inventory differs');
    publishBootPublication(f.root, original); rmSync(pack);
    expect(() => verifiedBootPublicationTables(f.root)).toThrow('pack inventory differs');
  } finally { f.close(); }
});
