export const SCHEMA_TYPE_RULE: 'wildshard/explicit-schema-types';
export function schemaTypeIdentity(identity:string):{file:string;name:string};
export function ratchetApprovalFailures(before: Record<string, object>, after: Record<string, object>, message: string, scope?: 'lint'|'tiles'): string[];
