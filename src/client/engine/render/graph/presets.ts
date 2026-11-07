/**
 * Built-in graph presets (SHARD-PLATFORM SF59 step 4): today's hand-written families re-expressed as graph IR
 * (`core/materialGraph.ts`), so a graph and its family can be held to pixel parity on the bench (`scripts/tsl-spike/`, the
 * `graph` variants). The families stay the shipped path: no material in the game is built from a preset yet, and nothing
 * on the default render path imports this module. Pure data: no three.js.
 *
 * - `pbrMeasureGraph`: the PBR family with SF56's measure layer (`families/measure.ts`): the role colours, the 1 m grid
 *   and sub-grid, the glow, and the size-label glyphs ("12.5×3" on a structure or trim face of at least 1 m × 1 m) as
 *   integer-style float maths, the seven segments as two constant-count loops.
 * - `emissiveGraph`: the emissive family's opaque surface and neon tube shapes (`families/emissive.ts`), flicker included.
 * - `toonGraph` / `painterlyGraph` (SF59 step 6): the toon and painterly families' light models through the `lighting`
 *   stage: the sun sub-graph (cel bands on N·L and the shadow ratio, shade tints, the terminator, the rim, the toon's
 *   cloud shade as two octaves of the family's own value noise, the painterly wetness), the ambient term (the toon lift,
 *   the painted floor) and the painterly grade after lighting. SF59 step 7 ported the rest: the toon caustics under a
 *   water level (two drifting value noises behind a real branch, so only pixels under the water pay), the toon rim on
 *   the faceted normal (`viewToWorld`) and the painterly wind sway (a vertex offset from `objectOrigin`,
 *   `positionGeometry` and `worldToLocal`).
 * - **Not expressible in IR version 1** (so no preset yet): the emissive sky (no `atan` / `asin` or screen-position
 *   input, and its back-face, depth-off, unfogged render state), an additive emitter (no blend mode) and a fog share
 *   other than 1 (the engine fog epilogue is not a stage). `emissiveGraph` refuses those with the reason.
 *
 * A preset may run past the content budget (the labelled measure preset does: its glyph loops count once per
 * iteration: ≈ 450 nodes, ≈ 560 instructions against the content default of 160 / 480), so presets compile under
 * `PRESET_GRAPH_BUDGET`.
 */
import {
  MEASURE_SLOT, presetRefusal, type EmissiveLookParams, type EmissiveMaterialParams, type FamilyMaterialParams, type MeasureLayerParams,
  type PainterlyLookParams, type PainterlyMaterialParams, type PbrMaterialParams, type ToonLookParams, type ToonMaterialParams,
} from '@wildshard/format/materialFamilies';
import { GRAPH_IR_VERSION, type GraphBudget, type GraphIr, type GraphNode, type GraphParam, type GraphRef } from '@wildshard/format/materialGraph';

/** the ceilings a built-in preset compiles under (`compileGraph(preset, { budget: PRESET_GRAPH_BUDGET })`) */
export const PRESET_GRAPH_BUDGET: GraphBudget = { nodes: 512, samplers: 4, instructions: 1024 };

/**
 * The coverage of lines every `pitch` metres across `c` (the measure layer's `famMGrid`): nodes named `<p>…`, the
 * result in `<p>out`.
 */
function gridNodes(p: string, c: GraphRef, pitch: GraphRef, hw: GraphRef): Record<string, GraphNode> {
  return {
    [`${p}fwc`]: { op: 'fwidth', in: [c] },
    [`${p}fw`]: { op: 'max', in: [`${p}fwc`, [1e-5, 1e-5]] },
    [`${p}cp`]: { op: 'div', in: [c, pitch] },
    [`${p}fr`]: { op: 'fract', in: [`${p}cph`] },
    [`${p}cph`]: { op: 'add', in: [`${p}cp`, 0.5] },
    [`${p}dc`]: { op: 'sub', in: [`${p}fr`, 0.5] },
    [`${p}da`]: { op: 'abs', in: [`${p}dc`] },
    [`${p}d`]: { op: 'mul', in: [`${p}da`, pitch] },
    [`${p}fw75`]: { op: 'mul', in: [`${p}fw`, 0.75] },
    [`${p}w`]: { op: 'max', in: [`${p}fw75`, hw] },
    [`${p}hf`]: { op: 'mul', in: [`${p}fw`, 0.5] },
    [`${p}lo`]: { op: 'sub', in: [`${p}w`, `${p}hf`] },
    [`${p}hi`]: { op: 'add', in: [`${p}w`, `${p}hf`] },
    [`${p}edge`]: { op: 'smoothstep', in: [`${p}lo`, `${p}hi`, `${p}d`] },
    [`${p}core`]: { op: 'oneMinus', in: [`${p}edge`] },
    [`${p}thin`]: { op: 'div', in: [hw, `${p}w`] },
    [`${p}thin16`]: { op: 'mul', in: [`${p}thin`, 1.6] },
    [`${p}dim`]: { op: 'min', in: [`${p}thin16`, 1] },
    [`${p}l0`]: { op: 'mul', in: [`${p}core`, `${p}dim`] },
    [`${p}f0`]: { op: 'mul', in: [pitch, 0.12] },
    [`${p}f1`]: { op: 'mul', in: [pitch, 0.35] },
    [`${p}fs`]: { op: 'smoothstep', in: [`${p}f0`, `${p}f1`, `${p}fw`] },
    [`${p}fade`]: { op: 'oneMinus', in: [`${p}fs`] },
    [`${p}l`]: { op: 'mul', in: [`${p}l0`, `${p}fade`] },
    [`${p}lx`]: { op: 'swizzle', in: [`${p}l`], mask: 'x' },
    [`${p}ly`]: { op: 'swizzle', in: [`${p}l`], mask: 'y' },
    [`${p}out`]: { op: 'max', in: [`${p}lx`, `${p}ly`] },
  };
}

/** `famMBox`: the signed distance from `pt` to a box at `c` with half size `h`; nodes named `<p>…`, the result `<p>out` */
function boxNodes(p: string, pt: GraphRef, c: GraphRef, h: GraphRef): Record<string, GraphNode> {
  return {
    [`${p}pc`]: { op: 'sub', in: [pt, c] },
    [`${p}qa`]: { op: 'abs', in: [`${p}pc`] },
    [`${p}q`]: { op: 'sub', in: [`${p}qa`, h] },
    [`${p}qm`]: { op: 'max', in: [`${p}q`, 0] },
    [`${p}ql`]: { op: 'length', in: [`${p}qm`] },
    [`${p}qx`]: { op: 'swizzle', in: [`${p}q`], mask: 'x' },
    [`${p}qy`]: { op: 'swizzle', in: [`${p}q`], mask: 'y' },
    [`${p}qmx`]: { op: 'max', in: [`${p}qx`, `${p}qy`] },
    [`${p}qmn`]: { op: 'min', in: [`${p}qmx`, 0] },
    [`${p}out`]: { op: 'add', in: [`${p}ql`, `${p}qmn`] },
  };
}

/** `famMSeg`: the distance from `pt` to the segment a → b (literals); nodes named `<p>…`, the result `<p>out` */
function segNodes(p: string, pt: GraphRef, a: readonly [number, number], b: readonly [number, number]): Record<string, GraphNode> {
  const ba: [number, number] = [b[0] - a[0], b[1] - a[1]];
  return {
    [`${p}pa`]: { op: 'sub', in: [pt, [a[0], a[1]]] },
    [`${p}dt`]: { op: 'dot', in: [`${p}pa`, ba] },
    [`${p}h`]: { op: 'div', in: [`${p}dt`, ba[0] * ba[0] + ba[1] * ba[1]] },
    [`${p}hc`]: { op: 'clamp', in: [`${p}h`, 0, 1] },
    [`${p}bh`]: { op: 'mul', in: [ba, `${p}hc`] },
    [`${p}r`]: { op: 'sub', in: [`${p}pa`, `${p}bh`] },
    [`${p}out`]: { op: 'length', in: [`${p}r`] },
  };
}

