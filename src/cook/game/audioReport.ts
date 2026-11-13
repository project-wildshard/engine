// AUDIO AU6 (J303, J295): the cook's audio report. One row per shard and tier from its cooked client manifest: the
// recordings DOWNLOAD fetches (the shard's own and the engine's shared files alike, AU1's list), their MB on the wire and
// their share of DOWNLOAD, judged against Jake's lines: green to 6 MB, amber over 6, red over 10 (J303). The report never
// fails a build or main: an overrun is an AMBER line that CI's budget reporter annotates and main-watch receipts (J295).

/** A recording a spawn manifest lists (AU1): engine music and sound effects and a shard's own audio mounts. */
const AUDIO_URL = /^\/assets\/(?:music|sfx)\/[^?]+\.(?:m4a|mp3|ogg|opus|wav|webm|flac)(?:\?|$)/u;
export const isAudioUrl = (url: string): boolean => AUDIO_URL.test(url);

/** J303 (Jake, 2026-11-12): "each shard can have 10 megabytes of audio. Red over 10. Green up to 6. Amber between 6 and 10". */
export const AUDIO_LINES: Readonly<{greenBytes: number; redBytes: number}> = Object.freeze({ greenBytes: 6_000_000, redBytes: 10_000_000 });

export type AudioLevel = 'green' | 'amber' | 'red';
export interface AudioReportRow {
  readonly shard: string; readonly tier: 'phone' | 'desktop';
  /** Recordings in the manifest, and their bytes on the wire. */
  readonly files: number; readonly audioBytes: number;
  /** The manifest's whole DOWNLOAD on the wire. */
  readonly downloadBytes: number;
  readonly level: AudioLevel;
}
/** What the report reads of a cooked client manifest. */
export interface AudioReportManifest {
  readonly shard: string; readonly tier: 'phone' | 'desktop';
  readonly files: readonly {readonly url: string; readonly bytes: number; readonly wireBytes?: number}[];
  readonly wireBytes?: number;
}

export const audioLevel = (bytes: number, lines: Readonly<{greenBytes: number; redBytes: number}> = AUDIO_LINES): AudioLevel =>
  bytes > lines.redBytes ? 'red' : bytes > lines.greenBytes ? 'amber' : 'green';

/** One row per manifest, sorted by shard then tier (phone first). Pure. */
export function audioReport(manifests: readonly AudioReportManifest[]): AudioReportRow[] {
  const wire = (row: {readonly bytes: number; readonly wireBytes?: number}): number => row.wireBytes ?? row.bytes;
  return manifests.map(manifest => {
    const audio = manifest.files.filter(row => isAudioUrl(row.url)), audioBytes = audio.reduce((sum, row) => sum + wire(row), 0);
    const downloadBytes = manifest.wireBytes ?? manifest.files.reduce((sum, row) => sum + wire(row), 0);
    return {shard: manifest.shard, tier: manifest.tier, files: audio.length, audioBytes, downloadBytes, level: audioLevel(audioBytes)};
  }).sort((a, b) => (a.shard < b.shard ? -1 : a.shard > b.shard ? 1 : 0) || (a.tier === b.tier ? 0 : a.tier === 'phone' ? -1 : 1));
}

const mb = (bytes: number): string => (bytes / 1e6).toFixed(2);

/** The cook's table, one line per row, with the lines it is judged by. */
export function audioReportTable(rows: readonly AudioReportRow[]): string {
  const head = `cook audio (AU6, J303: green to ${mb(AUDIO_LINES.greenBytes)} MB, amber over it, red over ${mb(AUDIO_LINES.redBytes)} MB; an overrun is AMBER, never a red build or main)`;
  const width = Math.max(5, ...rows.map(row => row.shard.length));
  const line = (cells: readonly string[]): string => [cells[0]?.padEnd(width), cells[1]?.padEnd(7), ...cells.slice(2, 6).map(cell => cell.padStart(11)), `  ${cells[6] ?? ''}`].join(' ');
  return [head, line(['shard', 'tier', 'files', 'audio MB', 'DOWNLOAD MB', 'share', 'line']),
    ...rows.map(row => line([row.shard, row.tier, String(row.files), mb(row.audioBytes), mb(row.downloadBytes),
      `${row.downloadBytes === 0 ? '0' : (100 * row.audioBytes / row.downloadBytes).toFixed(0)}%`, row.level === 'green' ? 'green' : row.level.toUpperCase()]))].join('\n');
}

/** The machine line for a row over the green line, which CI annotates and main-watch reads (`parseAudioAmber` in
 *  scripts/test-amber.mjs). A row over the red line is still AMBER here (J295): `level=red` only says how far. */
export const audioAmberLine = (row: AudioReportRow): string =>
  `AMBER audio shard=${row.shard} tier=${row.tier} bytes=${row.audioBytes} budget=${AUDIO_LINES.greenBytes} red=${AUDIO_LINES.redBytes} level=${row.level}`;
