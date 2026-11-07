/** The arena room's admitted rows (P1-E4.2): the room and its portal as data, read by the page's view half and the fight's
 *  server half alike. No owner, scene or callback lives here. */
import * as v from 'valibot';
import type { CombatTag } from '@wildshard/engine/combat/pipeline';
import { CreatureStrikeSchema } from '@wildshard/format/creatures';

const finite = v.pipe(v.number(), v.finite());
const positive = v.pipe(finite, v.minValue(Number.MIN_VALUE));
const rowId = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const triple = v.tuple([finite,finite,finite]);
const planarPoint = v.strictObject({ x: finite, z: finite });
const box = v.strictObject({ x: finite, z: finite, hw: finite, hd: finite, rot: finite, yTop: finite, yBottom: finite });
const list = <S extends v.GenericSchema>(schema: S) => v.pipe(v.array(schema), v.maxLength(256));
export const ArenaRoomPortalSchema: v.GenericSchema<BoundedArenaPortalInput, BoundedArenaPortal> = v.strictObject({
  signal: rowId, spawn: v.strictObject({ x: finite, z: finite, yaw: finite }), end: finite,
  exitOffset: finite, slow: v.pipe(finite, v.minValue(0), v.maxValue(1)),
  fade: v.strictObject({ out: finite, hold: finite, in: finite }),
  keep: rowId, near: finite, floor: v.strictObject({ tolerance: finite, depth: finite }),
});
/** Data admission precedes any scene or physics allocation. */
export const ArenaRoomSchema: v.GenericSchema<BoundedArenaRoomInput, BoundedArenaRoom> = v.strictObject({
 id: rowId, name: rowId, file: rowId, sealId: rowId, sealName: rowId,
 origin: v.strictObject({ x: finite, y: finite, z: finite }),
 halfWidth: positive, corridorHalfWidth: positive, corridorEnd: positive,
 doorHalfWidth: positive, doorHeight: positive, sandCells: v.pipe(positive, v.integer(), v.maxValue(256)), sandColor: rowId, triangles: finite,
 cover: v.strictObject({ x: finite, z: finite, wid: positive, len: positive, plinthH: finite, h: finite }), pedestal: planarPoint,
 beams: list(v.strictObject({ a: planarPoint, b: planarPoint, r: positive })),
 collision: v.strictObject({ boxes: list(box), descs: list(v.unknown()) }),
 glowColor: triple, beamTop: triple, coverMotion: v.strictObject({ closed: triple, slide: triple, tip: triple, slideRotation: triple, tipRotation: triple }),
 markers: list(rowId), shafts: list(v.strictObject({ id: rowId, base: finite })),
 streams: list(v.strictObject({ id: rowId, tell: rowId, x: finite, z: finite })),
 lid: rowId, heap: rowId, sand: rowId, flames: rowId, rings: list(rowId), beam: rowId, line: rowId, dome: rowId, arc: rowId, seal: rowId,
 view: v.strictObject({ scene: v.unknown(), static: v.unknown(), fx: list(v.strictObject({ id: rowId, mode: finite,
  color: v.tuple([finite,finite,finite]), alpha: finite, additive: v.boolean(), depthTest: v.boolean(), p: v.tuple([finite,finite,finite,finite]) })) }),
});
/** The portal as admitted. */
export type ArenaRoomPortalRows = v.InferOutput<typeof ArenaRoomPortalSchema>;
/** Baked scene ids, local placement and walkable surfaces; no executable hooks. */
export type ArenaRoomRows = v.InferOutput<typeof ArenaRoomSchema>;

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedArenaPortalInput = BoundedArenaPortal;
interface BoundedArenaPortalFields {
    signal: string;
    spawn: {
        x: number;
        z: number;
        yaw: number;
    };
    end: number;
    exitOffset: number;
    slow: number;
    fade: {
        out: number;
        hold: number;
        in: number;
    };
    keep: string;
    near: number;
    floor: {
        tolerance: number;
        depth: number;
    };
}
type BoundedArenaPortal = { [Key in keyof BoundedArenaPortalFields]: BoundedArenaPortalFields[Key] };
type BoundedArenaRoomInput = BoundedArenaRoom;
interface BoundedArenaRoomFields {
    id: string;
    name: string;
    file: string;
    sealId: string;
    sealName: string;
    origin: {
        x: number;
        y: number;
        z: number;
    };
    halfWidth: number;
    corridorHalfWidth: number;
    corridorEnd: number;
    doorHalfWidth: number;
    doorHeight: number;
    sandCells: number;
    sandColor: string;
    triangles: number;
    cover: {
        x: number;
        z: number;
        wid: number;
        len: number;
        plinthH: number;
        h: number;
    };
    pedestal: {
        x: number;
        z: number;
    };
    beams: {
        a: {
            x: number;
            z: number;
        };
        b: {
            x: number;
            z: number;
        };
        r: number;
    }[];
    collision: {
        boxes: {
            x: number;
            z: number;
            hw: number;
            hd: number;
            rot: number;
            yTop: number;
            yBottom: number;
        }[];
        descs: unknown[];
    };
    glowColor: [
        number,
        number,
        number
    ];
    beamTop: [
        number,
        number,
        number
    ];
    coverMotion: {
        closed: [
            number,
            number,
            number
        ];
        slide: [
            number,
            number,
            number
        ];
        tip: [
            number,
            number,
            number
        ];
        slideRotation: [
            number,
            number,
            number
        ];
        tipRotation: [
            number,
            number,
            number
        ];
    };
    markers: string[];
    shafts: {
        id: string;
        base: number;
    }[];
    streams: {
        id: string;
        tell: string;
        x: number;
        z: number;
    }[];
    lid: string;
    heap: string;
    sand: string;
    flames: string;
    rings: string[];
    beam: string;
    line: string;
    dome: string;
    arc: string;
    seal: string;
    view: {
        scene: unknown;
        static: unknown;
        fx: {
            id: string;
            mode: number;
            color: [
                number,
                number,
                number
            ];
            alpha: number;
            additive: boolean;
            depthTest: boolean;
            p: [
                number,
                number,
                number,
                number
            ];
        }[];
    };
}
type BoundedArenaRoom = { [Key in keyof BoundedArenaRoomFields]: BoundedArenaRoomFields[Key] };
export const ArenaFightPageSchema: v.GenericSchema<BoundedArenaFightInput, BoundedArenaFight> = v.strictObject({
  profile: v.unknown(), body: rowId, identity: v.picklist(['runtime', 'declared']),
  add: v.strictObject({ kind: rowId, variant: rowId, memory: v.record(rowId, finite) }),
  damageTag: v.custom<CombatTag>(value => typeof value === 'string' && /^[a-z][a-zA-Z0-9.-]*\.[a-zA-Z0-9.*-]+$/u.test(value)),
  maxZ: finite, reward: triple, respawn: triple, yaw: finite,
  presentation: v.strictObject({ reach: finite, ringMax: finite, beamRadius: finite }),
  cuts: v.pipe(v.array(CreatureStrikeSchema), v.minLength(1), v.maxLength(16)),
  hazards: v.record(rowId, CreatureStrikeSchema),
});
type BoundedArenaFightInput = BoundedArenaFight;
interface BoundedArenaFightFields {
    profile: unknown;
    body: string;
    identity: "runtime" | "declared";
    add: {
        kind: string;
        variant: string;
        memory: Record<string, number>;
    };
    damageTag: `${string}.${string}`;
    maxZ: number;
    reward: [
        number,
        number,
        number
    ];
    respawn: [
        number,
        number,
        number
    ];
    yaw: number;
    presentation: {
        reach: number;
        ringMax: number;
        beamRadius: number;
    };
    cuts: {
        id: string;
        shape: {
            kind: "arc";
            radius: number;
            halfAngle: number;
            yawOffset?: number;
        } | {
            kind: "lane";
            length: number;
            width: number;
        } | {
            kind: "ring";
            inner: number;
            outer: number;
        } | {
            kind: "wedge";
            length: number;
            halfAngle: number;
        } | {
            kind: "point";
            radius: number;
            exclusive?: boolean;
        } | {
            kind: "sphere";
            radius: number;
        };
        windup: number;
        active: number;
        recover: number;
        cooldown: number;
        range: number | null;
        damage: number;
        tags: `${string}.${string}`[];
        weight: {
            kind: "constant";
            value: number;
        } | {
            kind: "horizontal-distance";
            above: number;
            far: number;
            near: number;
        };
        units?: "world" | "actor";
        alternatives?: ({
            kind: "arc";
            radius: number;
            halfAngle: number;
            yawOffset?: number;
        } | {
            kind: "lane";
            length: number;
            width: number;
        } | {
            kind: "ring";
            inner: number;
            outer: number;
        } | {
            kind: "wedge";
            length: number;
            halfAngle: number;
        } | {
            kind: "point";
            radius: number;
            exclusive?: boolean;
        } | {
            kind: "sphere";
            radius: number;
        })[];
        motion?: {
            speed?: number;
            delay?: number;
            track?: "none" | "lead" | "follow";
            overshoot?: number;
            skid?: number;
        };
        eligibility?: {
            maxDy?: number;
            jumpDodges?: boolean;
        };
    }[];
    hazards: Record<string, {
            id: string;
            shape: {
                kind: "arc";
                radius: number;
                halfAngle: number;
                yawOffset?: number;
            } | {
                kind: "lane";
                length: number;
                width: number;
            } | {
                kind: "ring";
                inner: number;
                outer: number;
            } | {
                kind: "wedge";
                length: number;
                halfAngle: number;
            } | {
                kind: "point";
                radius: number;
                exclusive?: boolean;
            } | {
                kind: "sphere";
                radius: number;
            };
            windup: number;
            active: number;
            recover: number;
            cooldown: number;
            range: number | null;
            damage: number;
            tags: `${string}.${string}`[];
            weight: {
                kind: "constant";
                value: number;
            } | {
                kind: "horizontal-distance";
                above: number;
                far: number;
                near: number;
            };
            units?: "world" | "actor";
            alternatives?: ({
                kind: "arc";
                radius: number;
                halfAngle: number;
                yawOffset?: number;
            } | {
                kind: "lane";
                length: number;
                width: number;
            } | {
                kind: "ring";
                inner: number;
                outer: number;
            } | {
                kind: "wedge";
                length: number;
                halfAngle: number;
            } | {
                kind: "point";
                radius: number;
                exclusive?: boolean;
            } | {
                kind: "sphere";
                radius: number;
            })[];
            motion?: {
                speed?: number;
                delay?: number;
                track?: "none" | "lead" | "follow";
                overshoot?: number;
                skid?: number;
            };
            eligibility?: {
                maxDy?: number;
                jumpDodges?: boolean;
            };
        }>;
}
export type BoundedArenaFight = { [Key in keyof BoundedArenaFightFields]: BoundedArenaFightFields[Key] };
