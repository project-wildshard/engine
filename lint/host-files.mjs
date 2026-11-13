// Path-only play boundary, shared by lint and the typed catalogue builder.
import { shardFile } from './shard-source.mjs';

/** Build-only functions are not play callbacks. `file` is relative to `root`, in either shard layout (SA45). */
export function hostPlayFile(root, file) {
  const shard = shardFile(root, file);
  return shard !== null && !/^(?:data|generators|behaviour|assets|blender)\/|^shard\.config\.|\.d\.ts$|\.generated\./u.test(shard.local);
}