/** the seven-segment masks of famMGlyph's digits 0–9 (bit 0 top, 1 upper right, 2 lower right, 3 bottom, 4 lower left, 5 upper left, 6 middle) */
const SEGMENTS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111] as const;
/**
 * The masks reordered for the two glyph loops: bits 0–2 the horizontal bars top, middle, bottom (y = 0.94 − 0.44 i), bits
 * 3–6 the vertical bars upper left, upper right, lower left, lower right (x = 0.06 + 0.43 (i mod 2), y = 0.72 − 0.44 ⌊i / 2⌋)
 */
const LOOP_MASKS = SEGMENTS.map((m) => {
  const bit = (b: number): number => (m >> b) & 1;
  return bit(0) + 2 * bit(6) + 4 * bit(3) + 8 * (bit(5) + 2 * bit(1) + 4 * bit(4) + 8 * bit(2));
});

/**
 * One glyph loop's body: the accumulator is (distance, the mask bits not yet read, the glyph point); each iteration reads
 * the lowest bit (exact float halving) and, when it is set, takes the min with that bar's box. `centre` names the body
 * node holding the bar's centre, built from `ix` (the iteration).
 */
function barLoopBody(centre: Record<string, GraphNode>, half: readonly [number, number]): { nodes: Record<string, GraphNode>; out: GraphRef } {
  return {
    nodes: {
      acc: { op: 'acc' },
      ix: { op: 'index' },
      d: { op: 'swizzle', in: ['acc'], mask: 'x' },
      m: { op: 'swizzle', in: ['acc'], mask: 'y' },
      pt: { op: 'swizzle', in: ['acc'], mask: 'zw' },
      mh: { op: 'mul', in: ['m', 0.5] },
      fr: { op: 'fract', in: ['mh'] },
      on: { op: 'gt', in: ['fr', 0.25] },
      mn: { op: 'floor', in: ['mh'] },
      ...centre,
      ...boxNodes('b', 'pt', 'c', [half[0], half[1]]),
      dn: { op: 'min', in: ['d', 'bout'] },
      ds: { op: 'select', in: ['on', 'dn', 'd'] },
      next: { op: 'combine', in: ['ds', 'mn', 'pt'] },
    },
    out: 'next',
  };
}

/** one size part (`q` half metres) of the label: `<p>len` characters, `<p>tens`, `<p>ones`, `<p>two` (1 when two digits) */
function partNodes(p: string, q: GraphRef): Record<string, GraphNode> {
  return {
    [`${p}h`]: { op: 'mul', in: [q, 0.5] },
    [`${p}whole`]: { op: 'floor', in: [`${p}h`] },
    [`${p}w2`]: { op: 'mul', in: [`${p}whole`, 2] },
    [`${p}half`]: { op: 'sub', in: [q, `${p}w2`] },
    [`${p}t10`]: { op: 'div', in: [`${p}whole`, 10] },
    [`${p}tens`]: { op: 'floor', in: [`${p}t10`] },
    [`${p}tt`]: { op: 'mul', in: [`${p}tens`, 10] },
    [`${p}ones`]: { op: 'sub', in: [`${p}whole`, `${p}tt`] },
    [`${p}two`]: { op: 'step', in: [10, `${p}whole`] },
    [`${p}h2`]: { op: 'mul', in: [`${p}half`, 2] },
    [`${p}l1`]: { op: 'add', in: [`${p}two`, `${p}h2`] },
    [`${p}len`]: { op: 'add', in: [`${p}l1`, 1] },
  };
}

/**
 * The size label (measure.ts's famMChars / famMGlyph / the label block): reads the decode nodes `code4f` (width in half
 * metres), `vQ` (height in half metres), `face` and `hasRole`, and the `labelHeight` param; the ink in `ink`. The glyph's
 * distance is a real branch (only label pixels run the loops); its anti-aliasing width is taken outside it, as the family's.
 */
function labelNodes(): Record<string, GraphNode> {
  // the digit's loop mask: a select chain over 0–9 ending in `lm0`
  const maskChain: Record<string, GraphNode> = {};
  for (let k = 0; k <= 8; k++) {
    maskChain[`lmIs${k}`] = { op: 'eq', in: ['lch', k] };
    maskChain[`lm${k}`] = { op: 'select', in: [`lmIs${k}`, LOOP_MASKS[k] ?? 0, k === 8 ? (LOOP_MASKS[9] ?? 0) : `lm${k + 1}`] };
  }
  return {
    // the label box: glyph height min(label, 0.2 × the smaller side), in the face's top-left corner, in glyph heights
    lW: { op: 'mul', in: ['code4f', 0.5] },
    lH: { op: 'mul', in: ['vQ', 0.5] },
    lMinWH: { op: 'min', in: ['lW', 'lH'] },
    lGh0: { op: 'mul', in: ['lMinWH', 0.2] },
    labelHeight: { op: 'param', param: 'labelHeight' },
    lGh: { op: 'min', in: ['labelHeight', 'lGh0'] },
    lMargin: { op: 'mul', in: ['lGh', 0.4] },
    faceX: { op: 'swizzle', in: ['face'], mask: 'x' },
    faceY: { op: 'swizzle', in: ['face'], mask: 'y' },
    lX0: { op: 'sub', in: ['faceX', 'lMargin'] },
    lTop0: { op: 'sub', in: ['lH', 'lMargin'] },
    lTop: { op: 'sub', in: ['lTop0', 'lGh'] },
    lY0: { op: 'sub', in: ['faceY', 'lTop'] },
    lGhS: { op: 'max', in: ['lGh', 1e-3] },
    lL0: { op: 'combine', in: ['lX0', 'lY0'] },
    lL: { op: 'div', in: ['lL0', 'lGhS'] },
    lX: { op: 'swizzle', in: ['lL'], mask: 'x' },
    lY: { op: 'swizzle', in: ['lL'], mask: 'y' },
    lFw: { op: 'fwidth', in: ['lL'] },
    lFwL: { op: 'length', in: ['lFw'] },
    lAa0: { op: 'mul', in: ['lFwL', 0.6] },
    lAa: { op: 'max', in: ['lAa0', 1e-4] },
    lAaN: { op: 'negate', in: ['lAa'] },
    // the characters "w×h" (a half as ".5"), and the one under this pixel
    ...partNodes('lw', 'code4f'),
    ...partNodes('lh', 'vQ'),
    lwlen1: { op: 'add', in: ['lwlen', 1] },
    lN: { op: 'add', in: ['lwlen1', 'lhlen'] },
    lI0: { op: 'div', in: ['lX', 0.7] },
    lI: { op: 'floor', in: ['lI0'] },
    lInW: { op: 'lt', in: ['lI', 'lwlen'] },
    lIsX: { op: 'eq', in: ['lI', 'lwlen'] },
    lJH: { op: 'sub', in: ['lI', 'lwlen1'] },
    lJ: { op: 'select', in: ['lInW', 'lI', 'lJH'] },
    lTens: { op: 'select', in: ['lInW', 'lwtens', 'lhtens'] },
    lOnes: { op: 'select', in: ['lInW', 'lwones', 'lhones'] },
    lTwo: { op: 'select', in: ['lInW', 'lwtwo', 'lhtwo'] },
    lK1: { op: 'add', in: ['lJ', 1] },
    lK: { op: 'sub', in: ['lK1', 'lTwo'] },
    lK0: { op: 'lt', in: ['lK', 0.5] },
    lK1b: { op: 'lt', in: ['lK', 1.5] },
    lK2: { op: 'lt', in: ['lK', 2.5] },
    lChHalf: { op: 'select', in: ['lK2', 10, 5] },
    lChOnes: { op: 'select', in: ['lK1b', 'lOnes', 'lChHalf'] },
    lChDigit: { op: 'select', in: ['lK0', 'lTens', 'lChOnes'] },
    lch: { op: 'select', in: ['lIsX', 11, 'lChDigit'] },
    // the glyph: '.', '×' or a seven-segment digit, at the character's own origin
    lIx: { op: 'mul', in: ['lI', 0.7] },
    lGx: { op: 'sub', in: ['lX', 'lIx'] },
    lGp: { op: 'combine', in: ['lGx', 'lY'] },
    ...boxNodes('lDot', 'lGp', [0.12, 0.07], [0.07, 0.07]),
    ...segNodes('lSa', 'lGp', [0.06, 0.2], [0.46, 0.7]),
    ...segNodes('lSb', 'lGp', [0.06, 0.7], [0.46, 0.2]),
    lCross0: { op: 'min', in: ['lSaout', 'lSbout'] },
    lCross: { op: 'sub', in: ['lCross0', 0.055] },
    ...maskChain,
    lInit: { op: 'combine', in: [1e3, 'lm0', 'lGp'] },
    lBarsH: {
      op: 'loop', count: 3, in: ['lInit'],
      body: barLoopBody({
        iy: { op: 'mul', in: ['ix', 0.44] },
        cy: { op: 'sub', in: [0.94, 'iy'] },
        c: { op: 'combine', in: [0.275, 'cy'] },
      }, [0.17, 0.055]),
    },
    lBarsV: {
      op: 'loop', count: 4, in: ['lBarsH'],
      body: barLoopBody({
        ih: { op: 'mul', in: ['ix', 0.5] },
        icol: { op: 'fract', in: ['ih'] },
        irow: { op: 'floor', in: ['ih'] },
        cx0: { op: 'mul', in: ['icol', 0.86] },
        cx: { op: 'add', in: ['cx0', 0.06] },
        cy0: { op: 'mul', in: ['irow', 0.44] },
        cy: { op: 'sub', in: [0.72, 'cy0'] },
        c: { op: 'combine', in: ['cx', 'cy'] },
      }, [0.055, 0.2]),
    },
    lDigit: { op: 'swizzle', in: ['lBarsV'], mask: 'x' },
    lIsDot: { op: 'eq', in: ['lch', 10] },
    lIsCross: { op: 'eq', in: ['lch', 11] },
    lGlyphRest: { op: 'select', in: ['lIsCross', 'lCross', 'lDigit'] },
    lGlyph: { op: 'select', in: ['lIsDot', 'lDotout', 'lGlyphRest'] },
    // only a role face of at least 1 m × 1 m, inside the label's row, on one of its characters
    lBigW: { op: 'gte', in: ['code4f', 2] },
    lBigH: { op: 'gte', in: ['vQ', 2] },
    lBig: { op: 'and', in: ['lBigW', 'lBigH'] },
    lOnRole: { op: 'and', in: ['hasRole', 'lBig'] },
    lRowLo: { op: 'gt', in: ['lY', -0.2] },
    lRowHi: { op: 'lt', in: ['lY', 1.2] },
    lLeft: { op: 'gt', in: ['lX', -0.2] },
    lRow0: { op: 'and', in: ['lRowLo', 'lRowHi'] },
    lRow: { op: 'and', in: ['lRow0', 'lLeft'] },
    lCharLo: { op: 'gte', in: ['lI', 0] },
    lCharHi: { op: 'lt', in: ['lI', 'lN'] },
    lChar: { op: 'and', in: ['lCharLo', 'lCharHi'] },
    lAt0: { op: 'and', in: ['lOnRole', 'lRow'] },
    lAt: { op: 'and', in: ['lAt0', 'lChar'] },
    lD: { op: 'select', in: ['lAt', 'lGlyph', 1e3] },
    lInkS: { op: 'smoothstep', in: ['lAaN', 'lAa', 'lD'] },
    lInk: { op: 'oneMinus', in: ['lInkS'] },
    // masked again, branch-free: off a label, a quad straddling two faces can widen the anti-aliasing past the far distance
    lAtF: { op: 'select', in: ['lAt', 1, 0] },
    ink: { op: 'mul', in: ['lInk', 'lAtF'] },
  };
}

