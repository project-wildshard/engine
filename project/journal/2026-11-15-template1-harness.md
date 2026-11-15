# Template-1 harness (codex-te2e)

- Add a separate Playwright entry point and title smoke for T1E-1a.
  The runner allocates a free preview port and uses validated full pins;
  the old Ring-1 install leaves a frozen Blender pin that gen refuses.
- Build and test output belongs to `tmp/<lane>/t1`. A supplied
  `WS_T1_BUILD_DIR` reuses hosted build bytes. The preview server owns
  production headers and content delivery, rather than the CLI status app.
