# Give Ring 2 three suite partitions

Run 44902919516 stopped its second partition at the 25-minute process
limit. It had logged 785 files and left no final Vitest report. The
first partition took 18 minutes.

Run the same Vitest inventory in three shards with the same worker
count and process limit. The dispatcher and verdict use one partition
count, and qualification requires every partition's receipt.
