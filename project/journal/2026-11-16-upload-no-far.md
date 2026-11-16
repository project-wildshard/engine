# An uploaded world may declare no far view

The v31 QA43 staging gate found Mu9 repeatedly requesting a baked
far.json it never published. Its genuine source declares far:null.
The index reader returned the same null used for a legacy baked folder,
so the grid tried the nonexistent fallback forever.

Keep the authored no-far row and render its actual zero-geometry view.
The real section fixture verifies the transport reads and that no GLB
or baked fallback is read. Do not fabricate a terrain file. The release
publisher also materializes genuine verified pack members for direct
section reads; full exact-branch CI and native staging gates still apply.
