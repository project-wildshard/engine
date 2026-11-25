# FP54: a runtime page takes its product's start

Pine 0.1.0.6 stopped at "Joining the world": kit's audio entry threw "Audio entry requires its native mixer". Pine's
discovery names its client-plan entry, so `installManifestShardfile` took the runtime-page branch, which returned the
discovery manifest as it was. Since OF9b5 a discovery carries no spawn, loadout or audio, so the page had the old engine
default audio (`legacy`, no catalogue, no preload), no mixer was built before kit, and the player would have stood at
the origin. r16 entered because its older discovery still carried the start.

The runtime branch now reads the start from the product as the declared branch does (`productStart`), and the catalogue
binding the discovery reader made (`catalogue: true` -> preload + boot audio) is one helper, `bindAudioCatalogue`, used
by both. Proof: Pine `defa8d2` on a local preparation client enters headless in 10 s at its own spawn (0, -235).
