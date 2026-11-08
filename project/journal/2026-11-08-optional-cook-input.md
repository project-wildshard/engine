# Publish optional-file availability at the cook boundary

Written by: Codex. 2026-11-08. P2 continuation, J186.

The actual current-main cook/store/page reproduction again enters Template
and then fails on HTTP 404 for programs/blender-template.json. The pinned
handwritten product never published that optional file. Its cook index
already names every object actually written, so the attachment can tell
the page the truth before it sends an impossible request.

Carry that presence bit in the mutable boot data beside the attached
product. The existing optional-file reader returns its existing null
result when the cook declares absence. Existing local/legacy data keeps
its old behavior; a present file still uses the cook origin. No shader,
linking, renderer, art, layout or console/HTTP exception changes.

Repeat the complete same-commit cold cook/store/page proof after this
source commit. Its byte provenance assertion must run, not merely exist.
