# Sign the exact staging cook

Staging serial 162 still uses the legacy room books. Once the served
pins all have author shard versions, the signer includes the cook
version and hash from the release's exact source. It refuses a cook
address that a signed shard cannot use. A mixed pin set keeps the
legacy release shape.
