// Driver-free root export: types, filter/option types and the interface only. No consumer of
// `@claii/store` loads `node:sqlite` by accident — the SQLite implementation is behind the
// `@claii/store/sqlite` subpath, and the conformance suite is behind `@claii/store/testing`.
export * from './interface.js';
export { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
export * from './paths.js';
