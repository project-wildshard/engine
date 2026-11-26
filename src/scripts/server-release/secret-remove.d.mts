export const REPOSITORY: string;
export interface RunnableRef { ref: string; version?: string; commit: string }
export interface SecretReader { ref: string; file: string }
export interface RemoveDeps {
  git?: (args: string[]) => string;
  productionBuild?: () => Promise<string>;
  gh?: (args: string[]) => void;
  log?: (line: string) => void;
}
export function compareVersions(left: string, right: string): number;
export function parseRemoteRefs(text: string): RunnableRef[];
export function runnableRefs(refs: readonly RunnableRef[], productionBuild: string): RunnableRef[];
export function secretReaders(name: string, workflows: readonly { ref: string; file: string; text: string }[]): SecretReader[];
export function removeSecret(name: string, options: { env?: string; check?: boolean }, deps?: RemoveDeps): Promise<SecretReader[]>;
