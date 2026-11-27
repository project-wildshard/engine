# Wait for the SessionEnd fixture to exit

Stamp repo-kit ec8a2459. The fake session owns and reaps its child, and the
real-kill test observes the child's exit.