/**
 * The PBR family with a measure layer as a graph preset: the same uniforms the family's patch declares (as params), the
 * same decode of the first UV set (role, face metres, size) and the same mix order. `params` is a parsed PBR surface.
 */
export function pbrMeasureGraph(params: PbrMaterialParams, measure: MeasureLayerParams): GraphIr {
  const S = MEASURE_SLOT;
  return {
    version: GRAPH_IR_VERSION,
    kind: 'material',
    model: 'standard',
    doubleSided: params.doubleSided,
    params: {
      structure: { type: 'colour', value: measure.structure },
      trim: { type: 'colour', value: measure.trim },
      floor: { type: 'colour', value: measure.floor },
      line: { type: 'colour', value: measure.line.colour },
      lineWidth: { type: 'float', value: measure.line.width, min: 0, max: 0.1 },
      lineAlpha: { type: 'float', value: measure.line.alpha, min: 0, max: 1 },
      floorAlpha: { type: 'float', value: measure.line.floorAlpha, min: 0, max: 1 },
      subStep: { type: 'float', value: measure.sub.step, min: 0.01, max: 0.5 },
      subAlpha: { type: 'float', value: measure.sub.alpha, min: 0, max: 1 },
      lift: { type: 'float', value: measure.lift, min: 0, max: 1 },
      label: { type: 'colour', value: measure.label.colour },
      labelHeight: { type: 'float', value: measure.label.height, min: 0, max: 2 },
      roughness: { type: 'float', value: params.roughness, min: 0, max: 1 },
      metalness: { type: 'float', value: params.metalness, min: 0, max: 1 },
    },
    nodes: {
      uv: { op: 'uv' },
      u: { op: 'swizzle', in: ['uv'], mask: 'x' },
      v: { op: 'swizzle', in: ['uv'], mask: 'y' },
      // the role and the face's own metres, packed in UV0 (params.ts measureUv)
      codeF: { op: 'div', in: ['u', S] },
      code: { op: 'floor', in: ['codeF'] },
      code4: { op: 'div', in: ['code', 4] },
      code4f: { op: 'floor', in: ['code4'] },
      code4m: { op: 'mul', in: ['code4f', 4] },
      role: { op: 'sub', in: ['code', 'code4m'] },
      isStructure: { op: 'eq', in: ['role', 1] },
      isTrim: { op: 'eq', in: ['role', 2] },
      hasRole: { op: 'or', in: ['isStructure', 'isTrim'] },
      codeS: { op: 'mul', in: ['code', S] },
      faceU: { op: 'sub', in: ['u', 'codeS'] },
      vF: { op: 'div', in: ['v', S] },
      vQ: { op: 'floor', in: ['vF'] },
      vQS: { op: 'mul', in: ['vQ', S] },
      faceV: { op: 'sub', in: ['v', 'vQS'] },
      face1: { op: 'combine', in: ['faceU', 'faceV'] },
      face: { op: 'sub', in: ['face1', 1] },
      // the floor: world metres on the plane the surface faces
      pos: { op: 'positionWorld' },
      nw: { op: 'normalWorld' },
      na: { op: 'abs', in: ['nw'] },
      nax: { op: 'swizzle', in: ['na'], mask: 'x' },
      nay: { op: 'swizzle', in: ['na'], mask: 'y' },
      naz: { op: 'swizzle', in: ['na'], mask: 'z' },
      naxz: { op: 'max', in: ['nax', 'naz'] },
      up: { op: 'gte', in: ['nay', 'naxz'] },
      side: { op: 'gte', in: ['nax', 'naz'] },
      pxz: { op: 'swizzle', in: ['pos'], mask: 'xz' },
      pzy: { op: 'swizzle', in: ['pos'], mask: 'zy' },
      pxy: { op: 'swizzle', in: ['pos'], mask: 'xy' },
      wall: { op: 'select', in: ['side', 'pzy', 'pxy'] },
      world: { op: 'select', in: ['up', 'pxz', 'wall'] },
      c: { op: 'select', in: ['hasRole', 'face', 'world'] },
      // the 1 m grid and the sub-grid
      lineWidth: { op: 'param', param: 'lineWidth' },
      subStep: { op: 'param', param: 'subStep' },
      fineW: { op: 'mul', in: ['lineWidth', 0.6] },
      ...gridNodes('g', 'c', 1, 'lineWidth'),
      ...gridNodes('s', 'c', 'subStep', 'fineW'),
      // the role colour, the lines over it, the glow
      structure: { op: 'param', param: 'structure' },
      trim: { op: 'param', param: 'trim' },
      floor: { op: 'param', param: 'floor' },
      line: { op: 'param', param: 'line' },
      baseRest: { op: 'select', in: ['isTrim', 'trim', 'floor'] },
      base: { op: 'select', in: ['isStructure', 'structure', 'baseRest'] },
      lineA: { op: 'select', in: ['hasRole', 'lineAlphaP', 'floorAlphaP'] },
      lineAlphaP: { op: 'param', param: 'lineAlpha' },
      floorAlphaP: { op: 'param', param: 'floorAlpha' },
      subAlpha: { op: 'param', param: 'subAlpha' },
      fineA: { op: 'mul', in: ['sout', 'subAlpha'] },
      mainA: { op: 'mul', in: ['gout', 'lineA'] },
      withFine: { op: 'mix', in: ['base', 'line', 'fineA'] },
      withLines: { op: 'mix', in: ['withFine', 'line', 'mainA'] },
      // the size label over the lines
      ...labelNodes(),
      label: { op: 'param', param: 'label' },
      inkA: { op: 'mul', in: ['ink', 0.92] },
      out: { op: 'mix', in: ['withLines', 'label', 'inkA'] },
      liftP: { op: 'param', param: 'lift' },
      glow: { op: 'mul', in: ['out', 'liftP'] },
      roughness: { op: 'param', param: 'roughness' },
      metalness: { op: 'param', param: 'metalness' },
    },
    stages: {
      surface: { colour: 'out', emissive: 'glow', roughness: 'roughness', metalness: 'metalness' },
    },
  };
}

