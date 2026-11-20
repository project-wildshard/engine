# A native runtime draws skin looks (opus-pine3, OF23a)

- Pine's OF23a product (species as rows with hull skin looks) never
  reached the world, on desktop or phone: `runtimeLookMaterials` read
  only material and graph textures, but `clientMaterials` compiles
  `skinTextureRefs` too, so level.world threw "Missing admitted material
  texture". It now reads the skin looks' textures with the rest.
- Then level.kit threw "Duplicate item row: boar-meat": the session kit
  registers the starter bag and Pine's catalogue re-declares those kit
  harvest items for its drops. `installQuestCatalogue` now keeps the
  kit's row.
- Proof: a local preparation client with both, Pine main f6e6e3c's
  product in headless WebKit, desktop and phone (402x874): enters, a
  walk draws deer, elk, boar, bear and the thralls.
