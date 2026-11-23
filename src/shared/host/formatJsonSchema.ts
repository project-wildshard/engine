// The format's one JSON Schema projection (FORMAT-PRUNE FP9b). It lives in @wildshard/format/jsonSchema; this path
// stays for engine's tests and scripts and the SDK's `internal/engine/host/formatJsonSchema` row, each name bound to the
// format's own. The named-row and author helpers that sat below it are the SDK's.
import * as format from '@wildshard/format/jsonSchema';

export const formatJsonSchema: typeof format.formatJsonSchema = format.formatJsonSchema;
export const formatJsonSchemas: typeof format.formatJsonSchemas = format.formatJsonSchemas;
export const namedFormatJsonSchema: typeof format.namedFormatJsonSchema = format.namedFormatJsonSchema;
export const namedFormatJsonSchemas: typeof format.namedFormatJsonSchemas = format.namedFormatJsonSchemas;
export const namedJsonSchema: typeof format.namedJsonSchema = format.namedJsonSchema;
export const registeredJsonSchema: typeof format.registeredJsonSchema = format.registeredJsonSchema;
export const schemaAt: typeof format.schemaAt = format.schemaAt;
export const schemaDeclaration: typeof format.schemaDeclaration = format.schemaDeclaration;
export type FormatJsonSchema = format.FormatJsonSchema;
export type SchemaDeclaration = format.SchemaDeclaration;
