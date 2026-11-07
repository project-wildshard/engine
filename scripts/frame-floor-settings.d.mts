export function resetFrameFloorDebug(): void;
export function frameFloorSettingsCode(settings: Record<string, string>): string;
export function assertFrameFloorFixture(settings: Record<string, string>, developer: boolean, deviceSaves: Record<string, string>): void;
export function frameFloorBootstrapHtml(fixture: string, check: string): string;
export function frameFloorGameNavigationCode(url: string): string;
export function traceFrameFloorFixtureWrites(): void;