/** famEmitH11: a float hash of `x`; nodes named `<p>…`, the result `<p>out` */
function hash11Nodes(p: string, x: GraphRef): Record<string, GraphNode> {
  return {
    [`${p}a0`]: { op: 'mul', in: [x, 0.1031] },
    [`${p}a`]: { op: 'fract', in: [`${p}a0`] },
    [`${p}b0`]: { op: 'add', in: [`${p}a`, 33.33] },
    [`${p}b`]: { op: 'mul', in: [`${p}a`, `${p}b0`] },
    [`${p}c0`]: { op: 'add', in: [`${p}b`, `${p}b`] },
    [`${p}c`]: { op: 'mul', in: [`${p}b`, `${p}c0`] },
    [`${p}out`]: { op: 'fract', in: [`${p}c`] },
  };
}

/** famEmitTube: the neon tube over `tint` from the distance field `field` (R fill, G skeleton); the light in `tube` */
function tubeNodes(): Record<string, GraphNode> {
  const P = (name: string): GraphNode => ({ op: 'param', param: name });
  return {
    tFillSpread: P('fillSpread'), tSkSpread: P('skeletonSpread'), tMono: P('mono'), tRadius: P('radius'),
    tRim: P('rim'), tThicken: P('thicken'), tSeam: P('seam'), tSeamWidth: P('seamWidth'),
    tHaloReach: P('haloReach'), tHaloGain: P('haloGain'), tCore: P('core'), tRimShade: P('rimShade'), tCell: P('cell'),
    tS: { op: 'texture', param: 'field', in: ['uv'] },
    tR: { op: 'swizzle', in: ['tS'], mask: 'x' },
    tG: { op: 'swizzle', in: ['tS'], mask: 'y' },
    tR5: { op: 'sub', in: ['tR', 0.5] },
    tR2: { op: 'mul', in: ['tR5', 2] },
    tRs: { op: 'mul', in: ['tR2', 'tFillSpread'] },
    tDFill: { op: 'add', in: ['tRs', 'tThicken'] },
    tDSk: { op: 'mul', in: ['tG', 'tSkSpread'] },
    tMonoD: { op: 'sub', in: ['tRadius', 'tDSk'] },
    tD: { op: 'mix', in: ['tDFill', 'tMonoD', 'tMono'] },
    tFwd: { op: 'fwidth', in: ['tD'] },
    tW0: { op: 'max', in: ['tFwd', 1e-4] },
    tW: { op: 'mul', in: ['tW0', 0.75] },
    tWN: { op: 'negate', in: ['tW'] },
    tFill: { op: 'smoothstep', in: ['tWN', 'tW', 'tD'] },
    tRimLo: { op: 'sub', in: ['tRim', 'tW'] },
    tRimHi: { op: 'add', in: ['tRim', 'tW'] },
    tRimS: { op: 'smoothstep', in: ['tRimLo', 'tRimHi', 'tD'] },
    tRimIn: { op: 'oneMinus', in: ['tRimS'] },
    tRimA: { op: 'mul', in: ['tFill', 'tRimIn'] },
    tCoreC: { op: 'mix', in: ['tint', [1, 1, 1], 'tCore'] },
    tGlass: { op: 'mul', in: ['tint', 'tRimShade'] },
    tTube0: { op: 'mix', in: ['tCoreC', 'tGlass', 'tRimA'] },
    tSeamLo: { op: 'sub', in: ['tSeamWidth', 'tW'] },
    tSeamHi: { op: 'add', in: ['tSeamWidth', 'tW'] },
    tSeamS: { op: 'smoothstep', in: ['tSeamLo', 'tSeamHi', 'tDSk'] },
    tSeamIn: { op: 'oneMinus', in: ['tSeamS'] },
    tSeamF: { op: 'mul', in: ['tSeamIn', 'tFill'] },
    tNotRim: { op: 'oneMinus', in: ['tRimA'] },
    tSeamA: { op: 'mul', in: ['tSeamF', 'tNotRim'] },
    tSeamK0: { op: 'mul', in: ['tSeamA', 'tSeam'] },
    tSeamK: { op: 'oneMinus', in: ['tSeamK0'] },
    tTube: { op: 'mul', in: ['tTube0', 'tSeamK'] },
    tDN: { op: 'negate', in: ['tD'] },
    tOut: { op: 'max', in: ['tDN', 0] },
    tReach0: { op: 'mul', in: ['tFillSpread', 0.9] },
    tReach: { op: 'min', in: ['tHaloReach', 'tReach0'] },
    tFall: { op: 'mul', in: ['tReach', 0.35] },
    tOutN: { op: 'negate', in: ['tOut'] },
    tE0: { op: 'div', in: ['tOutN', 'tFall'] },
    tE: { op: 'exp', in: ['tE0'] },
    tReachH: { op: 'mul', in: ['tReach', 0.5] },
    tCut: { op: 'smoothstep', in: ['tReachH', 'tReach', 'tOut'] },
    tCutIn: { op: 'oneMinus', in: ['tCut'] },
    tNotFill: { op: 'oneMinus', in: ['tFill'] },
    tHalo0: { op: 'mul', in: ['tE', 'tCutIn'] },
    tHalo1: { op: 'mul', in: ['tHalo0', 'tNotFill'] },
    // the cell border fade (an atlas laid out on a grid; cell 0 = none)
    tUc: { op: 'div', in: ['uv', 'tCell'] },
    tUf: { op: 'fract', in: ['tUc'] },
    tUf2: { op: 'mul', in: ['tUf', 2] },
    tUq0: { op: 'sub', in: ['tUf2', 1] },
    tUq: { op: 'abs', in: ['tUq0'] },
    tUqx: { op: 'swizzle', in: ['tUq'], mask: 'x' },
    tUqy: { op: 'swizzle', in: ['tUq'], mask: 'y' },
    tUqm: { op: 'max', in: ['tUqx', 'tUqy'] },
    tBorder: { op: 'smoothstep', in: [0.82, 1, 'tUqm'] },
    tBorderIn: { op: 'oneMinus', in: ['tBorder'] },
    tHaloCell: { op: 'mul', in: ['tHalo1', 'tBorderIn'] },
    tCellX: { op: 'swizzle', in: ['tCell'], mask: 'x' },
    tHasCell: { op: 'gt', in: ['tCellX', 0] },
    tHalo: { op: 'select', in: ['tHasCell', 'tHaloCell', 'tHalo1'] },
    tLit: { op: 'mul', in: ['tTube', 'tFill'] },
    tHaloC0: { op: 'mul', in: ['tint', 'tHalo'] },
    tHaloC: { op: 'mul', in: ['tHaloC0', 'tHaloGain'] },
    tube: { op: 'add', in: ['tLit', 'tHaloC'] },
  };
}

