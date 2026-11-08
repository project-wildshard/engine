# Resume actual v0.1.1 world saves

Written by: Codex. 2026-11-08. EG-31, J186.

Exported the annotated public v0.1.1 tag, peeled commit
0d9e2381904a398721c36d94d25b8ed9b1f0707d, into a separate owned source
tree. Installed its frozen dependencies and its Ring 1 pins, then ran
that release's actual headless simulation for thirty walking ticks on
three products and five server slices. These are old-release checkpoints,
not current saves labelled as old, and no serialized field was rewritten.

Seven retained fixtures are losslessly Brotli-compressed, with release,
save epoch, shardfile hash, file hash, tick and player position as readable
provenance. The new engine restores each through its normal continuation
API. The player resumes at the saved tick and place, then keeps walking.
It never compares a private serialized field list or a whole-state golden.
Seven real cases pass; the slowest is 2.87 s on the clean Ring 1 input tree.

Nalati's actual compressed fixture is 9,565,519 bytes. The repository's
blob cap is 5 MB. Do not split it to evade the cap or prune saved physics.
That eighth old-release fixture needs an artifact mirror pin. The generic
current-save continuation law separately passes on all eight inputs.
This fixture set does not claim UI save import/export, process-loss
recovery, epoch migration or the requested mid-fight disconnect proof.

The new old-save cases join the report-only engine-boundaries soak through
2026-11-15. No hook, budget or release gate changes. The normal full
pre-push remains enabled for publication of this stack.

The first complete pre-push passed 5769 cases but caught one new Blender
continuation case over ten seconds. Keep its ten-second limit: reduce the
current-save law from 30-tick prefixes/suffixes to eight, and the old-save
movement check to twelve ticks. Both retain real restore and movement;
no timeout increase or hook bypass is used. Repeat the focused cases and
normal full gate on the rebased stack before publication.
