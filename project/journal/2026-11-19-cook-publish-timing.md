# Share the real cook publication cases

Run 44473130939 measured the publication file at 64.286 s against
60 s. The listing regression added in d4aa45c6 spent 15.871 s
on two more real cooks. The authenticated notice spent 21.800 s.

The authenticated cold publish now runs with the existing sparse
content object and counts the initial bucket listing. Its index
proves that page content stays out of the budget. Deleting that
index forces the same worker to publish again and prove its listing
is cached. The independent custom and default budget refusals stay.
All three cases passed locally in 27.35 s with two cook CPU slots.
