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

/** Reuse native vertex reads only during one immutable field certification; no cache survives a generation. */
export function seamTriangleErrorEvaluator(field: SeamFloorField): (indices: readonly [number, number, number]) => { height: number; colour: number } {
  const bands = new Map<number, Map<number, Vertex>>();
  return (indices) => triangleError(field, indices, (index, column) => {
    let vertices = bands.get(column);
    if (vertices === undefined) { vertices = new Map(); bands.set(column, vertices); }
    let vertex = vertices.get(index);
    if (vertex === undefined) { vertex = readVertex(field, index, column); vertices.set(index, vertex); }
    return vertex;
  });
}

function triangleError(field: SeamFloorField, indices: readonly [number, number, number], read: (index: number, column: number) => Vertex): { height: number; colour: number } {
  const column = Math.min(...indices.map(index => index % field.columns));
  if (indices.some(index => index % field.columns < column || index % field.columns > column + 1)) throw new RangeError('Non-adjacent seam columns');
  const vertex = (index: number): Vertex => read(index, column);
  const [a, b, c] = indices.map(vertex);
  if (a === undefined || b === undefined || c === undefined) throw new Error('Missing seam triangle');
  const denominator = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
  if (denominator === 0) throw new RangeError('Degenerate seam triangle');
  const first = Math.min(a.row, b.row, c.row), last = Math.max(a.row, b.row, c.row);
  const diagonal = field.corner === true ? [first * field.columns + column + 1, last * field.columns + column]
    : [first * field.columns + column, last * field.columns + column + 1];
  if (last === first + 1 && diagonal.every(index => indices.includes(index))) return { height: 0, colour: 0 };
  const leftValues = vertex(first * field.columns + column).values, rightValues = vertex(first * field.columns + column + 1).values;
  let constant = true;
  for (let row = first + 1; row <= last && constant; row++) {
    constant = vertex(row * field.columns + column).values.every((value, channel) => value === leftValues[channel])
      && vertex(row * field.columns + column + 1).values.every((value, channel) => value === rightValues[channel]);
  }
  if (constant) return { height: 0, colour: 0 }; // A plane with an affine colour ramp.
  let height = 0;
  const minimum = [Infinity, Infinity, Infinity], difference = [0, 0, 0];
  // Overlay samples are consumed synchronously; scratch never leaves this triangle.
  const interpolated = [0, 0, 0, 0], actual = [0, 0, 0, 0];
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
      const x = matrix.reduce((sum, coefficient, channel) => sum + coefficient * (actual[channel + 1] ?? 0), 0);
      const y = matrix.reduce((sum, coefficient, channel) => sum + coefficient * (reference[channel + 1] ?? 0), 0);
      minimum[axis] = Math.min(minimum[axis] ?? Infinity, x, y); difference[axis] = Math.max(difference[axis] ?? 0, Math.abs(x - y));
    }
  };
  const edges = [[a, b], [b, c], [c, a]] as const;
  // Overlay vertices comprise original vertices inside the new triangle and
  // intersections of its edges with original row edges and cell diagonals.
  // Every scalar difference is affine on each overlay polygon, so these are
  // its exact extrema; no interior sampling grid can miss a thin error spike.
  for (let row = first; row <= last; row++) {
    const left = vertex(row * field.columns + column), right = vertex(row * field.columns + column + 1);
    record(left.u, left.v, left.values); record(right.u, right.v, right.values);
    for (const [p, q] of edges) {
      if (p.v !== q.v) {
        const t = (left.v - p.v) / (q.v - p.v);
        if (t >= 0 && t <= 1) { const u = p.u + (q.u - p.u) * t; record(u, left.v, mix(left, right, u)); }
      }
    }
    if (row === last) continue;
    const topLeft = vertex((row + 1) * field.columns + column), topRight = vertex((row + 1) * field.columns + column + 1);
    const start = field.corner === true ? right : left, end = field.corner === true ? topLeft : topRight;
    for (const [p, q] of edges) {
      const du = q.u - p.u, dv = q.v - p.v, eu = end.u - start.u, ev = end.v - start.v;
      const determinant = du * ev - dv * eu;
      if (determinant === 0) continue;
      const ru = start.u - p.u, rv = start.v - p.v;
      const t = (ru * ev - rv * eu) / determinant, s = (ru * dv - rv * du) / determinant;
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) record(p.u + t * du, p.v + t * dv, mix(start, end, s));
    }
  }
  const [dx = 0, dy = 0, dz = 0] = difference.map((value, axis) => value * slope(Math.max(0, minimum[axis] ?? 0)));
  // XYZ extrema are also affine; the Lab derivative is bounded by the minimum
  // over the same convex polygons, including the path between both RGB values.
  return { height, colour: Math.hypot(116 * dy, 500 * (dx + dy), 200 * (dy + dz)) };
}
