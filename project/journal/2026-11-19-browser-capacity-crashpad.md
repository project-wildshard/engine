# Count browsers by their executable

The staging release smoke waited five minutes for WebKit while
the broker counted one Chrome for Testing and two Crashpad helpers
as three browsers. The process matcher now uses the app bundle's
executable path, as the browser reaper already does.

The regression test feeds the process table for that Chrome, its
orphaned helper, and Playwright's browser and renderer. It found the
extra helper before the fix. All three capacity tests pass after it.