/**
 * The emissive family as a graph preset (unlit): tint × colour map × vertex colours, through the tube when it has one,
 * × intensity × the look's gain × the flicker on the look's clock (`clock`, a param the runtime moves as the look ticks).
 * Throws for what IR version 1 cannot express: a sky, an additive blend, a fog share other than 1.
 */
export function emissiveGraph(params: EmissiveMaterialParams, look: EmissiveLookParams): GraphIr {
  const missing: string[] = [];
  if (params.sky !== null) missing.push('a sky (atan / asin, a screen-position input, back-face depth-off unfogged render state)');
  if (params.blend === 'additive') missing.push('an additive blend (no blend mode)');
  if (params.fog !== 1) missing.push(`a fog share of ${params.fog} (the fog epilogue is not a stage)`);
  if (missing.length > 0) throw new Error(`emissive preset: IR version 1 cannot express ${missing.join('; ')}`);
  const t = params.tube;
  const tubeParams: Record<string, GraphParam> = t === null ? {} : {
    field: { type: 'texture', value: t.field },
    fillSpread: { type: 'float', value: t.fillSpread }, skeletonSpread: { type: 'float', value: t.skeletonSpread },
    mono: { type: 'float', value: t.mono, min: 0, max: 1 }, radius: { type: 'float', value: t.radius, min: 0 },
    rim: { type: 'float', value: t.rim, min: 0 }, thicken: { type: 'float', value: t.thicken, min: -1, max: 1 },
    seam: { type: 'float', value: t.seam, min: 0, max: 1 }, seamWidth: { type: 'float', value: t.seamWidth, min: 0 },
    haloReach: { type: 'float', value: t.haloReach, min: 0 }, haloGain: { type: 'float', value: t.haloGain, min: 0 },
    core: { type: 'float', value: t.core, min: 0, max: 1 }, rimShade: { type: 'float', value: t.rimShade, min: 0, max: 1 },
    cell: { type: 'vec2', value: t.cell === null ? [0, 0] : [t.cell[0], t.cell[1]], min: 0, max: 1 },
  };
  const nodes: Record<string, GraphNode> = {
    uv: { op: 'uv' },
    colour: { op: 'param', param: 'colour' },
    ...(params.map === null ? { tinted: { op: 'mul', in: ['colour', 1] } } : {
      mapS: { op: 'texture', param: 'map', in: ['uv'] },
      mapC: { op: 'swizzle', in: ['mapS'], mask: 'xyz' },
      tinted: { op: 'mul', in: ['colour', 'mapC'] },
    }),
    ...(params.vertexColours ? { vc: { op: 'vertexColour' }, tint: { op: 'mul', in: ['tinted', 'vc'] } } : { tint: { op: 'mul', in: ['tinted', 1] } }),
    ...(t === null ? {} : tubeNodes()),
    // the flicker: a few beats a cycle drop to 8 % (famEmitFlick)
    seed: { op: 'param', param: 'flicker' },
    clock: { op: 'param', param: 'clock' },
    fRate0: { op: 'mul', in: ['seed', 2] },
    fRate: { op: 'add', in: ['fRate0', 0.9] },
    fT0: { op: 'mul', in: ['clock', 'fRate'] },
    fOff: { op: 'mul', in: ['seed', 57] },
    fT: { op: 'add', in: ['fT0', 'fOff'] },
    fTf: { op: 'floor', in: ['fT'] },
    fS13: { op: 'mul', in: ['seed', 13] },
    fNx: { op: 'add', in: ['fTf', 'fS13'] },
    ...hash11Nodes('fN', 'fNx'),
    fT14: { op: 'mul', in: ['fT', 14] },
    fT14f: { op: 'floor', in: ['fT14'] },
    fS7: { op: 'mul', in: ['seed', 7] },
    fMx: { op: 'add', in: ['fT14f', 'fS7'] },
    ...hash11Nodes('fM', 'fMx'),
    fBeat: { op: 'lt', in: ['fNout', 0.3] },
    fLow: { op: 'lt', in: ['fMout', 0.5] },
    fDip: { op: 'select', in: ['fLow', 0.08, 1] },
    fStutter: { op: 'select', in: ['fBeat', 'fDip', 1] },
    fSteady: { op: 'lte', in: ['seed', 0] },
    flick: { op: 'select', in: ['fSteady', 1, 'fStutter'] },
    intensity: { op: 'param', param: 'intensity' },
    gain: { op: 'param', param: 'gain' },
    lit0: { op: 'mul', in: [t === null ? 'tint' : 'tube', 'intensity'] },
    lit1: { op: 'mul', in: ['lit0', 'gain'] },
    out: { op: 'mul', in: ['lit1', 'flick'] },
  };
  return {
    version: GRAPH_IR_VERSION,
    kind: 'material',
    model: 'unlit',
    doubleSided: params.doubleSided,
    params: {
      colour: { type: 'colour', value: params.colour },
      ...(params.map === null ? {} : { map: { type: 'texture', value: params.map } }),
      intensity: { type: 'float', value: params.intensity, min: 0, max: 64 },
      gain: { type: 'float', value: look.gain, min: 0, max: 64 },
      flicker: { type: 'float', value: params.flicker, min: 0, max: 1000 },
      clock: { type: 'float', value: 0, min: 0 },
      ...tubeParams,
    },
    nodes,
    stages: { surface: { colour: 'out' } },
  };
}

/** a node: `op` over inputs */
const N = (op: string, ...ins: GraphRef[]): GraphNode => (ins.length === 0 ? { op } : { op, in: ins });
const SW = (src: GraphRef, mask: string): GraphNode => ({ op: 'swizzle', in: [src], mask });
const INV_PI = 1 / Math.PI;

/** the toon family's `famToonHash`: fract(p · (123.34, 456.21)), p += dot(p, p + 45.32), fract(p.x · p.y); result `<p>out` */
function toonHashNodes(p: string, x: GraphRef): Record<string, GraphNode> {
  return {
    [`${p}a`]: N('mul', x, [123.34, 456.21]), [`${p}b`]: N('fract', `${p}a`), [`${p}c`]: N('add', `${p}b`, 45.32),
    [`${p}d`]: N('dot', `${p}b`, `${p}c`), [`${p}e`]: N('add', `${p}b`, `${p}d`), [`${p}x`]: SW(`${p}e`, 'x'), [`${p}y`]: SW(`${p}e`, 'y'),
    [`${p}m`]: N('mul', `${p}x`, `${p}y`), [`${p}out`]: N('fract', `${p}m`),
  };
}
/** the toon family's `famToonNoise` (bilinear value noise, smooth-step weights) at `x`; result `<p>out` */
function toonNoiseNodes(p: string, x: GraphRef): Record<string, GraphNode> {
  return {
    [`${p}i`]: N('floor', x), [`${p}f`]: N('fract', x),
    [`${p}f2`]: N('mul', `${p}f`, 2), [`${p}f3`]: N('sub', 3, `${p}f2`), [`${p}ff`]: N('mul', `${p}f`, `${p}f`), [`${p}u`]: N('mul', `${p}ff`, `${p}f3`),
    [`${p}ux`]: SW(`${p}u`, 'x'), [`${p}uy`]: SW(`${p}u`, 'y'),
    [`${p}i10`]: N('add', `${p}i`, [1, 0]), [`${p}i01`]: N('add', `${p}i`, [0, 1]), [`${p}i11`]: N('add', `${p}i`, [1, 1]),
    ...toonHashNodes(`${p}h00`, `${p}i`), ...toonHashNodes(`${p}h10`, `${p}i10`), ...toonHashNodes(`${p}h01`, `${p}i01`), ...toonHashNodes(`${p}h11`, `${p}i11`),
    [`${p}m0`]: N('mix', `${p}h00out`, `${p}h10out`, `${p}ux`), [`${p}m1`]: N('mix', `${p}h01out`, `${p}h11out`, `${p}ux`),
    [`${p}out`]: N('mix', `${p}m0`, `${p}m1`, `${p}uy`),
  };
}

/**
 * The toon family as a graph preset (`families/toon.ts`): the look's numbers as params (`cloudTime` is the look's clock,
 * which the runtime moves as the look ticks), the surface's colour × vertex colours, and its light model in the
 * lighting stage. The caustics under a water level are in the program only when the look has a water level (the
 * family's `famToonCaustics`; the level and strength are the `water` param, so moving them moves no program).
 */
