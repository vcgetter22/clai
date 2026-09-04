#!/usr/bin/env node
import { run } from '../dist/index.js';

run(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
