/**
 * meta IPHONE13-DRIFTWOOD DW12 (mini-dw12, 2026-11-21): the outer road deck's GPU upload, spread over frames.
 *
 * After control on Driftwood the WebKit peak (WebContent + GPU process) came from installing the outer road: its one
 * ~20 MB `grid-deck` mesh went up in a single frame, every vertex channel and the drawn index in one burst of `bufferData`
 * (mini-bugbash, 2026-11-21: 22 MB in that second, ~230 MB of transient footprint with the outer road knocked out).
 *
 * `stageRoadDeck` uploads the deck before it joins the scene, a band of channels a drawn frame, each band at most
 * `maxBytes` (a single channel larger than that goes alone). Each band rides a stand-in mesh that holds only that band's
 * attributes (the deck's own BufferAttribute objects) with the deck's material and a zero draw range: three uploads every
 * attribute of a geometry it projects (`WebGLGeometries.update`) and keys the GL buffer by the attribute object, and the
 * empty draw still points the program's named attributes at their buffers, so the vertex pack (vertexPack.ts) packs each
 * channel exactly as the deck's own first draw would have. When the deck draws, every buffer is already there: nothing is
 * uploaded again and the same bytes are drawn. The stand-in is emptied before it is disposed, so disposing it frees only
 * its vertex-array state, never the deck's buffers.
 *
 * The device slot `debug.roadDeckPaced` set to false keeps the single-frame upload.
 */
import { BufferGeometry, InterleavedBufferAttribute, Mesh, Sphere, type BufferAttribute, type Object3D } from 'three';
import { jsonSlot } from '@wildshard/engine/saves/slots';

/** The most a frame uploads of the deck (bytes as the CPU holds them; packed channels go up smaller). */
export const DECK_UPLOAD_BAND_BYTES: number = 8 * 1024 * 1024;

/** One frame's share of the deck: its channel names, whether the index goes too, and the bytes. */
export interface DeckBand { readonly names: readonly string[]; readonly index: boolean; readonly bytes: number }

const bytesOf = (attribute: BufferAttribute | InterleavedBufferAttribute): number =>
  attribute instanceof InterleavedBufferAttribute ? attribute.data.array.byteLength : attribute.array.byteLength;

/** The deck's channels (in geometry order, then the index) grouped into bands of at most `maxBytes`, greedily in order. */
export function deckUploadBands(geometry: BufferGeometry, maxBytes: number = DECK_UPLOAD_BAND_BYTES): DeckBand[] {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('Invalid deck upload band');
  const channels: { name: string | null; bytes: number }[] = Object.entries(geometry.attributes).map(([name, attribute]) => ({ name, bytes: bytesOf(attribute) }));
  const index = geometry.getIndex();
  if (index !== null) channels.push({ name: null, bytes: index.array.byteLength });
  const bands: DeckBand[] = [];
  let names: string[] = [], withIndex = false, bytes = 0;
  for (const channel of channels) {
    if (bytes > 0 && bytes + channel.bytes > maxBytes) { bands.push({ names, index: withIndex, bytes }); names = []; withIndex = false; bytes = 0; }
    if (channel.name === null) withIndex = true; else names.push(channel.name);
    bytes += channel.bytes;
  }
  if (names.length > 0 || withIndex) bands.push({ names, index: withIndex, bytes });
  return bands;
}

/** What the page's decks staged (the probe and tests read it). */
export interface RoadDeckUploadStats { decks: number; bands: number; frames: number; largestBand: number; totalBytes: number }
export const roadDeckUploadStats: RoadDeckUploadStats = { decks: 0, bands: 0, frames: 0, largestBand: 0, totalBytes: 0 };
if (typeof window !== 'undefined') Reflect.set(window, '__roadDeckUploadStats', roadDeckUploadStats);

/**
 * Upload `deck`'s channels a band a frame through a stand-in in `scene`, before the deck itself is added. `frame` resolves
 * after a drawn frame (it throws to cancel). A deck that fits one band is left to its own first draw. Returns the bands.
 */
export async function stageRoadDeck(deck: Mesh, scene: Object3D, frame: () => Promise<void>, maxBytes: number = DECK_UPLOAD_BAND_BYTES): Promise<readonly DeckBand[]> {
  if (Array.isArray(deck.material)) return [];
  const source = deck.geometry, bands = deckUploadBands(source, maxBytes);
  if (bands.length <= 1) return bands;
  const holder = new BufferGeometry();
  holder.setDrawRange(0, 0);
  // three sorts by the bounding sphere and would compute one from the (already released) positions
  holder.boundingSphere = source.boundingSphere?.clone() ?? new Sphere();
  holder.boundingBox = source.boundingBox?.clone() ?? null;
  const stager = new Mesh(holder, deck.material);
  stager.name = 'grid-deck-upload'; stager.frustumCulled = false; stager.castShadow = false; stager.receiveShadow = deck.receiveShadow;
  stager.renderOrder = deck.renderOrder; stager.matrixAutoUpdate = false; stager.matrix.copy(deck.matrix); stager.matrixWorld.copy(deck.matrix);
  const empty = (): void => { for (const name of Object.keys(holder.attributes)) holder.deleteAttribute(name); holder.setIndex(null); };
  roadDeckUploadStats.decks++;
  try {
    for (const band of bands) {
      empty();
      for (const name of band.names) holder.setAttribute(name, source.getAttribute(name));
      if (band.index) holder.setIndex(source.getIndex());
      scene.add(stager);
      try { await frame(); } finally { stager.removeFromParent(); }
      roadDeckUploadStats.frames++; roadDeckUploadStats.bands++;
      roadDeckUploadStats.largestBand = Math.max(roadDeckUploadStats.largestBand, band.bytes); roadDeckUploadStats.totalBytes += band.bytes;
    }
  } finally { empty(); holder.dispose(); }
  return bands;
}

export const ROAD_DECK_PACED_SLOT = 'debug.roadDeckPaced';
/** Unset: on (DW12). */
export const ROAD_DECK_PACED_DEFAULT = true;
/** The slot's value: a boolean (or `false`/`off`/0 from a capture) wins; unset, ROAD_DECK_PACED_DEFAULT. */
export function roadDeckPaced(saved: unknown): boolean {
  if (saved === false || saved === 'false' || saved === 'off' || saved === 0) return false;
  if (saved === true) return true;
  return ROAD_DECK_PACED_DEFAULT;
}
let picked: boolean | undefined;
/** Whether the outer road deck's upload is paced; read once per page. */
export function roadDeckPacedOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null;
  try { saved = jsonSlot(ROAD_DECK_PACED_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  picked = roadDeckPaced(saved);
  return picked;
}
