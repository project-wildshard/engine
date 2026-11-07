// Path-only play boundary, shared by lint and the typed catalogue builder.

/** Build-only functions are not play callbacks. */
export function hostPlayFile(_root, file) {
  const match = /^src\/shards\/([^/]+)\/(.+)$/u.exec(file);
  return match !== null && !/^(?:data|generators|behaviour|assets|blender)\/|^shard\.config\.|\.d\.ts$|\.generated\./u.test(match[2]);
}
