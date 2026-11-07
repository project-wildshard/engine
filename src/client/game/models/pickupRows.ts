import * as v from 'valibot';
import { PickupCatalogueSchema, assertSpecimenJson as jsonData } from '@wildshard/format/specimenCatalogue';

export function readPickupCatalogue(input:unknown):v.InferOutput<typeof PickupCatalogueSchema> {
  jsonData(input);
  const rows = v.parse(PickupCatalogueSchema, input);
  const keys = rows.geometries.map(row => `${row.key}:${row.seed}`);
  if (new Set(keys).size !== keys.length || new Set(rows.looks.map(row => row.id)).size !== rows.looks.length
    || new Set(rows.looks.map(row => row.model)).size !== rows.looks.length) throw new Error('Duplicate pickup declaration');
  if (rows.looks.some(row => row.parts.some(part => !keys.includes(`${part.key}:${rows.seed}`)))) throw new Error('Missing pickup specimen geometry');
  return rows;
}
