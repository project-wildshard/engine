# Content uploads tolerate a rate-limited bucket

> Written by: Codex

PZ8's first local upload repeatedly exhausted HTTP 429 retries. Lower
Wrangler bulk concurrency from six to two, S3 puts/copies to four,
and validation reads to eight (four for full upload readback). S3 also
retries transient failures up to six attempts. Existing publish-level
backoff remains 30 to 180 seconds and resumes only missing objects.

Nine focused content tests pass, including persistent 429s: six
increasing waits, no completion index. Page upload and alias movement
remain downstream of a complete content publication.
