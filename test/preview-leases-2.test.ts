import { test } from 'vitest';
import { checkPreviewLeasePartition, PREVIEW_LEASE_TEST_TIMEOUT } from './previewLeaseProof';

test('preview leases, sharing and release retain all behavior (partition 2/3)',
  ({ signal }) => checkPreviewLeasePartition(2, signal), PREVIEW_LEASE_TEST_TIMEOUT);
