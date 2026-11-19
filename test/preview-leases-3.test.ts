import { test } from 'vitest';
import { checkPreviewLeasePartition, PREVIEW_LEASE_TEST_TIMEOUT } from './previewLeaseProof';

test('preview leases, sharing and release retain all behavior (partition 3/3)',
  ({ signal }) => checkPreviewLeasePartition(3, signal), PREVIEW_LEASE_TEST_TIMEOUT);
