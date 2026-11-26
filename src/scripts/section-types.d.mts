import type { FormatJsonSchema } from '../shared/host/formatJsonSchema';
/** Emit a standalone TypeScript value type from a structural output schema. */
export function sectionType(schema: FormatJsonSchema | boolean,options?:{records?:boolean}): string;
