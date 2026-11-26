import * as v from 'valibot';

const TestFile = v.pipe(v.string(), v.regex(/^(?:src|test|admin\/test|drafts\/test)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.test\.ts$/u));
const Registry = v.pipe(v.custom<Record<string, unknown>>(value => value !== null && typeof value === 'object' && !Array.isArray(value)),
  v.record(TestFile, v.pipe(v.array(v.literal('basis')), v.minLength(1), v.maxLength(1))));
export type TestBuildTool = 'basis';
export type TestBuildToolPreparers = Readonly<Record<TestBuildTool, () => Promise<void>>>;

/** Only explicitly selected suites may request a trusted native build prerequisite. */
export function selectTestBuildTools(files: readonly string[], input: unknown): TestBuildTool[] {
  const registry = v.parse(Registry, input);
  return [...new Set(files.flatMap(file => registry[file] ?? []))].sort();
}

const preparers: TestBuildToolPreparers = { basis: () => Promise.reject(new Error('The Basis tool is sharddev\'s: a test that needs it waits for P4')) };

/** The runner awaits every selected prerequisite before creating test workers.
 * A failed install refuses the run; unrelated suites never invoke an installer. */
export async function prepareTestBuildTools(files: readonly string[], registry: unknown,
  ports: TestBuildToolPreparers = preparers): Promise<readonly TestBuildTool[]> {
  const tools = selectTestBuildTools(files, registry);
  for (const tool of tools) await ports[tool]();
  return tools;
}
