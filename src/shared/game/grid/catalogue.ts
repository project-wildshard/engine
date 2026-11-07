import * as v from 'valibot';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { GRID_RADIUS, GRID_CELL_COUNT } from '@wildshard/format/contentBounds';
import { AccentSchema } from '@wildshard/format/accent';

const id = v.pipe(v.string(), v.regex(/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u));
const signed = v.pipe(v.number(), v.integer(), v.minValue(-GRID_RADIUS), v.maxValue(GRID_RADIUS));
const local = v.pipe(v.number(), v.finite(), v.minValue(-250), v.maxValue(250));
/** one number panel: a cell-local spot (metres, x east, y up, z north) on the copy's own structures, facing `yaw` (0 = +z) */
const mark = v.strictObject({ x: local, y: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(250)), z: local, yaw: v.pipe(v.number(), v.finite()), size: v.pipe(v.number(), v.minValue(0.5), v.maxValue(12)) });
/**
 * Playtest 1 (SF52 / G220): a shared product's copy identity, data only. Its HUD accent inside the cell and where its
 * number stands (copyIdentity.ts), and optionally its layout: a seed and the plots it fills with its own landmarks
 * (copyLayout.ts); the copies keep sharing one product's bytes.
 */
/** one copy plot: a clear, level square its product leaves (centre and half-size, metres), filled by the copy's layout */
const copyPlot = v.strictObject({ x: local, z: local, half: v.pipe(v.number(), v.finite(), v.minValue(16), v.maxValue(40)) });
/** G220 pass 2: the copy's layout, a seed and its plots; the seed picks each plot's landmark (copyLayout.ts) */
const layout = v.strictObject({ seed: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2 ** 31 - 1)), plots: v.pipe(v.array(copyPlot), v.maxLength(8)) });
const identity: v.GenericSchema<BoundedCopyIdentityInput, BoundedCopyIdentity> = v.strictObject({ accent: AccentSchema, marks: v.pipe(v.array(mark), v.maxLength(8)), layout: v.optional(layout) });
const edgeLook: v.GenericSchema<BoundedGridEdgeLookInput, BoundedGridEdgeLook> = v.strictObject({ height: v.pipe(v.number(), v.finite(), v.minValue(0.5), v.maxValue(7)) });
const placement = v.strictObject({ instance: id, slug: id, cell: v.tuple([signed, signed]), identity: v.optional(identity), edgeLook: v.exactOptional(edgeLook), speedClass: v.exactOptional(v.literal('road')) });
const channel = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));
const colour = v.tuple([channel, channel, channel]);
const distance = v.pipe(v.number(), v.finite(), v.minValue(0));
/** Platform placement data, independent of package content and standalone shard coordinates. */
export const GridCatalogueSchema: v.GenericSchema<BoundedGridCatalogueInput, BoundedGridCatalogue> = v.pipe(v.strictObject({ version: v.literal(0), pitch: v.literal(CONTENT_CAPS.pitch),
  cells: v.pipe(v.array(placement), v.minLength(1), v.maxLength(GRID_CELL_COUNT)),
  emptyNeighbour: v.strictObject({ kind: v.literal('sea'), level: v.literal(0), edgeColour: colour,
    fog: v.pipe(v.strictObject({ colour, near: distance, far: distance }), v.check((row) => row.far > row.near, 'increasing fog distance')) }),
}), v.check((rows) => {
  const valid = (entries: readonly { instance: string; cell: readonly [number, number] }[]): boolean => new Set(entries.map((row) => row.instance)).size === entries.length && new Set(entries.map((row) => row.cell.join(','))).size === entries.length;
  // One complete layout fills every cell for every audience (G972).
  const base = rows.cells;
  return valid(base) && base.length === GRID_CELL_COUNT;
}, 'unique stable instance identities and complete signed cell layout'));
/** Admitted assembly input; a cell remains a mutable placement attribute, never a save namespace. */
export type GridCatalogue = v.InferOutput<typeof GridCatalogueSchema>;
/** A copy's declared identity: its accent and its number panels (copyIdentity.ts). */
export type CopyIdentity = v.InferOutput<typeof identity>;
/** Placement-only curtain appearance; collision and readiness keep their independent rules. */
export type GridEdgeLook = v.InferOutput<typeof edgeLook>;
/** Compatibility entry-accounting flags only; all audiences and build modes read one cell catalogue (G972). */
export interface GridMode { developer: boolean; devserver: boolean; nineDragon?: boolean }
/** Reject malformed or duplicate placement data before allocating an assembly. */
export function parseGridCatalogue(input: unknown): GridCatalogue { return v.parse(GridCatalogueSchema, input); }

