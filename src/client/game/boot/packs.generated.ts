// No generator writes this table any more (QA 11-26 row 33): the boot packs left the build, so it stays empty.
// slug → tier → the boot pack, in content-addressed parts: each part's URL, size and [path, offset in the part, size,
// content-type] per packed file (src/client/engine/boot/pack.ts). `files` / `bytes` are the whole pack's.
import type { PackDef } from '@wildshard/engine/boot/tables';
export const PACKS: Readonly<Record<string, Readonly<Record<string, PackDef>>>> = {};
