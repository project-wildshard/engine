# The reported inherited CPU refusal was an earlier control

FL10 recovered the original mmo5 failure output. Its terminal exception was
the checked-tree/runtime publication guard at push-checks.mjs:162 after a
1209.6-second gate. The owner immediately identified the edit it made to the
proof script while that gate ran. A correct changed-tree refusal should
have been the landing receipt's cause.

The inherited CPU error came from an earlier passing negative control on
stdout. Land already chose the last thrown error, but concatenated stderr
before stdout for an unacknowledged hook. That stream ordering put the old
control after the terminal exception. A real Git hook reproduces this
misattribution before repair. Appending terminal stderr after stdout makes
the actual error win, while preserving task RED and Git rejection rules.

The CPU guard correctly remains unchanged. No stale process was established
in this incident and no ancestor validation, grant capacity or timeout is
relaxed. A source edit during a gate still refuses publication.