export function toonGraph(params: ToonMaterialParams, look: ToonLookParams): GraphIr {
  const level = look.caustics.level;
  return {
    version: GRAPH_IR_VERSION,
    kind: 'material',
    model: 'standard',
    doubleSided: params.doubleSided,
    flatShading: params.faceted,
    params: {
      colour: { type: 'colour', value: params.colour },
      roughness: { type: 'float', value: params.roughness, min: 0, max: 1 },
      metalness: { type: 'float', value: params.metalness, min: 0, max: 1 },
      face: { type: 'vec2', value: [...look.faceEdge] },
      shadowEdge: { type: 'vec2', value: [...look.shadowEdge] },
      grade: { type: 'vec2', value: [look.litGrade, look.shadeGrade], min: 0, max: 1 },
      lift: { type: 'vec3', value: [...look.lift], min: 0 },
      rim: { type: 'vec3', value: [...look.rim], min: 0 },
      terminator: { type: 'vec3', value: [...look.terminator], min: 0 },
      gloss: { type: 'float', value: look.glossBelow, min: 0, max: 1 },
      cloud: { type: 'vec4', value: [look.cloudShade.strength, look.cloudShade.scale, look.cloudShade.wind[0], look.cloudShade.wind[1]] },
      cloudTime: { type: 'float', value: 0, min: 0 },
      ...(level === null ? {} : { water: { type: 'vec2', value: [level, look.caustics.strength] } }),
    },
    nodes: {
      // the surface
      colourP: { op: 'param', param: 'colour' },
      ...(params.vertexColours ? { vc: N('vertexColour'), base: N('mul', 'colourP', 'vc') } : { base: N('mul', 'colourP', 1) }),
      rough: { op: 'param', param: 'roughness' }, metal: { op: 'param', param: 'metalness' },
      // the sun: two bands on N·L and on the shadow ratio
      nV: N('normalView'), lV: N('sunDirection'), vV: N('viewDirection'), sunC: N('sunColour'), shadow: N('sunShadow'), alb: N('albedo'),
      faceP: { op: 'param', param: 'face' }, shP: { op: 'param', param: 'shadowEdge' }, gradeP: { op: 'param', param: 'grade' },
      fe0: SW('faceP', 'x'), fe1: SW('faceP', 'y'), se0: SW('shP', 'x'), se1: SW('shP', 'y'), gx: SW('gradeP', 'x'), gy: SW('gradeP', 'y'),
      ndl: N('dot', 'nV', 'lV'), ndlS: N('saturate', 'ndl'),
      faceLit: N('smoothstep', 'fe0', 'fe1', 'ndl'), inSun: N('smoothstep', 'se0', 'se1', 'shadow'), band: N('mul', 'faceLit', 'inSun'),
      gxN: N('mul', 'gx', 'ndlS'), gx1: N('oneMinus', 'gx'), litGrade: N('add', 'gx1', 'gxN'),
      // the drifting cloud shade (famToonCloudShade): two octaves over the world xz, scrolled by the wind
      cloudP: { op: 'param', param: 'cloud' }, cTime: { op: 'param', param: 'cloudTime' },
      cStr: SW('cloudP', 'x'), cScale: SW('cloudP', 'y'), cWind: SW('cloudP', 'zw'),
      wPos: N('positionWorld'), wXZ: SW('wPos', 'xz'), cDrift: N('mul', 'cWind', 'cTime'), cAt: N('add', 'wXZ', 'cDrift'), cP: N('div', 'cAt', 'cScale'),
      ...toonNoiseNodes('n1', 'cP'),
      cP2a: N('mul', 'cP', 2.3), cP2: N('add', 'cP2a', 7.1),
      ...toonNoiseNodes('n2', 'cP2'),
      n1w: N('mul', 'n1out', 0.65), n2w: N('mul', 'n2out', 0.35), cN: N('add', 'n1w', 'n2w'),
      cS: N('smoothstep', 0.46, 0.68, 'cN'), cSs: N('mul', 'cStr', 'cS'), cloudShade: N('oneMinus', 'cSs'),
      // irradiance: the lit band graded by N·L under the cloud, the shade band's own share of the grade
      lit0: N('mul', 'band', 'litGrade'), lit1: N('mul', 'lit0', 'cloudShade'),
      band1: N('oneMinus', 'band'), shd0: N('mul', 'band1', 'gy'), shd1: N('mul', 'shd0', 'ndlS'), shd2: N('mul', 'shd1', 0.5),
      irrK: N('add', 'lit1', 'shd2'), ...(level === null ? { irr: N('mul', 'sunC', 'irrK') } : {
        irr0: N('mul', 'sunC', 'irrK'),
        // the caustics (famToonCaustics): filaments where two drifting noise fields cross, below the water level only
        waterP: { op: 'param', param: 'water' }, wLevel: SW('waterP', 'x'), wStr: SW('waterP', 'y'),
        wY: SW('wPos', 'y'), wD: N('sub', 'wLevel', 'wY'), under: N('gt', 'wD', 0),
        kP: N('mul', 'wXZ', 0.42), kT: N('mul', 'cTime', 0.55),
        kOffA: N('mul', [0.31, 0.17], 'kT'), kA: N('add', 'kP', 'kOffA'), ...toonNoiseNodes('ka', 'kA'),
        kP2: N('mul', 'kP', 1.63), kOffB: N('mul', [0.21, -0.29], 'kT'), kB0: N('sub', 'kP2', 'kOffB'), kB: N('add', 'kB0', 3.7), ...toonNoiseNodes('kb', 'kB'),
        kAB: N('sub', 'kaout', 'kbout'), kABa: N('abs', 'kAB'), kAB1: N('oneMinus', 'kABa'), kC: N('pow', 'kAB1', 9),
        kDs: N('smoothstep', 0.7, 1.8, 'wD'), kDe0: N('mul', 'wD', -0.18), kDe: N('exp', 'kDe0'),
        kV0: N('mul', 'kC', 'wStr'), kV1: N('mul', 'kV0', 'kDs'), kV: N('mul', 'kV1', 'kDe'), caustics: N('select', 'under', 'kV', 0),
        kL0: N('mul', 'band', 'cloudShade'), kL1: N('mul', 'kL0', 'caustics'), kL2: N('mul', 'sunC', [0.7, 1, 1.05]), kLight: N('mul', 'kL2', 'kL1'),
        irr: N('add', 'irr0', 'kLight'),
      }),
      // the terminator: a saturated albedo where a facet turns from the sun
      fl1: N('oneMinus', 'faceLit'), tm0: N('mul', 'faceLit', 'fl1'), tm1: N('mul', 'tm0', 'inSun'), term: N('mul', 'tm1', 4),
      ar: SW('alb', 'x'), ag: SW('alb', 'y'), ab: SW('alb', 'z'), agb: N('max', 'ag', 'ab'), amax: N('max', 'ar', 'agb'), amaxS: N('max', 'amax', 1e-3),
      alb2: N('mul', 'alb', 'alb'), satAlb: N('div', 'alb2', 'amaxS'),
      termP: { op: 'param', param: 'terminator' },
      d0: N('mul', 'alb', 'irr'), t0: N('mul', 'satAlb', 'termP'), t1: N('mul', 't0', 'term'), t2: N('mul', 't1', 'sunC'),
      d1: N('add', 'd0', 't2'), diffuse: N('mul', 'd1', INV_PI),
      // the banded rim on the lit side of vertical-ish faces
      ndv: N('dot', 'nV', 'vV'), ndvS: N('saturate', 'ndv'), ndv1: N('oneMinus', 'ndvS'), fres: N('smoothstep', 0.55, 0.8, 'ndv1'),
      // the rim's world normal is the shading normal's (the facet's under flatShading), as the family's inverseTransformDirection
      rimSide: N('smoothstep', -0.3, 0.2, 'ndl'), nW: N('viewToWorld', 'nV'), nWy: SW('nW', 'y'), nWya: N('abs', 'nWy'), rimVert: N('smoothstep', 0.85, 0.4, 'nWya'),
      r0: N('mul', 'fres', 'rimSide'), r1: N('mul', 'r0', 'shadow'), r2: N('mul', 'r1', 'cloudShade'), rimK: N('mul', 'r2', 'rimVert'),
      rimP: { op: 'param', param: 'rim' }, alb35: N('add', 'alb', 0.35),
      rc0: N('mul', 'rimP', 'rimK'), rc1: N('mul', 'rc0', 'sunC'), rc2: N('mul', 'rc1', INV_PI), rimC: N('mul', 'rc2', 'alb35'),
      sun: N('add', 'diffuse', 'rimC'),
      // the sun's specular only below the gloss roughness, on the lit band
      glossP: { op: 'param', param: 'gloss' }, glossy: N('lt', 'rough', 'glossP'), sunSpec: N('select', 'glossy', 'band', 0),
      // ambient: the irradiance plus the coloured lift, × albedo / π
      irrA: N('irradiance'), liftP: { op: 'param', param: 'lift' }, a0: N('add', 'irrA', 'liftP'), a1: N('mul', 'a0', 'alb'), ambient: N('mul', 'a1', INV_PI),
    },
    stages: {
      surface: { colour: 'base', roughness: 'rough', metalness: 'metal' },
      lighting: { sun: 'sun', sunSpecular: 'sunSpec', ambient: 'ambient' },
    },
  };
}

