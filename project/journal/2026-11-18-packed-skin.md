# 2026-11-18: a skin row draws one species of a packed GLB (meta ONE-FORMAT CC51c)

- Several small species can now ship in one GLB (format 0.45.0 `rig.mesh`). The skin row names the node that holds its
  species; the loader takes that subtree as the skin's root and keeps only the clips whose every track moves a node
  inside it. The other species' meshes are disposed, so a packed file costs one download, not one draw per species.
- Two species on one skeleton share every name (joints, mesh, the `idle` clip), and three makes loaded names unique, so
  each kept track is bound to its node by UUID before names are restored. Without `rig.mesh` the whole file is the
  skin, as before. The test packs two skins under `left` and `right` and checks each draws its own bounds and clip.
