# Save only at the walk checkpoints

The full Nine saved-walk proof reached its ten-second deadline twice
on hosted Ring 2. It sent a full serialized save across the worker
boundary for all 24 ticks. The assertion needs three saves.

Run eight real inputs per worker tape part and save at the same prefix,
control suffix and restored suffix boundaries. Check every input tick
completed and compare the same full-save hashes. The deadline stays
ten seconds.
