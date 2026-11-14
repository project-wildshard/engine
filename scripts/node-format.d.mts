import type * as OutputFormat from '@wildshard/format/outputIndex';
import type * as GridReadiness from '@wildshard/format/gridReadiness';
import type * as DiscoveryFormat from '@wildshard/format/discoveryValues';
import type * as PlatformFileFamilies from '@wildshard/format/platformFileFamilies';

/** Defining format operations, loaded under a Node-only format-relative resolution hook. */
export const outputFormat:typeof OutputFormat;
export const gridReadinessFormat:typeof GridReadiness;
export const discoveryFormat:typeof DiscoveryFormat;
export const platformFileFamiliesFormat:typeof PlatformFileFamilies;
