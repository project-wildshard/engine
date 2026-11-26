import type { Client } from 'pg';
/** Fixture identity and lifecycle capabilities; no existing service is admitted. */
export function plainPath(path: string): string;
export function fixtureKey(path: string): { readonly private: string; readonly public: string };
export function freeFixturePorts(ports: readonly number[]): Promise<void>;
export function claimFixture(path: string): string;
export function fixtureRequestOrigins(page: string, socket: string): Set<string>;
export function ownedPostgres(options: { readonly bin: string; readonly data: string; readonly port: number; readonly socketOnly?: boolean }): { readonly data: string; readonly close: () => void };
export function confirmPostgres(client: Client, data: string): Promise<void>;

export function ownedEphemeralPostgres(options: { readonly bin: string; readonly data: string }): Promise<{ readonly data: string; readonly port: number; readonly close: () => Promise<void> }>;
