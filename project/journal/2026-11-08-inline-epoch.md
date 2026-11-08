# Share the epoch before modules arrive

The HTML watchdog still wrote the epoch-zero session document. Runtime's
one-reload guard therefore could not see it after the first epoch switch.
The first-paint Developer preference and title-arrival clock had the same
old namespace. All four inline readers/writers now use epoch 1.

Two tests execute the actual inline scripts in an isolated VM: one retry
writes the current session guard and the next page refuses another retry;
the loading clock consumes the new title handoff. Both failed before the
change and pass afterward. No stable identity key changes.

The preceding native-flake integration fixes db17776's ring-1 failure:
Sunscar used 2.7 s in compositor setup and exhausted a 10 s capture budget.
One capture now has at most 30 s within the original boot deadline, with
the pixel bar and no-retry behavior retained.
