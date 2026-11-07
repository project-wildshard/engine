import { seamTriangleErrorEvaluator, type SeamFloorField } from './seamError';
/** Interior tolerance leaves rounding headroom under G90's 2 cm and CIE76 delta-E3 bounds. */
const HEIGHT_ERROR = 0.019, COLOUR_ERROR = 2.9, CONTACT_SPAN = 64;
const xyz = [[0.4124564 / 0.95047, 0.3575761 / 0.95047, 0.1804375 / 0.95047],
  [0.2126729, 0.7151522, 0.0721750], [0.0193339 / 1.08883, 0.1191920 / 1.08883, 0.9503041 / 1.08883]] as const;
const labSlope = (minimum: number): number => minimum <= (6 / 29) ** 3 ? 1 / (3 * (6 / 29) ** 2) : 1 / (3 * minimum ** (2 / 3));
type Field = SeamFloorField;

// Both triangulations interpolate the same native vertices. Compare each with
// the rectangle's bilinear field: residuals cost at most 2r, and the mixed term
// costs |d|/4 per full-width triangle (the covariance bound on a unit rectangle).
// The old triangles span just one native row, tightening their mixed-term bound.
function fits(field: Field, start: number, end: number, firstColumn: number, lastColumn: number): boolean {
  if (end === start + 1) return true; // Identical original triangles, with zero approximation.
  const from = Math.fround(field.along[start] ?? 0), to = Math.fround(field.along[end] ?? 0), span = to - from;
  let denseSpan = 0;
  for (let row = start; row < end; row++) denseSpan = Math.max(denseSpan, Math.fround(field.along[row + 1] ?? 0) - Math.fround(field.along[row] ?? 0));
  const mixedFactor = (1 + denseSpan / span) / 4;
  const at = (row: number, column: number): number => (row * field.columns + column) * 3;
  const height = (row: number, column: number): number => Math.fround(field.positions[at(row, column) + 1] ?? 0);
  const colour = (row: number, column: number, channel: number): number => Math.fround(field.colours[at(row, column) + channel] ?? 0);
  for (let column = firstColumn + 1; column <= lastColumn; column++) {
    const bounds: number[] = [], minima = [Infinity, Infinity, Infinity];
    for (let channel = -1; channel < 3; channel++) {
      const sample = (row: number, side: number): number => channel < 0 ? height(row, side) : colour(row, side, channel);
      const a = sample(start, column - 1), b = sample(start, column), c = sample(end, column - 1), d = sample(end, column);
      let residual = 0;
      for (let row = start; row <= end; row++) {
        const t = (Math.fround(field.along[row] ?? 0) - from) / span;
        residual = Math.max(residual, Math.abs(sample(row, column - 1) - (a + (c - a) * t)), Math.abs(sample(row, column) - (b + (d - b) * t)));
      }
      const bound = 2 * residual + Math.abs((d - c) - (b - a)) * mixedFactor;
      if (channel < 0) { if (bound > HEIGHT_ERROR) return false; }
      else bounds.push(bound);
    }
    // XYZ is linear in linear RGB. Both surfaces and the line between them stay
    // in the convex hull of these vertices, so the minimum bounds Lab's derivative.
    for (let row = start; row <= end; row++) for (const side of [column - 1, column]) for (let axis = 0; axis < 3; axis++) {
      const matrix = xyz[axis]; if (matrix === undefined) throw new Error('Missing colour transform');
      const value = matrix.reduce((sum, coefficient, channel) => sum + coefficient * colour(row, side, channel), 0);
      minima[axis] = Math.min(minima[axis] ?? Infinity, value);
    }
    const transformed = xyz.map((matrix, axis) => matrix.reduce((sum, coefficient, channel) => sum + coefficient * (bounds[channel] ?? 0), 0) * labSlope(minima[axis] ?? 0));
    const [x = 0, y = 0, z = 0] = transformed;
    if (Math.hypot(116 * y, 500 * (x + y), 200 * (y + z)) > COLOUR_ERROR) return false;
  }
  return true;
}


/** Build-produced retained rows, keyed by the complete seam inputs; never shared between generations. */
export interface SeamLatticePlans { readonly key: string; readonly rows: Map<string, readonly number[][]> }

