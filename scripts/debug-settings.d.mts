import type {BrowserContext, Page} from 'playwright';

export interface SaveFixture {
  readonly scope: 'device' | 'session' | 'global';
  readonly key: string;
  readonly data: unknown;
  readonly merge?: boolean;
  readonly once?: string;
}
type InitTarget = Pick<BrowserContext, 'addInitScript'> | Pick<Page, 'addInitScript'>;
export function deviceSavePicks(values: readonly string[]): Record<string, string>;
export function writeSaveFixture(fixture: SaveFixture): void;
export function saveFixture(target: InitTarget, fixture: SaveFixture): Promise<void>;
export function debugSettings(target: InitTarget, picks: Readonly<Record<string, string | boolean | number>>): Promise<void>;
export function developerSettings(target: InitTarget, picks: Readonly<Record<string, string | boolean | number>>): Promise<void>;
export function hideDeveloperOverlays(): void;
export function harnessPinCode(pins: Readonly<Record<string, unknown>>): string;
export function harnessPins(target: InitTarget, pins: Readonly<Record<string, unknown>>): Promise<void>;
export function saveFixtureCode(fixture: SaveFixture): string;
export function fixtureStorage(scope: SaveFixture['scope']): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function fixtureStorageCode(scope: SaveFixture['scope']): string;
