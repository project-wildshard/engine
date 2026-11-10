import ts from '@typescript/typescript6';

/** Parsed and bound library and source files, shared by every consumer program in one test file
 * (VITEST-BENCH VB10). Each proof still compiles its own program from its own consumer, so its import
 * graph is exactly the original one: one union program of every consumer changes what some consumers
 * are refused (measured: isolated-engine-constant loses two TS2540 refusals and gains a TS2322). */
const parsed = new Map<string, ts.SourceFile | undefined>();

/** The semantic diagnostics of an unwritten consumer file, compiled alone with its imports. */
export function consumerDiagnostics(consumer: string, source: string, options: ts.CompilerOptions): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  const parse = host.getSourceFile.bind(host);
  host.fileExists = (file: string): boolean => file === consumer || exists(file);
  host.readFile = (file: string): string | undefined => (file === consumer ? source : read(file));
  host.getSourceFile = (file, language, onError, fresh): ts.SourceFile | undefined => {
    if (file === consumer || fresh === true) return parse(file, language, onError, fresh);
    const key = `${JSON.stringify(options)}\0${JSON.stringify(language)}\0${file}`;
    if (!parsed.has(key)) parsed.set(key, parse(file, language, onError, fresh));
    return parsed.get(key);
  };
  const program = ts.createProgram([consumer], options, host), file = program.getSourceFile(consumer);
  if (file === undefined) throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
}
