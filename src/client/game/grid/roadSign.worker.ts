import type { SignLine } from '../../../shared/game/grid/roadLayout';
import { paintRoadSignCanvas, roadSignPaintLayout } from './roadSignPaint';
import { packRoadSignPixels } from './roadSignPixels';

function signLines(value: unknown): value is readonly SignLine[] {
  return Array.isArray(value) && value.length <= 2048 && value.every((row: unknown) => {
    if (typeof row !== 'object' || row === null) return false;
    const arrow: unknown = Reflect.get(row, 'arrow'), names: unknown = Reflect.get(row, 'names'), metres: unknown = Reflect.get(row, 'metres');
    return (arrow === 'left' || arrow === 'right' || arrow === 'ahead') && Array.isArray(names) && names.every((name: unknown) => typeof name === 'string')
      && (metres === null || typeof metres === 'number' && Number.isFinite(metres));
  });
}
self.onmessage = (event: MessageEvent<unknown>): void => {
  try {
    const input = event.data;
    if (typeof input !== 'object' || input === null) throw new Error('Invalid sign job');
    const rows: unknown = Reflect.get(input, 'rows'), red: unknown = Reflect.get(input, 'red'), green: unknown = Reflect.get(input, 'green');
    if (!signLines(rows) || !(red instanceof Uint8Array) || !(green instanceof Uint8Array) || red.length !== 256 || green.length !== 256) throw new Error('Invalid sign planes');
    const layout = roadSignPaintLayout(rows.map(line => ({ lines: [line] })));
    if (layout.width * layout.height > 16 * 1024 * 1024) throw new Error('Worker sign plane too large');
    const context = new OffscreenCanvas(layout.width, layout.height).getContext('2d');
    if (context === null) throw new Error('Worker sign has no 2D canvas');
    paintRoadSignCanvas(context, layout);
    const pixels = packRoadSignPixels(context.getImageData(0, 0, layout.width, layout.height).data, layout.width, layout.height, red, green);
    self.postMessage({ width: layout.width, height: layout.height, pixels }, { transfer: [pixels.buffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }, { transfer: [] }); }
};
