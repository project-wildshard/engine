export const RELEASE_READER_TESTS: readonly string[];
export function selectCI(env?: NodeJS.ProcessEnv, cwd?: string, historyOnly?: boolean):
  Promise<{ docs: boolean; base: string | null; tests: string[]; reason: string }>;