/** Complete admitted data, independent of validator implementation metadata. */
interface BoundedCopyIdentityInputFields {
    accent: string;
    marks: {
        x: number;
        y: number;
        z: number;
        yaw: number;
        size: number;
    }[];
    layout?: {
        seed: number;
        plots: {
            x: number;
            z: number;
            half: number;
        }[];
    } | undefined;
}
type BoundedCopyIdentityInput = { [Key in keyof BoundedCopyIdentityInputFields]: BoundedCopyIdentityInputFields[Key] };
interface BoundedCopyIdentityFields {
    accent: "ember" | "coral" | "tangerine" | "apricot" | "marigold" | "citron" | "lime" | "moss" | "jade" | "mint" | "teal" | "azure" | "cornflower" | "periwinkle" | "iris" | "lilac" | "orchid" | "pink" | "rose" | "sand";
    marks: {
        x: number;
        y: number;
        z: number;
        yaw: number;
        size: number;
    }[];
    layout?: {
        seed: number;
        plots: {
            x: number;
            z: number;
            half: number;
        }[];
    } | undefined;
}
type BoundedCopyIdentity = { [Key in keyof BoundedCopyIdentityFields]: BoundedCopyIdentityFields[Key] };
type BoundedGridEdgeLookInput = BoundedGridEdgeLook;
interface BoundedGridEdgeLookFields {
    height: number;
}
type BoundedGridEdgeLook = { [Key in keyof BoundedGridEdgeLookFields]: BoundedGridEdgeLookFields[Key] };
interface BoundedGridCatalogueInputFields {
    version: 0;
    pitch: 562.5;
    cells: {
        instance: string;
        slug: string;
        cell: [
            number,
            number
        ];
        identity?: {
            accent: string;
            marks: {
                x: number;
                y: number;
                z: number;
                yaw: number;
                size: number;
            }[];
            layout?: {
                seed: number;
                plots: {
                    x: number;
                    z: number;
                    half: number;
                }[];
            } | undefined;
        } | undefined;
        edgeLook?: {
            height: number;
        };
        speedClass?: 'road';
    }[];
    emptyNeighbour: {
        kind: "sea";
        level: 0;
        edgeColour: [
            number,
            number,
            number
        ];
        fog: {
            colour: [
                number,
                number,
                number
            ];
            near: number;
            far: number;
        };
    };
}
type BoundedGridCatalogueInput = { [Key in keyof BoundedGridCatalogueInputFields]: BoundedGridCatalogueInputFields[Key] };
interface BoundedGridCatalogueFields {
    version: 0;
    pitch: 562.5;
    cells: {
        instance: string;
        slug: string;
        cell: [
            number,
            number
        ];
        identity?: {
            accent: "ember" | "coral" | "tangerine" | "apricot" | "marigold" | "citron" | "lime" | "moss" | "jade" | "mint" | "teal" | "azure" | "cornflower" | "periwinkle" | "iris" | "lilac" | "orchid" | "pink" | "rose" | "sand";
            marks: {
                x: number;
                y: number;
                z: number;
                yaw: number;
                size: number;
            }[];
            layout?: {
                seed: number;
                plots: {
                    x: number;
                    z: number;
                    half: number;
                }[];
            } | undefined;
        } | undefined;
        edgeLook?: {
            height: number;
        };
        speedClass?: 'road';
    }[];
    emptyNeighbour: {
        kind: "sea";
        level: 0;
        edgeColour: [
            number,
            number,
            number
        ];
        fog: {
            colour: [
                number,
                number,
                number
            ];
            near: number;
            far: number;
        };
    };
}
type BoundedGridCatalogue = { [Key in keyof BoundedGridCatalogueFields]: BoundedGridCatalogueFields[Key] };
