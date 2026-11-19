# Keep the Developer hold boundary test current

In hosted run 44581983644, the frozen load clock was correct. The
assertion still expected the ordinary completed footer, which QA17
had intentionally changed to name the Developer hold and PLAY.
Assert the held footer before and after the wait, and check the
same rounded load time in diagnostics and the frozen clock.
