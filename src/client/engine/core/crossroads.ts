import { crossroadsConfig } from '@wildshard/format/contentBounds';

/** Fixed crossroads experiment shared by the static rig and its telemetry validator. */
export const CROSSROADS_CONFIG: ReturnType<typeof crossroadsConfig> = crossroadsConfig();