/**
 * The painterly family as a graph preset (`families/painterly.ts`): soft cel bands, the painted shade, the warm
 * terminator, the rim on the sun's side, the painted floor, wetness and (when the look grades) the per-pixel grade after
 * lighting. Diffuse only: no specular, as the family's Lambert base. A swaying surface (`sway > 0`) gets the family's
 * wind sway as its vertex offset: the phase from the object's (instance's) origin and the look's clock (`swayTime`, a
 * param the runtime moves as the look ticks), the amount from the geometry's own height, the direction the look's wind
 * brought into model space and divided by its squared length, as the family does. No shadow variant: the family's
 * shadow does not sway either.
 */
export function painterlyGraph(params: PainterlyMaterialParams, look: PainterlyLookParams): GraphIr {
  const g = look.grade;
  const [wx, wz] = look.wind.direction, wl = Math.hypot(wx, wz) || 1;
  const sway = params.sway > 0;
  return {
    version: GRAPH_IR_VERSION,
    kind: 'material',
    model: 'standard',
    doubleSided: params.doubleSided,
    params: {
      colour: { type: 'colour', value: params.colour },
      ...(params.map === null ? {} : { map: { type: 'texture', value: params.map } }),
      emissive: { type: 'colour', value: params.emissive },
      emissiveIntensity: { type: 'float', value: params.emissiveIntensity, min: 0, max: 64 },
      rimAmt: { type: 'float', value: params.rim, min: 0, max: 1 },
      bands: { type: 'float', value: params.bands, min: 0, max: 1 },
      shadeAmt: { type: 'float', value: params.shade, min: 0, max: 1 },
      floorAmt: { type: 'float', value: params.floor, min: 0, max: 1 },
      shade: { type: 'vec3', value: [...look.shade], min: 0 },
      rim: { type: 'vec3', value: [...look.rim], min: 0 },
      warm: { type: 'float', value: look.warm, min: 0, max: 4 },
      floor: { type: 'float', value: look.floor, min: 0, max: 16 },
      wet: { type: 'float', value: look.wet, min: 0, max: 1 },
      ...(!sway ? {} : {
        sway: { type: 'float', value: params.sway, min: 0, max: 1 },
        wind: { type: 'vec3', value: [wx / wl, wz / wl, look.wind.strength] },
        swayTime: { type: 'float', value: 0, min: 0 },
      }),
      ...(g === null ? {} : {
        gradeA: { type: 'vec4', value: [g.gain * g.exposure, 1 / g.shoulder, g.saturation, g.contrast] },
        shadowTint: { type: 'vec3', value: [...g.shadowTint], min: 0 },
        lightTint: { type: 'vec3', value: [...g.lightTint], min: 0 },
        gradeB: { type: 'vec3', value: [g.split[0], g.split[1], g.lookSaturation] },
      }),
    },
    nodes: {
      // the surface: colour × map × vertex colours, the emissive
      uv: N('uv'), colourP: { op: 'param', param: 'colour' },
      ...(params.map === null ? { tinted: N('mul', 'colourP', 1) } : { mapS: { op: 'texture', param: 'map', in: ['uv'] }, mapC: SW('mapS', 'xyz'), mapA: SW('mapS', 'w'), tinted: N('mul', 'colourP', 'mapC') }),
      ...(params.vertexColours ? { vc: N('vertexColour'), base: N('mul', 'tinted', 'vc') } : { base: N('mul', 'tinted', 1) }),
      emP: { op: 'param', param: 'emissive' }, emI: { op: 'param', param: 'emissiveIntensity' }, emissive: N('mul', 'emP', 'emI'),
      // the sun through the three-band ramp (famPaintCel)
      nV: N('normalView'), lV: N('sunDirection'), vV: N('viewDirection'), sunC: N('sunColour'), vis: N('sunShadow'), alb: N('albedo'),
      ndl: N('dot', 'nV', 'lV'), ndlS: N('saturate', 'ndl'), x: N('mul', 'ndlS', 'vis'),
      c0: N('smoothstep', 0.03, 0.13, 'x'), c1: N('smoothstep', 0.34, 0.5, 'x'), c0w: N('mul', 'c0', 0.52), c1w: N('mul', 'c1', 0.48), cel: N('add', 'c0w', 'c1w'),
      bandsP: { op: 'param', param: 'bands' }, l: N('mix', 'x', 'cel', 'bandsP'),
      // the painted shade where the sun does not reach
      shadeP: { op: 'param', param: 'shade' }, shadeAmtP: { op: 'param', param: 'shadeAmt' },
      l1: N('oneMinus', 'l'), sh0: N('mul', 'shadeP', 'l1'), sh1: N('mul', 'sh0', 'shadeAmtP'), lit: N('mul', 'sunC', 'l'), irr0: N('add', 'lit', 'sh1'),
      // the warm band past the terminator, keyed by how warm the sun is
      pt0: N('smoothstep', 0.02, 0.2, 'l'), pt1: N('smoothstep', 0.45, 0.85, 'l'), pt2: N('oneMinus', 'pt1'), pTerm: N('mul', 'pt0', 'pt2'),
      sR: SW('sunC', 'x'), sB: SW('sunC', 'z'), sRB: N('sub', 'sR', 'sB'), sRm: N('max', 'sR', 1e-3), wk0: N('div', 'sRB', 'sRm'), wk1: N('mul', 'wk0', 4), warmKey: N('saturate', 'wk1'),
      warmP: { op: 'param', param: 'warm' }, wm0: N('mul', 'pTerm', 'warmP'), wm1: N('mul', 'wm0', 'warmKey'),
      warmTint: N('mix', [1, 1, 1], [1.16, 0.98, 0.8], 'wm1'), irr: N('mul', 'irr0', 'warmTint'),
      // wetness: darker paint on what faces the sky, and a tight highlight
      wetP: { op: 'param', param: 'wet' }, nW: N('normalWorld'), nWy: SW('nW', 'y'), wu: N('smoothstep', 0.1, 0.75, 'nWy'), wu7: N('mul', 'wu', 0.7), wu3: N('add', 'wu7', 0.3), wetK: N('mul', 'wetP', 'wu3'),
      wd0: N('mul', 'wetK', 0.38), wd1: N('oneMinus', 'wd0'), albW: N('mul', 'alb', 'wd1'), albWpi: N('mul', 'albW', INV_PI),
      dif: N('mul', 'irr', 'albWpi'),
      hv0: N('add', 'lV', 'vV'), hv: N('normalize', 'hv0'), ndh: N('dot', 'nV', 'hv'), ndhS: N('saturate', 'ndh'), spk: N('pow', 'ndhS', 120),
      ws0: N('mul', 'sunC', 'vis'), ws1: N('mul', 'ws0', 'spk'), ws2: N('mul', 'ws1', 'wetK'), wetSpec: N('mul', 'ws2', 0.6),
      // the rim on the sun's side of the silhouette (the family adds it as emissive; one sun, so here)
      ndv: N('dot', 'nV', 'vV'), ndvS: N('saturate', 'ndv'), ndv1: N('oneMinus', 'ndvS'), fres: N('pow', 'ndv1', 3),
      vNeg: N('negate', 'vV'), back0: N('dot', 'vNeg', 'lV'), back: N('saturate', 'back0'), side0: N('mul', 'ndl', 0.5), side1: N('add', 'side0', 0.5), side: N('saturate', 'side1'),
      rf: N('smoothstep', 0.25, 0.75, 'fres'), rb0: N('mul', 'back', 0.65), rb: N('add', 'rb0', 0.35), rk0: N('mul', 'rf', 'rb'), rk1: N('mul', 'rk0', 'side'),
      rimAmtP: { op: 'param', param: 'rimAmt' }, rimK: N('mul', 'rk1', 'rimAmtP'), rimP: { op: 'param', param: 'rim' },
      albHalf: N('mix', 'alb', [1, 1, 1], 0.5), rc0: N('mul', 'rimP', 'albHalf'), rimC: N('mul', 'rc0', 'rimK'),
      sun0: N('add', 'dif', 'wetSpec'), sun: N('add', 'sun0', 'rimC'),
      // ambient: the irradiance on the wet paint, a wet sheen, the painted floor under dark albedo. The irradiance takes
      // the environment's diffuse as the family's Lambert base does (three adds the sky's PMREM irradiance to it)
      irrL: N('irradiance'), irrE: N('environmentIrradiance'), irrA: N('add', 'irrL', 'irrE'), a0: N('mul', 'irrA', 'albWpi'),
      fr5: N('pow', 'ndv1', 5), a1a: N('mul', 'irrA', 'fr5'), a1b: N('mul', 'a1a', 'wetK'), a1: N('mul', 'a1b', 0.07),
      floorP: { op: 'param', param: 'floor' }, floorAmtP: { op: 'param', param: 'floorAmt' },
      fl0: N('sub', [0.22, 0.22, 0.22], 'alb'), fl1: N('max', 'fl0', 0), fl2: N('mul', 'fl1', INV_PI), fl3: N('mul', 'shadeP', 'floorP'), fl4: N('mul', 'fl3', 'floorAmtP'), a2: N('mul', 'fl4', 'fl2'),
      am0: N('add', 'a0', 'a1'), ambient: N('add', 'am0', 'a2'),
      ...(!sway ? {} : {
        // the wind sway (VERT_SWAY): two sines on a per-object phase, × the squared height above the origin
        swayP: { op: 'param', param: 'sway' }, windP: { op: 'param', param: 'wind' }, swT: { op: 'param', param: 'swayTime' },
        oW: N('objectOrigin'), oX: SW('oW', 'x'), oZ: SW('oW', 'z'),
        ph0: N('mul', 'swT', 1.6), ph1: N('mul', 'oX', 0.13), ph2: N('mul', 'oZ', 0.11), ph3: N('add', 'ph0', 'ph1'), ph: N('add', 'ph3', 'ph2'),
        pG: N('positionGeometry'), pGy: SW('pG', 'y'), pH: N('max', 'pGy', 0), pH2: N('mul', 'pH', 'pH'),
        wdX: SW('windP', 'x'), wdZ: SW('windP', 'y'), wStr: SW('windP', 'z'),
        sk0: N('mul', 'swayP', 'wStr'), sk: N('mul', 'sk0', 'pH2'),
        s1: N('sin', 'ph'), s1k: N('mul', 's1', 0.35), s1a: N('add', 's1k', 0.65), amt1: N('mul', 'sk', 's1a'),
        ph23: N('mul', 'ph', 2.3), ph2b: N('add', 'ph23', 1.7), s2: N('sin', 'ph2b'), sk25: N('mul', 'sk', 0.25), amt2: N('mul', 'sk25', 's2'),
        amt: N('add', 'amt1', 'amt2'),
        wDir: N('combine', 'wdX', 0, 'wdZ'), pD0: N('worldToLocal', 'wDir'), pDd: N('dot', 'pD0', 'pD0'), pDm: N('max', 'pDd', 1e-6), pD: N('div', 'pD0', 'pDm'),
        swayOffset: N('mul', 'pD', 'amt'),
      }),
      ...(g === null ? {} : {
        // the grade (famPaintGrade): exposure, the filmic shoulder, saturation, the split tint, the S-curve, the hour's saturation
        litC: N('litColour'), gA: { op: 'param', param: 'gradeA' }, gB: { op: 'param', param: 'gradeB' },
        sT: { op: 'param', param: 'shadowTint' }, lT: { op: 'param', param: 'lightTint' },
        gAx: SW('gA', 'x'), gAy: SW('gA', 'y'), gAz: SW('gA', 'z'), gAw: SW('gA', 'w'), gBx: SW('gB', 'x'), gBy: SW('gB', 'y'), gBz: SW('gB', 'z'),
        gx0: N('max', 'litC', 0), gx: N('mul', 'gx0', 'gAx'),
        gs0: N('mul', 'gx', 'gAy'), gs1: N('add', 'gs0', 1), gs2: N('mul', 'gx', 'gs1'), gs3: N('add', 'gx', 1), gc: N('div', 'gs2', 'gs3'),
        gl: N('dot', 'gc', [0.2126, 0.7152, 0.0722]), gsat: N('mix', 'gl', 'gc', 'gAz'),
        gsp: N('smoothstep', 'gBx', 'gBy', 'gl'), gtint: N('mix', 'sT', 'lT', 'gsp'), gt: N('mul', 'gsat', 'gtint'), gcl: N('saturate', 'gt'),
        gq0: N('mul', 'gcl', 2), gq1: N('sub', 3, 'gq0'), gq2: N('mul', 'gcl', 'gcl'), gq3: N('mul', 'gq2', 'gq1'), gq4: N('mul', 'gq3', 'gAw'),
        gw1: N('oneMinus', 'gAw'), gq5: N('mul', 'gcl', 'gw1'), gS: N('add', 'gq4', 'gq5'),
        gl2: N('dot', 'gS', [0.2126, 0.7152, 0.0722]), graded: N('mix', 'gl2', 'gS', 'gBz'),
      }),
    },
    stages: {
      surface: {
        colour: 'base', emissive: 'emissive', roughness: 1, metalness: 0,
        ...(params.map !== null && params.alphaCutoff > 0 ? { alpha: 'mapA', alphaCutoff: params.alphaCutoff } : {}),
      },
      lighting: { sun: 'sun', ambient: 'ambient', ...(g === null ? {} : { grade: 'graded' }) },
      ...(!sway ? {} : { 'vertex.offset': { offset: 'swayOffset' } }),
    },
  };
}

