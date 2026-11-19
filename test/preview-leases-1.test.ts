import { test } from 'vitest';
import { checkPreviewLeasePartition, PREVIEW_LEASE_TEST_TIMEOUT } from './previewLeaseProof';

test('preview leases, sharing and release retain all behavior (partition 1/3)',
  ({ signal }) => checkPreviewLeasePartition(1, signal), PREVIEW_LEASE_TEST_TIMEOUT);
