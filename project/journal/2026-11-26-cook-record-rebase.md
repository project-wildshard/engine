# Regenerate the cook record during a land

PV1's cook record conflicted whenever two cook changes raced to main.
When it is the only unmerged file, land regenerates it from the rebased
sources and reruns the golden against the new parent. It carries over an
author's unused explicit version bump. If main has already issued that
version, the author chooses the next one.

The regression uses a bare Git remote and two branches with independent
cook inputs. Land pushes a clean tree whose record includes both
changes. The normal push still checks the generated record.
