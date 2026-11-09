# Every Chromium launch passes the mock keychain

> Written by: Claude

phone-loading spawned Chrome for Testing by its executable, which skips Playwright's default arguments, so each run
opened a macOS "Chrome for Testing Safe Storage" keychain dialog on Jake's screen. Jake wants `--use-mock-keychain`
everywhere. `scripts/chromium-keychain.mjs` exports `KEYCHAIN_ARGS` (`--use-mock-keychain`, `--password-store=basic`);
all four raw spawns (phone-loading, scorecard, bench-load, the native-browser-escape fixture), every Playwright Chromium
launch in scripts and tests, and the e2e config spread it. `test/tooling/chrome-keychain.test.mjs` refuses a file that
starts Chromium without it, and any option that drops Playwright's defaults. phone4 is a new phone-loading preset,
4x CPU on the phone link.

DL24 diagnostics: phone-loading's play window now records the renderer's program and texture counts each page frame,
names every program created after control, and lists frames over 100 ms with what appeared across them. The first
reading on 4f31a1d: Far Reach at 10x CPU creates one program 13.4 s after control, during boost, the same moment as
DL24's 390-406 ms Simulator frame.
