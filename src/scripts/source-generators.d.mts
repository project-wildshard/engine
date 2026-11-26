export interface SourceGenerator {
  readonly id: string;
  readonly outputs: readonly string[];
  readonly inputs: readonly string[];
  readonly committed: boolean;
  readonly generate?: (root: string) => Promise<Readonly<Record<string, string>>>;
  readonly run?: (root: string, check: boolean) => void;
  readonly note?: string;
}
export const SOURCE_GENERATORS: readonly SourceGenerator[];
export function selectSourceGenerators(paths: readonly string[]): SourceGenerator[];
