// Node census tools use the defining format contract without booting application services.
import './format-hook.mjs';

export const outputFormat=await import('@wildshard/format/outputIndex');
export const gridReadinessFormat=await import('@wildshard/format/gridReadiness');
export const discoveryFormat=await import('@wildshard/format/discoveryValues');
// Canonical JSON is the format's own (SI1); engine's host/immutable forwards to it, so a static import here would link the format's .ts before the hook.
export const immutableFormat=await import('@wildshard/format/immutable');
export const platformFileFamiliesFormat=await import('@wildshard/format/platformFileFamilies');
