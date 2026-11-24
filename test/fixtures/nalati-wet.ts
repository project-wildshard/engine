import { liveGeographyBlock } from './liveGeography';

const bytes=liveGeographyBlock('data/geography-wet.bin');
export const nalatiWetBlock={file:'data/geography-wet.bin',bytes};
/** Test-only predecessor transport; the independent full metadata and byte hashes remain pinned. */
export const originalNalatiWet=Buffer.from(nalatiWetBlock.bytes).toString('base64');
