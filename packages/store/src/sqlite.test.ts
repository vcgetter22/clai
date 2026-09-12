import { describe, expect, it } from 'vitest';
import { runStoreConformance } from './testing/conformance.js';
import { SqliteEventStore } from './sqlite.js';

// Thin wrapper: the actual test bodies live in the injected-primitive conformance suite so the
// exact same contract can run against Postgres (PGlite) in the private `clai-cloud` repo.
runStoreConformance({
  describe,
  it,
  expect,
  makeStore: async () => new SqliteEventStore(':memory:', { timeZone: 'UTC' }),
});
