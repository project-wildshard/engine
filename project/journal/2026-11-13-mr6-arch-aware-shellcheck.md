# CI's shellcheck install picks its arch (MR6)

> Written by: Claude (opus-mr6e), 2026-11-13

Meta HOW-WE-BUILD MR6, from repo-kit `8c29df1`: the Mac mini runner (MAC-MINI-RUNNER) runs a Linux/ARM64 VM, and
`ci.yml`'s `Install shellcheck 0.11.0` step hard-coded the linux x86_64 archive. The step now picks `x86_64` or
`aarch64` from `RUNNER_OS/RUNNER_ARCH`, each archive pinned by its own published sha256; any other OS or arch fails
before a download. The hosted Linux/X64 URL and pin are unchanged. Engine installs no actionlint in CI, so only the
shellcheck step changed. Engine was the last repo owed; the other twelve got the same step from the kit.

**Proof.** The step's script, run locally with `RUNNER_OS=Linux` and `RUNNER_ARCH` X64 and ARM64, gave
`shellcheck.tar.xz: OK` and an ELF x86-64 / aarch64 binary; `RUNNER_OS=macOS` printed the `::error::` and left
`RUNNER_TEMP` empty. The live arm64 proof is MR7, on the mini. Engine has no copy of repo-kit's
`test/tooling/ci-tool-installs.test.mjs`, so the arm64 branch is untested here until then.
