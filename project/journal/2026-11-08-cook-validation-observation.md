# Keep cook validation inside its worker

The hosted cook file still misses its sixty-second file budget.
Source 0c2e5f6 CI 42504740191 passes all twenty-three assertions.
Its case span is 78.677 seconds, already beyond the whole-file budget.
The HTTP and budget-refusal cases each spend about 11.5 seconds cooking.
Inventory 86b7e10 fixes a separate import-graph refusal, not that budget.

An actual local Dunes cook reproduces the warm-job work.
The cold job takes 19.057 seconds; its packing takes 13.702 seconds.
With its verified q11 cache, the warm job takes 5.017 seconds.
Packing then takes only 0.193 seconds.
The parent CPU profile spends 3.956 seconds idle awaiting its worker.
Validation sends 240 step requests, each carrying a complete checkpoint.
No cache of a simulation verdict is appropriate here.
Every new cook must still validate its current admitted product.

The existing offline observe operation already runs all 240 real ticks.
It validates every intermediate observation and complete snapshot boundary.
It returns every raw tick, script and fuel sample and a final checkpoint.
The new terminal validate composition uses that operation, then finish.
Finish runs the original entry proof in the same resident.
Only this private composition may finish after its own observation.
Ordinary observe still forbids finish and all other continuations.
The runtime/advisory distinction and both request watchdogs are unchanged.
No protocol grammar, simulation tick count or snapshot codec changes.

The public-product proof creates two independent Dunes workers.
Its control publishes all 240 original per-step full checkpoints.
Every sample tick, script cost and fuel value matches that control.
The final complete checkpoint and actual entry-proof result match.
Step, observe, finish and a repeated validate refuse afterward.
This new outer-edge proof passes in an 8.75-second file run.
Its stated Ring 2 allowance preserves all reference checkpoints under load.
Existing native observation proofs retain their independent controls.

The candidate actual warm cook takes 2.108 seconds, packing 0.184 seconds.
All four manifest names, sizes, wire totals and part counts are identical.
The q11 part totals and server index name are identical too.
Typed source lint and the complete layered typecheck pass.
The canonical full cook file cannot run under J196's external aliases:
Node's existing child read fence correctly refuses those outside paths.
That failed local attempt is not a green cook proof or a policy exception.
The normal frozen publication gate must prove all original twenty-three
cases against the recorded package pins and unchanged child permissions.
Hosted qualification remains pending; no quarantine entry is removed.
