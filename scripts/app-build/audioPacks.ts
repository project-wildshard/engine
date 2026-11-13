import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readOutputDownloadIndex } from '@wildshard/format/outputDownload';
import { parseAudioData } from '@wildshard/format/audio';
import { createCatalogueAudio } from '../../src/client/engine/audio/levelAudio';
import { MUSIC_STYLES } from '@wildshard/engine/audio/bootAudio';

/** One built product's audio declaration, read from `out/` with its section hash checked. */
function productAudioData(root: string, slug: string): ReturnType<typeof parseAudioData> | undefined {
  const directory = resolve(root, 'out', slug), path = resolve(directory, 'shard.json');
  if (!existsSync(path)) return undefined;
  const index = readOutputDownloadIndex(JSON.parse(readFileSync(path, 'utf8')));
  const row = index.sections.find(section => section.name === 'audio/audio');
  if (row === undefined) return undefined;
  const bytes = readFileSync(resolve(directory, row.path));
  if (bytes.length !== row.bytes || createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error('Audio section differs from its product');
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (typeof value !== 'object' || value === null || !('audio' in value)) throw new Error('Missing product audio declaration');
  return parseAudioData(value.audio);
}

/** A catalogue shard's full audio inventory for Node tools: `boot.audio()` loads the
 * product from the page's origin. Same music-then-SFX order. */
export async function productAudioInventory(root: string, slug: string): Promise<readonly string[]> {
  const data = productAudioData(root, slug);
  if (data === undefined) throw new Error(`${slug}: no built product audio in out/ (run the build)`);
  const files = (await createCatalogueAudio(data)).files();
  return [...files.music, ...files.sfx];
}

/** The same declared after-control files as the native catalogue, without decoding
 * or fetching a recording. Control clips never join these transport parts. */
export async function lateAudioGroups(root: string, slug: string): Promise<Readonly<Record<string, readonly string[]>>> {
  const data = productAudioData(root, slug);
  if (data?.music === undefined || data.samples?.catalogue === undefined && data.music.setCatalogue === undefined) return {};
  const profile = await createCatalogueAudio(data);
  const groups: Record<string, readonly string[]> = {};
  for (const style of MUSIC_STYLES) {
    const boot = profile.bootFiles(style), control = new Set(profile.controlFiles?.(style) ?? boot);
    const files = [...new Set(boot)].filter(file => !control.has(file));
    if (files.length > 0) groups[`${slug}-audio-${style}`] = files;
  }
  return groups;
}
