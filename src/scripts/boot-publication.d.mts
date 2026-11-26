export interface PublishedPackPart {
  readonly url: string;
  readonly bytes: number;
  readonly files: readonly (readonly [string, number, number, string])[];
}
export interface BootPublication {
  readonly schema: 'boot-publication/1';
  readonly bytes: Readonly<Record<string, number>>;
  readonly versions: Readonly<Record<string, string>>;
  readonly packs: Readonly<Record<string, Readonly<Partial<Record<'phone' | 'desktop', { readonly parts: readonly PublishedPackPart[] }>>>>>;
}
export const BOOT_PUBLICATION: string;
export function parseBootPublication(input: unknown): BootPublication;
export function readBootPublication(root: string): BootPublication;
export function publishBootPublication(root: string, input: unknown): void;
export function publishedBootTableSources(data: BootPublication): Record<string, string>;
export function bootPublicationTableSources(root: string): Record<string, string>;
export function publicBytesTableSource(rows: Readonly<Record<string, number>>): string;
export function assetVersionsTableSource(rows: Readonly<Record<string, string>>): string;
