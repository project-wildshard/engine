# The default UA comes from the browser, not a page

buddy-engine, 2026-11-21, engine red 44944859967 (assigned by the
Coordinator).

The run failed two files. One was the ring-2 declarations test, which
opus-of-owned had already fixed forward in f1b97d279 (OF31f2 made
CosmeticId a string). The other was agent-browser-marker, where a
headless default page sent a Windows Chrome UA, marked.

That string is Playwright's Desktop Chrome descriptor. Earlier in the
same job, the e2e smoke (`playwright test --config
src/e2e/playwright.config.ts`, Desktop Chrome project) launched
Chromium through the actor marker. The marker read the build's default
UA from a page and kept it in `~/.cache/wildshard/browser-ua`, keyed by
the build alone. Under Playwright Test a page takes the project's `use`,
so it kept the desktop descriptor. Every later Chromium launch in that
job then sent Windows Chrome as its network UA. Locally, the same e2e
run with a scratch HOME writes exactly that file.

The probe now asks the browser itself (CDP `Browser.getVersion`), which
no context default reaches. The cache key gains a version, so any file
a page probe already wrote is never read again. After the fix, the same
e2e run keeps `HeadlessChrome/158.0.8127.18`.
