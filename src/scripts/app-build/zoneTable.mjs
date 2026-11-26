// Fix preview PV2: a build given a zone table (`WS_ZONE_TABLE`, written by src/scripts/page-release/zone-table.mjs from staging's signed
// release) bakes it as `zone-table.json` and inlines it in `index.html` beside the catalogue, before the service worker hashes the
// document, so F5 and an offline reload read the same zones with no fetch. A build with none bakes nothing.
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {readZoneTable, ZONE_TABLE_ELEMENT_ID, ZONE_TABLE_FILE} from '../../shared/game/grid/zoneTable.ts';

/** @typedef {import('../../shared/game/grid/zoneTable.ts').ZoneTable} ZoneTable */
const ELEMENT = new RegExp(`<script type="application/json" id="${ZONE_TABLE_ELEMENT_ID}">[^<]*</script>`, 'u');
const inline = (/** @type {string} */ text) => `<script type="application/json" id="${ZONE_TABLE_ELEMENT_ID}">${text.replaceAll('<', String.raw`<`)}</script>`;

/** @param {string} outDir @param {ZoneTable} table */
export function writeZoneTable(outDir, table) {
  const text = JSON.stringify(readZoneTable(table));
  writeFileSync(join(outDir, ZONE_TABLE_FILE), text);
  const file = join(outDir, 'index.html'), html = readFileSync(file, 'utf8');
  if (!html.includes('</head>')) throw new Error('No document head for the zone table');
  writeFileSync(file, ELEMENT.test(html) ? html.replace(ELEMENT, () => inline(text)) : html.replace('</head>', () => `${inline(text)}</head>`));
}

/** The zone table a built document carries, or undefined for none. @param {string} html @returns {ZoneTable | undefined} */
export function zoneTableIn(html) {
  const text = new RegExp(`<script type="application/json" id="${ZONE_TABLE_ELEMENT_ID}">([^<]*)</script>`, 'u').exec(html)?.[1];
  return text === undefined ? undefined : readZoneTable(JSON.parse(text.replaceAll(String.raw`<`, '<')));
}

/** The pipeline's step: bake `file` when the deploy named one. @param {string} outDir @param {string | undefined} file */
export function bakeZoneTable(outDir, file) {
  if (file === undefined || file === '') return;
  const table = readZoneTable(JSON.parse(readFileSync(file, 'utf8')));
  writeZoneTable(outDir, table);
  console.log(`[zone table] ${table.zones.length} zones from ${table.from.channel} serial ${table.from.serial}, cook ${table.cookVersion}`);
}
