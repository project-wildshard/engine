import type { GrappleRows } from '@wildshard/format/grapple';

type LabelRows = Pick<GrappleRows['aim'], 'mark' | 'chip'>;
type FontContext = Pick<CanvasRenderingContext2D, 'font' | 'letterSpacing' | 'measureText'>;

function nativeContext(): FontContext {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Grapple label preparation needs a native text context');
  return context;
}

/** Resolve declared label glyphs during installation, before their first visible
 * layout. Metrics are discarded: native DOM fonts, labels and placement stay owned
 * by the existing pins. Inherited fonts keep their ordinary browser preparation. */
export function prepareGrappleFonts(row: LabelRows, create: () => FontContext = nativeContext): void {
  const labels = [
    { style: row.mark.style, text: [row.mark.glyph] },
    { style: row.chip.style, text: [row.chip.candidate, row.chip.lockedTouch, row.chip.lockedDesk] },
  ];
  let context: FontContext | undefined;
  for (const label of labels) {
    const font = label.style['font'];
    if (font === undefined) continue;
    context ??= create();
    context.font = font;
    context.letterSpacing = label.style['letterSpacing'] ?? '0px';
    for (const text of label.text) context.measureText(text);
  }
}
