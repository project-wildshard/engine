// FM7: code availability is signed HTTP metadata, independent of game-wire compatibility.
import * as v from 'valibot';

/** Both the current build and every carried graph use the page build's exact identity. */
const CodeBuild = v.pipe(v.string(), v.regex(/^[0-9a-f]{7,40}(?:-[a-z0-9]+)?$/u));
const Milliseconds = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
/** The page publisher signs the actual deploy-chunks graph after carrying old code. */
export interface CodeRetention {
  readonly purpose: 'code-retention';
  readonly channel: 'production' | 'staging' | 'preview';
  readonly engineBuild: string;
  readonly keptBuilds: readonly string[];
  /** When this metadata was signed, never a claimed alias-activation time. */
  readonly issuedAt: number;
  /** An authoritative scheduled retirement, when one exists. Unscheduled deploys omit it. */
  readonly retireAt?: number;
}
export const CodeRetentionSchema: v.GenericSchema<CodeRetention> = v.pipe(v.strictObject({
  purpose: v.literal('code-retention'), channel: v.picklist(['production', 'staging', 'preview']),
  engineBuild: CodeBuild, keptBuilds: v.pipe(v.array(CodeBuild), v.minLength(1), v.maxLength(5)),
  issuedAt: Milliseconds, retireAt: v.exactOptional(Milliseconds),
}), v.check(row => new Set(row.keptBuilds).size === row.keptBuilds.length && row.keptBuilds.includes(row.engineBuild), 'Kept code must be distinct and include the current build'));

/** Call only with authenticated, channel/build-matched metadata. Legacy absence is unknown. */
export function codeAvailability(metadata: CodeRetention | null, build: string): 'unknown' | 'kept' | 'retired' {
  if (metadata === null || !v.safeParse(CodeBuild, build).success) return 'unknown';
  return metadata.keptBuilds.includes(build) ? 'kept' : 'retired';
}
/** A missing schedule is unknown, never a made-up countdown from issuedAt. */
export function retirementDeadline(metadata: CodeRetention | null): number | null { return metadata?.retireAt ?? null; }
