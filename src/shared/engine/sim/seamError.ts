/** Native floor data: both triangulations use these exact Float32 vertex values. */
export interface SeamFloorField { readonly positions: ArrayLike<number>; readonly colours: ArrayLike<number>; readonly columns: number; readonly along: readonly number[]; readonly corner?: boolean }
const xyz = [[0.4124564 / 0.95047, 0.3575761 / 0.95047, 0.1804375 / 0.95047],
  [0.2126729, 0.7151522, 0.0721750], [0.0193339 / 1.08883, 0.1191920 / 1.08883, 0.9503041 / 1.08883]] as const;
const slope = (minimum: number): number => minimum <= (6 / 29) ** 3 ? 1 / (3 * (6 / 29) ** 2) : 1 / (3 * minimum ** (2 / 3));
interface Vertex { u: number; v: number; row: number; values: readonly number[] }

function readVertex(field: SeamFloorField, index: number, column: number): Vertex {
  const row = Math.floor(index / field.columns), at = index * 3;
  return { row, u: index % field.columns - column, v: Math.fround(field.along[row] ?? 0),
    values: [Math.fround(field.positions[at + 1] ?? 0), Math.fround(field.colours[at] ?? 0),
      Math.fround(field.colours[at + 1] ?? 0), Math.fround(field.colours[at + 2] ?? 0)] };
}

/** Reuse native vertex reads only during one immutable field certification; no cache survives a generation.
 *  SB38: one evaluator holds its scratch (the overlay's channels, its Lab extrema, the result it returns), so a triangle
 *  allocates nothing: a seam's certification calls this millions of times on the page, and JavaScriptCore grows its heap
 *  with the garbage. The arithmetic keeps the exact order the reductions had. The result is read before the next call. */
