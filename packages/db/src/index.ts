// @dex-arb/db — schemat Drizzle, migracje, klient PostgreSQL.
export { createDb, createTestDb, type Db } from "./client.js";
export * as schema from "./schema/index.js";
export { gitSha, packageVersion, rpcHostFrom, tableCounts } from "./provenance.js";
export { loadCoverage, loadOpportunityCounts, loadPoolDoneBlocks, type CoverageCell, type PoolCoverage } from "./queries/coverage.js";
