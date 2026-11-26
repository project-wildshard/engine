/** Preserve ordinary lint configuration while deferring typed rules to CI. */
export function untypedLintConfig(input: unknown): Record<string, unknown> & {
  options: Record<string, unknown> & { typeAware: boolean };
};