/** The same ordered certification, yielding between bounded subdivision and vertex-removal checks. */
export function* seamLatticeSteps(field: Field, plans?: SeamLatticePlans): Generator<void, readonly number[][]> {
  const rows = field.along.length;
  if (rows < 2 || field.columns < 4 || field.positions.length !== rows * field.columns * 3 || field.colours.length !== field.positions.length) throw new RangeError('Invalid seam floor lattice');
  const baked = plans?.rows.get(plans.key);
  if (baked !== undefined) {
    if (baked.length !== field.columns || baked.some((column, c) => column[0] !== 0 || column.at(-1) !== rows - 1
      || column.some((row, i) => !Number.isInteger(row) || row < 0 || row >= rows || (i > 0 && row <= (column[i - 1] ?? -1)))
      || ((c === 0 || c === field.columns - 1) && column.length !== rows))) throw new RangeError('Invalid baked seam lattice');
    return baked;
  }
  const dense = [0];
  for (const at of field.along) dense.push((dense.at(-1) ?? 0) + (Math.abs(at) <= 2 ? 1 : 0));
  function* plan(firstColumn: number, lastColumn: number): Generator<void, number[]> {
    const kept = [0];
    function* visit(start: number, end: number): Generator<void> {
      yield;
      if (end === start + 1 || ((dense[end] ?? 0) === (dense[start + 1] ?? 0)
        && (field.along[end] ?? 0) - (field.along[start] ?? 0) <= CONTACT_SPAN && fits(field, start, end, firstColumn, lastColumn))) { kept.push(end); return; }
      const middle = Math.floor((start + end) / 2); yield* visit(start, middle); yield* visit(middle, end);
    }
    yield* visit(0, rows - 1);
    return kept;
  }
  const retained = Array.from({ length: field.columns }, () => new Set<number>());
  for (let column = 1; column < field.columns; column++) for (const row of (yield* plan(column - 1, column))) {
    retained[column - 1]?.add(row); retained[column]?.add(row);
  }
  const native = Array.from({ length: rows }, (_unused, row) => row);
  const output = retained.map((kept, column) => column === 0 || column === field.columns - 1 ? native : [...kept].sort((a, b) => a - b));
  const bandTriangles = (column: number, visit: (triangle: readonly [number, number, number]) => void): void => {
    const left = output[column - 1], right = output[column];
    if (left === undefined || right === undefined) throw new Error('Missing adaptive band');
    let l = 0, r = 0;
    while (l < left.length - 1 || r < right.length - 1) {
      const a = (left[l] ?? 0) * field.columns + column - 1, b = (right[r] ?? 0) * field.columns + column;
      const nextLeft = left[l + 1] ?? Infinity, nextRight = right[r + 1] ?? Infinity;
      if (nextLeft === nextRight) {
        const c = nextLeft * field.columns + column - 1, d = nextRight * field.columns + column;
        if (field.corner === true) { visit([a, c, b]); visit([b, c, d]); } else { visit([a, c, d]); visit([a, d, b]); }
        l++; r++;
      } else if (nextLeft < nextRight) { visit([a, nextLeft * field.columns + column - 1, b]); l++; }
      else { visit([a, nextRight * field.columns + column, b]); r++; }
    }
  };
  // The conservative bilinear pass is cheap. A local exact overlay check can
  // remove its unnecessary vertices without inheriting the bound's slack.
  for (const direction of [1, -1]) for (let at = 1; at < field.columns - 1; at++) {
    const column = direction === 1 ? at : field.columns - 1 - at;
    const initial = output[column]; if (initial === undefined) throw new Error('Missing adaptive column');
    let kept: number[] = initial;
    // Only the two affected bands are read here (at most four native vertices per row).
    // Reuse their rounded values until this column completes; no field survives the generation.
    const triangleError = seamTriangleErrorEvaluator(field);
    for (let i = 1; i < kept.length - 1;) {
      yield;
      const row: number = kept[i] ?? 0, previous = kept[i - 1] ?? 0, next = kept[i + 1] ?? 0;
      if (Math.abs(field.along[row] ?? 0) <= 2) { i++; continue; }
      output[column] = kept.filter(value => value !== row);
      const status = { good: true };
      for (const band of [column, column + 1]) bandTriangles(band, triangle => {
        if (!status.good) return;
        const triangleRows = triangle.map(index => Math.floor(index / field.columns)), low = Math.min(...triangleRows), high = Math.max(...triangleRows);
        if (high < previous || low > next) return;
        if ((field.along[high] ?? 0) - (field.along[low] ?? 0) > CONTACT_SPAN) { status.good = false; return; }
        const error = triangleError(triangle);
        status.good = error.height <= HEIGHT_ERROR && error.colour <= COLOUR_ERROR;
      });
      if (status.good) { kept = output[column] ?? kept; } else { output[column] = kept; i++; }
    }
  }
  plans?.rows.set(plans.key, output);
  return output;
}
