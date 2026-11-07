import type { BitReader, BitWriter } from './bits';
import type { ChatChannel } from './acts';

// P1-E5.2c (J110, §4.3): a line of chat on the wire, as the server cleaned and filtered it. It carries the speaker's Name
// because a line can come from someone out of relevance, whose handle this client cannot resolve; it never carries their id.

/** One line a client hears. `line` is what a report names; `from` is the speaker's handle, or 0 when out of the client's sight. */
export interface NetChat { readonly kind: 'chat'; readonly tick: number; readonly line: number; readonly channel: ChatChannel; readonly from: number; readonly name: string; readonly text: string }

/** Write a line after its event id. */
export function writeChat(writer: BitWriter, event: NetChat): void {
  writer.write(event.tick, 32); writer.write(event.line, 32); writer.writeBool(event.channel === 'proximity'); writer.write(event.from, 16);
  writer.writeText(event.name); writer.writeText(event.text);
}
/** Read a line after its event id. */
export function readChat(reader: BitReader): NetChat {
  return { kind: 'chat', tick: reader.read(32), line: reader.read(32), channel: reader.readBool() ? 'proximity' : 'room', from: reader.read(16), name: reader.readText(), text: reader.readText() };
}
