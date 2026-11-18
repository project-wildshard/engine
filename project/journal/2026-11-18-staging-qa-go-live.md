# SQ7 gate the staging alias on both QA legs

A staging alias move now needs the local verdict for the release commit's
parent and the candidate verdict for the release itself. The local leg
includes the Chromium gate crossing and Simulator Safari. The candidate
verdict names the checked Worker deployment and signed rooms serial. The
flow reads the serial again before moving the alias. A different serial
requires another candidate run.

The page host test drives missing, held, stale and clean verdicts through
the actual go-live path.
