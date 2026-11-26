import type { MemoryReport, MemoryPose } from './memory-report-data.mjs';
/** Domain colours / canonical HUD shard accents, with hatched unattributed storage. */
export function memoryOwnerColour(owner:string):string;
/** Standalone 1179x2556 portrait SVG; the WC+GL cap gauge never adds the storage inventory. */
export function memoryInfographic(report:MemoryReport,pose:MemoryPose):string;
