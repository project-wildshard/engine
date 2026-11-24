// FORMAT-PRUNE FP11: the one starting shard file lives in shard-format (`./emptyShardfile`, admitted by the format's own
// parser, with no `requires.sdk`); this path stays for engine's tests and authors, the name bound to the format's own.
import * as format from '@wildshard/format/emptyShardfile';

/** An identity with its save lineage under either spelling (`saveRevision` from format 0.1.0.4, `revision` before). */
export type AuthorIdentity = Parameters<typeof format.emptyShardfile>[0];
/** Start an author project with a valid empty world; add baked content before shipping a playable shard. */
export const emptyShardfile: typeof format.emptyShardfile = format.emptyShardfile;
