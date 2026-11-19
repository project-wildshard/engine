# Record the phone release suite

IP26 summarises three Template boots, three Nine boots and a 60-second
Nine walk from the M1 bench. It records per-release medians and
compares phone memory with the previous report using J431's noise
margin. A high reading is printed as a change and exits successfully.

Each live suite uses the harness's two locks for the whole capture.
Missing attempts, a short walk, and mixed page builds are explicit in
the report. The history stores aggregate readings. Raw trials stay in
the run directory.

The replay used the recorded staging v0.1.46 Nine attempt that lost
its page. Two scratch history entries compare the same build and show
unavailable readings. A dry replay leaves the history alone. A
complete fixture exercises the three-sample median and the noise line.
The live bench entry point and device proof depend on M1.

The live suite owns a fresh capture directory, so a failed child cannot
reuse a previous run's measurements. The same push carries IP30's
regenerated save lock for the debug.phoneBudget device slot.
