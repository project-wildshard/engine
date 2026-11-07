export function fastCommitLintConfig(input: unknown): Record<string, unknown> & { options: Record<string, unknown> & { typeAware: boolean } };
export function fastLint(files: string[], executable: string): void;
export function stagedRatchet(files: string[], executable: string, repository?: string): Promise<void>;
