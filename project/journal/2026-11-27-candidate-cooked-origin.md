# Checked candidates need the cooked pack origin

PV25 staging candidates serve their checked page under the staging
hostname, where the cooked bucket already grants CORS. The isolated QA
proxy rejected TLS to the cooked host before the browser reached R2.

Allow its exact HTTPS authority, alongside the signed release and rooms
hosts. The test failed on the missing tunnel and checks that a lookalike
host and a non-HTTPS port are still refused.