/** the family looks a preset reads (the shard's own `look.familyLooks`, defaults filled) */
export interface PresetLooks { readonly toon: ToonLookParams; readonly painterly: PainterlyLookParams; readonly emissive: EmissiveLookParams }
/** the clock params a preset's runtime moves as its family look ticks (seconds since the material was made) */
export const PRESET_CLOCK_PARAMS: readonly string[] = Object.freeze(['cloudTime', 'swayTime', 'clock']);

/**
 * The engine-owned, immutable preset reference (SF59, C4-R1-B9): a material that names a built-in preset carries a
 * family entry, and this is the only door from that entry to graph IR. Content never supplies the preset's nodes, so the
 * program compiles under `PRESET_GRAPH_BUDGET`, not the author caps. Throws with `presetRefusal`'s reason for an entry IR
 * version 1 cannot express (admission refuses the same entries with the same rule).
 */
export function familyPresetGraph(entry: FamilyMaterialParams, looks: PresetLooks): GraphIr {
  const refusal = presetRefusal(entry);
  if (refusal !== null) throw new Error(refusal);
  if (entry.family === 'toon') return toonGraph(entry, looks.toon);
  if (entry.family === 'painterly') return painterlyGraph(entry, looks.painterly);
  if (entry.family === 'emissive') return emissiveGraph(entry, looks.emissive);
  if (entry.measure === null) throw new Error('pbr preset: no measure layer');
  return pbrMeasureGraph(entry, entry.measure);
}
