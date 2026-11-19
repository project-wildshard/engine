import { isDev } from '@wildshard/engine/core/devMode';
import type { WorldScenePlacementPage, WorldScenePlacementRow } from '@wildshard/format/worldScenePlacement';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { parseWorldScenes, type ParsedWorldScenes } from '@wildshard/format/worldScenes';
import { parseWorldSceneModels, type WorldSceneModels } from '@wildshard/format/worldSceneModels';
import { parseClientPlan, type ClientPlan } from '@wildshard/format/clientPlan';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';

const decoder = new TextDecoder('utf-8', { fatal: true });
export const placementPageContract = '@wildshard/format/worldScenePlacement#WorldScenePlacementPageSchema';
export const placementContract = '@wildshard/format/worldScenePlacement#WorldScenePlacementSchema';

interface CookedDocumentContracts {
  [placementPageContract]: WorldScenePlacementPage;
  [placementContract]: WorldScenePlacementRow;
  '@wildshard/format/postGraphLook#PostGraphLookSchema': unknown;
  '@wildshard/format/heldJianDocument#HeldJianDocumentSchema': unknown;
}

function hasCookedDocuments(source: Shardfile): boolean {
  return outputDescriptor(source)?.verifiedIndex === true && !isDev();
}

/** Only this product's hashed scene section has the publisher's typed defaults. */
export function readSceneSection(source: Shardfile, value: unknown): ParsedWorldScenes {
  const cooked = outputDescriptor(source)?.cookedScenes;
  return cooked !== undefined && cooked === value && !isDev() ? cooked : parseWorldScenes(value);
}

export function readClientPlan(source: unknown, value: unknown): ClientPlan {
  const cooked = outputDescriptor(source)?.cookedPlan;
  return cooked !== undefined && cooked === value && !isDev() ? cooked : parseClientPlan(value);
}

export async function readSceneCatalogue(source: Shardfile, name: string, bytes: Uint8Array): Promise<WorldSceneModels> {
  const cooked = outputDescriptor(source)?.cookedCatalogue === name
    && await verifiedCookedDocument(source, name, '@wildshard/format/worldSceneModels#WorldSceneModelsSchema', bytes);
  const value: unknown = JSON.parse(decoder.decode(bytes));
  return cooked ? value as WorldSceneModels : parseWorldSceneModels(value);
}

/**
 * A reader may reuse its cook's schema verdict for an exact, registered wire
 * contract whose parser preserves the JSON value. Callers keep contextual
 * checks such as placement id and tier. Developer and author reads keep the
 * defining parser. A bound product refuses a crossed contract or blob.
 */
export async function verifiedCookedDocument(source: Shardfile, name: string, schema: string, bytes: Uint8Array): Promise<boolean> {
  const descriptor = outputDescriptor(source);
  if (descriptor?.verifiedIndex !== true || isDev()) return false;
  const file = descriptor.index.files.find(row => row.name === name);
  if (file?.kind !== 'json' || file.jsonSchema?.['$comment'] !== schema) throw new Error(`Cooked document contract differs: ${name}`);
  if (file.compressed !== bytes.byteLength || await contentHash(bytes) !== file.hash) throw new Error(`Cooked document hash or size differs: ${name}`);
  return true;
}

/** Read a cooked document when the product owns a matching publication proof. */
export async function readCookedDocument<K extends keyof CookedDocumentContracts>(source: Shardfile, name: string, schema: K, read: (name: string) => Promise<Uint8Array>): Promise<{ value: CookedDocumentContracts[K] } | undefined> {
  if (!hasCookedDocuments(source)) return undefined;
  const bytes = await read(name);
  if (!await verifiedCookedDocument(source, name, schema, bytes)) return undefined;
  return { value: JSON.parse(decoder.decode(bytes)) as CookedDocumentContracts[K] };
}
