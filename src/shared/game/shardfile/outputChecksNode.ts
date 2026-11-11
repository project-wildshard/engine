import { assembleOutputShardfile, parseOutputDescriptorIndex } from '@wildshard/format/outputIndex';
import { validateNamedJsonSchemaPaced } from './customSchema';
import type { OutputDescriptorChecks } from './outputDescriptor';
import type { NamedJsonCheck } from './namedJsonChecks';

/** Explicit Node validation retains all serialized named-JSON checks. */
export const nodeNamedJsonCheck: NamedJsonCheck = Object.assign((schema: Readonly<Record<string, unknown>>, bytes: Uint8Array, pause: () => Promise<void>) => validateNamedJsonSchemaPaced(schema, bytes, pause), { pure: true as const });
export const nodeOutputDescriptorChecks: OutputDescriptorChecks = {
  parseIndex(input) { return parseOutputDescriptorIndex(input); },
  assemble(index, sections) { return assembleOutputShardfile(index, sections); },
};