export function seamTriangleErrorEvaluator(field: SeamFloorField): (indices: readonly [number, number, number]) => { height: number; colour: number } {
  const bands = new Map<number, Map<number, Vertex>>(), columns = field.columns;
  const minimum = [Infinity, Infinity, Infinity], difference = [0, 0, 0], interpolated = [0, 0, 0, 0], actual = [0, 0, 0, 0];
  const result = { height: 0, colour: 0 };
  let column = 0, height = 0, denominator = 1;
  let a: Vertex = { u: 0, v: 0, row: 0, values: [] }, b = a, c = a;
  const vertex = (index: number): Vertex => {
    let vertices = bands.get(column);
    if (vertices === undefined) { vertices = new Map(); bands.set(column, vertices); }
    let found = vertices.get(index);
    if (found === undefined) { found = readVertex(field, index, column); vertices.set(index, found); }
    return found;
  };
  const same = (values: readonly number[], reference: readonly number[]): boolean => {
    for (let channel = 0; channel < values.length; channel++) if (values[channel] !== reference[channel]) return false;
    return true;
  };
  const mix = (p: Vertex, q: Vertex, t: number): readonly number[] => {
    for (let channel = 0; channel < 4; channel++) {
      const value = p.values[channel] ?? 0;
      interpolated[channel] = value + ((q.values[channel] ?? 0) - value) * t;
    }
    return interpolated;
  };
  const record = (u: number, v: number, reference: readonly number[]): void => {
    const wa = ((b.v - c.v) * (u - c.u) + (c.u - b.u) * (v - c.v)) / denominator;
    const wb = ((c.v - a.v) * (u - c.u) + (a.u - c.u) * (v - c.v)) / denominator, wc = 1 - wa - wb;
    if (Math.min(wa, wb, wc) < -1e-9) return;
    for (let channel = 0; channel < 4; channel++) actual[channel] = (a.values[channel] ?? 0) * wa + (b.values[channel] ?? 0) * wb + (c.values[channel] ?? 0) * wc;
    height = Math.max(height, Math.abs((actual[0] ?? 0) - (reference[0] ?? 0)));
    for (let axis = 0; axis < 3; axis++) {
      const matrix = xyz[axis]; if (matrix === undefined) throw new Error('Missing colour transform');
      const x = 0 + matrix[0] * (actual[1] ?? 0) + matrix[1] * (actual[2] ?? 0) + matrix[2] * (actual[3] ?? 0);
      const y = 0 + matrix[0] * (reference[1] ?? 0) + matrix[1] * (reference[2] ?? 0) + matrix[2] * (reference[3] ?? 0);
      minimum[axis] = Math.min(minimum[axis] ?? Infinity, x, y); difference[axis] = Math.max(difference[axis] ?? 0, Math.abs(x - y));
    }
  };
  /** The edge p→q of the triangle against one original row edge or cell diagonal (an overlay vertex where they cross). */
  const crossRow = (p: Vertex, q: Vertex, left: Vertex, right: Vertex): void => {
    if (p.v !== q.v) {
      const t = (left.v - p.v) / (q.v - p.v);
      if (t >= 0 && t <= 1) { const u = p.u + (q.u - p.u) * t; record(u, left.v, mix(left, right, u)); }
    }
  };
  const crossDiagonal = (p: Vertex, q: Vertex, start: Vertex, end: Vertex): void => {
    const du = q.u - p.u, dv = q.v - p.v, eu = end.u - start.u, ev = end.v - start.v;
    const determinant = du * ev - dv * eu;
    if (determinant === 0) return;
    const ru = start.u - p.u, rv = start.v - p.v;
    const t = (ru * ev - rv * eu) / determinant, s = (ru * dv - rv * du) / determinant;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) record(p.u + t * du, p.v + t * dv, mix(start, end, s));
  };
  const done = (h: number, colour: number): { height: number; colour: number } => { result.height = h; result.colour = colour; return result; };
  return (indices) => {
    const i0 = indices[0], i1 = indices[1], i2 = indices[2];
    column = Math.min(i0 % columns, i1 % columns, i2 % columns);
    for (let k = 0; k < 3; k++) { const at = (indices[k] ?? 0) % columns; if (at < column || at > column + 1) throw new RangeError('Non-adjacent seam columns'); }
    a = vertex(i0); b = vertex(i1); c = vertex(i2);
    denominator = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
    if (denominator === 0) throw new RangeError('Degenerate seam triangle');
    const first = Math.min(a.row, b.row, c.row), last = Math.max(a.row, b.row, c.row);
    const d0 = field.corner === true ? first * columns + column + 1 : first * columns + column;
    const d1 = field.corner === true ? last * columns + column : last * columns + column + 1;
    if (last === first + 1 && (d0 === i0 || d0 === i1 || d0 === i2) && (d1 === i0 || d1 === i1 || d1 === i2)) return done(0, 0);
    const leftValues = vertex(first * columns + column).values, rightValues = vertex(first * columns + column + 1).values;
    let constant = true;
    for (let row = first + 1; row <= last && constant; row++) {
      constant = same(vertex(row * columns + column).values, leftValues) && same(vertex(row * columns + column + 1).values, rightValues);
    }
    if (constant) return done(0, 0); // A plane with an affine colour ramp.
    height = 0;
    minimum[0] = minimum[1] = minimum[2] = Infinity; difference[0] = difference[1] = difference[2] = 0;
    // Overlay vertices comprise original vertices inside the new triangle and
    // intersections of its edges with original row edges and cell diagonals.
    // Every scalar difference is affine on each overlay polygon, so these are
    // its exact extrema; no interior sampling grid can miss a thin error spike.
    for (let row = first; row <= last; row++) {
      const left = vertex(row * columns + column), right = vertex(row * columns + column + 1);
      record(left.u, left.v, left.values); record(right.u, right.v, right.values);
      crossRow(a, b, left, right); crossRow(b, c, left, right); crossRow(c, a, left, right);
      if (row === last) continue;
      const topLeft = vertex((row + 1) * columns + column), topRight = vertex((row + 1) * columns + column + 1);
      const start = field.corner === true ? right : left, end = field.corner === true ? topLeft : topRight;
      crossDiagonal(a, b, start, end); crossDiagonal(b, c, start, end); crossDiagonal(c, a, start, end);
    }
    const dx = (difference[0] ?? 0) * slope(Math.max(0, minimum[0] ?? 0)), dy = (difference[1] ?? 0) * slope(Math.max(0, minimum[1] ?? 0)),
      dz = (difference[2] ?? 0) * slope(Math.max(0, minimum[2] ?? 0));
    // XYZ extrema are also affine; the Lab derivative is bounded by the minimum
    // over the same convex polygons, including the path between both RGB values.
    return done(height, Math.hypot(116 * dy, 500 * (dx + dy), 200 * (dy + dz)));
  };
}
