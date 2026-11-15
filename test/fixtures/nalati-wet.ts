import { frozenGeographyBlock } from './frozen/geography';

const bytes=frozenGeographyBlock('data/geography-wet.bin');
if(bytes===undefined)throw new Error('Missing original wet block');
export const nalatiWetBlock={file:'data/geography-wet.bin',bytes};
/** Test-only predecessor transport; the independent full metadata and byte hashes remain pinned. */
export const originalNalatiWet=Buffer.from(nalatiWetBlock.bytes).toString('base64');
