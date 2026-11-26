// G508: renderer-free map painting. Coordinates and coverage come from the
// actual admitted triangles, never map-only silhouettes or collider proxies.
import { readFileSync } from 'node:fs';

const byte = value => Math.max(0, Math.min(255, Math.round(value)));
const hex = colour => [1, 3, 5].map(at => Number.parseInt(colour.slice(at, at + 2), 16));

/** The retained file adapter owns disk access; the canonical raster receives only explicit bytes. */
export function readMapGeometry(file) { return new Uint8Array(readFileSync(file)); }

/** Palette matching, relief and ink use integer arithmetic. No image model,
 * SIMD filtering, stochastic texture or platform-dependent lighting is involved.
 * Ground coverage is never eroded, dilated or smoothed away. */
export function stylizeMap(raster, style) {
  const { size, height, colour } = raster, out = Buffer.alloc(size * size * 4);
  const colours = new Map(), palettes = new WeakMap();
  const decodeColour = value => {
    let rgb = colours.get(value);
    if (rgb === undefined) { rgb = hex(value); colours.set(value, rgb); }
    return rgb;
  };
  const nearest = (rgb, rows) => {
    let palette = palettes.get(rows);
    if (palette === undefined) { palette = rows.map(row => ({ row, match: decodeColour(row.match) })); palettes.set(rows, palette); }
    let best = rows[0], distance = Infinity;
    for (const candidate of palette) {
      const current = candidate.match.reduce((sum, c, k) => sum + (c - rgb[k]) ** 2, 0);
      if (current < distance) { best = candidate.row; distance = current; }
    }
    return best;
  };
  const valid = at => at >= 0 && at < height.length && height[at] !== -2147483648;
  const sourceColour = at => Array.from(colour.subarray(at * 3, at * 3 + 3), c => byte(c * (style.sourceGain ?? 1)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = y * size + x, h = height[at] / 65536, rgb = sourceColour(at);
    const neighbours = [x > 0 ? at - 1 : -1, x + 1 < size ? at + 1 : -1, y > 0 ? at - size : -1, y + 1 < size ? at + size : -1];
    const border = neighbours.some(other => !valid(other));
    const clear = style.void === 'transparent';
    if (!valid(at)) {
      if (!clear) { const bg = decodeColour(style.void ?? style.sea ?? style.classes?.[0]?.fill ?? '#282e33'); for (let k = 0; k < 3; k++) out[at * 4 + k] = bg[k]; out[at * 4 + 3] = 255; }
      continue;
    }
    let fill;
    if (style.kind === 'void') {
      const band = style.stoneBands.filter(b => h >= b).length;
      fill = decodeColour(rgb[1] > rgb[0] && rgb[1] > rgb[2] * 1.15 ? style.grass : style.stone[band]);
      if (border) fill = decodeColour(style.rim);
    } else if (style.kind === 'isle') {
      fill = decodeColour(h < style.deepBelow ? style.sea : h < style.waterBelow ? style.shallow : style.grass[style.grassBands.filter(b => h >= b).length]);
      // Keep the island's authored sand, paths, timber and crowns readable from
      // source vertex colours. Classification never changes occupied coverage.
      if (style.sand !== undefined && h >= style.waterBelow) {
        const [r, g, b] = rgb.map(value => value / 255), saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b, .001);
        const green = g > r * 1.05 && g > b * 1.1, sand = r > .55 && g > .45 && b < g * .85 && !green;
        const wood = r > g * 1.12 && r > .25 && r < .75 && saturation > .3 && !green;
        const heights = neighbours.filter(valid).map(other => height[other] / 65536), slope = Math.max(0, ...heights.map(value => Math.abs(h - value))) * size / 500;
        let low = h;
        for (const dz of [-7, 0, 7]) for (const dx of [-7, 0, 7]) {
          const px = x + dx, py = y + dz, other = py * size + px;
          if (px >= 0 && px < size && py >= 0 && py < size && valid(other)) low = Math.min(low, height[other] / 65536);
        }
        const raised = h - low;
        if (sand) fill = decodeColour(h > style.pathAbove ? style.path : style.sand);
        else if (!green && (saturation < .28 || slope > 1.4)) fill = decodeColour(style.rock);
        if (green && raised > 1.5) fill = decodeColour(style.crown);
        if (wood || !green && low < -.5 && raised > .4) fill = decodeColour(style.deck);
      }
    } else {
      const row = nearest(rgb, style.classes); fill = decodeColour(row.fill);
      if (style.water !== undefined && h < style.water.below) {
        const w = style.water.within, wx = 250 - (x + 0.5) * 500 / size, wz = 250 - (y + 0.5) * 500 / size;
        if (w === undefined || wx >= w.x0 && wx <= w.x1 && wz >= w.z0 && wz <= w.z1) fill = decodeColour(style.water.fill);
      }
      if (border && style.rim !== undefined) fill = decodeColour(style.rim);
      else if (row.edge !== undefined && neighbours.some(other => valid(other) && nearest(sourceColour(other), style.classes) !== row)) fill = decodeColour(row.edge);
      if (style.raised !== undefined) {
        const around = [];
        for (const dz of [-7, 0, 7]) for (const dx of [-7, 0, 7]) {
          const px = x + dx, py = y + dz, other = py * size + px;
          if (px >= 0 && px < size && py >= 0 && py < size && valid(other)) around.push(height[other]);
        }
        around.sort((a, b) => a - b);
        const ground = around[Math.floor(around.length / 2)] ?? height[at];
        if (height[at] - ground > style.raised.bump * 65536) {
          const raised = nearest(rgb, style.raised.classes);
          fill = decodeColour(neighbours.some(other => valid(other) && height[at] - height[other] > style.raised.bump * 32768) ? raised.edge : raised.fill);
        }
      }
    }
    const left = valid(at - 1) && x > 0 ? height[at - 1] : height[at], top = valid(at - size) ? height[at - size] : height[at];
    const relief = Math.max(-80, Math.min(80, Math.trunc((left + top - height[at] * 2) / 512)));
    const shade = 256 + Math.trunc(relief * (style.shade ?? 0.5));
    for (let k = 0; k < 3; k++) out[at * 4 + k] = byte(Math.trunc(fill[k] * shade / 256));
    out[at * 4 + 3] = 255;
  }
  return out;
}
