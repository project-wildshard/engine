import { assembleOutputShardfile, parseOutputDescriptorIndex } from '@wildshard/format/outputIndex';
import { validateNamedJsonSchemaPaced } from './customSchema';
import type { OutputDescriptorChecks } from './outputDescriptor';
import type { NamedJsonCheck } from './namedJsonChecks';

/** Explicit Node validation retains all serialized named-JSON checks. */
export const nodeNamedJsonCheck: NamedJsonCheck = (schema, bytes, pause) => validateNamedJsonSchemaPaced(schema, bytes, pause);
export const nodeOutputDescriptorChecks: OutputDescriptorChecks = {
  parseIndex(input) { return parseOutputDescriptorIndex(input); },
  assemble(index, sections) { return assembleOutputShardfile(index, sections); },
};
